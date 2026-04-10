package service

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/yclgkd/ZeroLink/services/selfhost-api/internal/realtime"
	"github.com/yclgkd/ZeroLink/services/selfhost-api/internal/store"
	"github.com/yclgkd/ZeroLink/services/selfhost-api/internal/webauthn"
)

const (
	uuidLength            = 21
	createChallengeBytes  = 32
	channelTTLOneHourMS   = int64(3_600_000)
	channelTTLOneDayMS    = int64(86_400_000)
	channelTTLSevenDaysMS = int64(604_800_000)
)

var (
	uuidPattern            = regexp.MustCompile(`^[A-Za-z0-9_-]{21}$`)
	base64URLPattern       = regexp.MustCompile(`^[A-Za-z0-9_-]+$`)
	errProtocolNilDB       = errors.New("protocol database is not configured")
	errProtocolNilVerifier = errors.New("protocol verifier is not configured")
)

type Protocol interface {
	CreateBegin(context.Context, CreateBeginInput) (CreateBeginOutput, error)
	CreateFinish(context.Context, CreateFinishInput) (CreateFinishOutput, error)
	LockBegin(context.Context, LockBeginInput) (LockBeginOutput, error)
	LockCommit(context.Context, LockCommitInput) (LockCommitOutput, error)
	CompoundBegin(context.Context, CompoundBeginInput) (CompoundBeginOutput, error)
	CompoundCommit(context.Context, CompoundCommitInput) (CompoundCommitOutput, error)
	PublicStatus(context.Context, string) (PublicStatusOutput, error)
	DecryptFetch(context.Context, string) (DecryptFetchOutput, error)
	RealtimeState(context.Context, string) (RealtimeStateOutput, error)
}

type ProtocolError struct {
	Code               string
	Status             int
	Message            string
	Cause              error
	RetryAfterSeconds  int
	CommitCookieSignal *CommitCookieSignal
}

func (e *ProtocolError) Error() string {
	if e == nil {
		return ""
	}
	if e.Message != "" {
		return e.Message
	}
	return e.Code
}

func (e *ProtocolError) Unwrap() error {
	if e == nil {
		return nil
	}
	return e.Cause
}

type ProtocolConfig struct {
	RPID              string
	RPOrigin          string
	CommitTokenSecret string
	Verifier          webauthn.Verifier
	Publisher         realtime.Publisher
	File              FilePolicy
}

type FilePolicy struct {
	MaxFileBytes            int64
	MultipartThresholdBytes int64
	ChunkSizeBytes          int64
	MaxChunks               int64
	MultipartSupported      bool
}

type ProtocolService struct {
	db                *store.Database
	verifier          webauthn.Verifier
	rpID              string
	rpOrigin          string
	commitTokenSecret string
	publisher         realtime.Publisher
	filePolicy        FilePolicy
	now               func() time.Time
	randomRead        func([]byte) (int, error)
	rateLimiter       *protocolRateLimiter
}

type CreateBeginInput struct {
	UUID            string `json:"uuid"`
	Timestamp       *int64 `json:"timestamp"`
	SecurityProfile string `json:"securityProfile"`
	TTL             *int64 `json:"ttl,omitempty"`
}

type CreateBeginOutput struct {
	OK              bool           `json:"ok"`
	CreationOptions map[string]any `json:"creationOptions"`
}

type CreateFinishInput struct {
	AdminMode     string             `json:"adminMode"`
	UUID          string             `json:"uuid"`
	Attestation   *AttestationJSON   `json:"attestation,omitempty"`
	SoftkeyPubJWK *ECDSAPublicKeyJWK `json:"softkeyPubJwk,omitempty"`
	LockKeyB64u   string             `json:"lockKeyB64u"`
	Timestamp     *int64             `json:"timestamp"`
}

type CreateFinishOutput struct {
	OK        bool   `json:"ok"`
	ShareURL  string `json:"shareUrl"`
	ManageURL string `json:"manageUrl"`
}

type PublicStatusOutput struct {
	OK              bool   `json:"ok"`
	State           string `json:"state"`
	AdminMode       string `json:"adminMode"`
	SecurityProfile string `json:"securityProfile"`
	ReceiverPubFpr  string `json:"receiverPubFpr,omitempty"`
}

type RealtimeStateOutput struct {
	ChannelID       string
	State           string
	Version         int64
	AdminMode       string
	SecurityProfile string
	ReceiverPubFpr  string
	ExpiresAt       time.Time
}

type AttestationJSON struct {
	ID       string                  `json:"id"`
	RawID    string                  `json:"rawId"`
	Type     string                  `json:"type"`
	Response AttestationResponseJSON `json:"response"`
}

type AttestationResponseJSON struct {
	ClientDataJSON    string   `json:"clientDataJSON"`
	AttestationObject string   `json:"attestationObject"`
	Transports        []string `json:"transports,omitempty"`
}

type ECDSAPublicKeyJWK struct {
	KTY    string   `json:"kty"`
	CRV    string   `json:"crv"`
	X      string   `json:"x"`
	Y      string   `json:"y"`
	Ext    bool     `json:"ext"`
	KeyOps []string `json:"key_ops"`
}

type webAuthnStoredCredential struct {
	CredentialID string   `json:"credentialId"`
	PublicKey    string   `json:"publicKey"`
	SignCount    int64    `json:"signCount"`
	AAGUID       string   `json:"aaguid"`
	Transports   []string `json:"transports,omitempty"`
}

type softkeyStoredCredential struct {
	Type          string            `json:"type"`
	SoftkeyPubJWK ECDSAPublicKeyJWK `json:"softkeyPubJwk"`
}

func NewProtocolService(db *store.Database, cfg ProtocolConfig) Protocol {
	verifier := cfg.Verifier
	if verifier == nil {
		verifier = webauthn.NewVerifier()
	}

	return &ProtocolService{
		db:                db,
		verifier:          verifier,
		rpID:              cfg.RPID,
		rpOrigin:          strings.TrimRight(cfg.RPOrigin, "/"),
		commitTokenSecret: strings.TrimSpace(cfg.CommitTokenSecret),
		publisher:         cfg.Publisher,
		filePolicy:        cfg.File,
		now:               func() time.Time { return time.Now().UTC() },
		randomRead:        rand.Read,
		rateLimiter:       newProtocolRateLimiter(),
	}
}

func (s *ProtocolService) CreateBegin(ctx context.Context, input CreateBeginInput) (CreateBeginOutput, error) {
	if s.db == nil {
		return CreateBeginOutput{}, internalError(errProtocolNilDB)
	}

	ttlMS, err := validateCreateBeginInput(input)
	if err != nil {
		return CreateBeginOutput{}, err
	}

	now := s.now().UTC()
	challengeBuffer := make([]byte, createChallengeBytes)
	if _, err := s.randomRead(challengeBuffer); err != nil {
		return CreateBeginOutput{}, internalError(fmt.Errorf("generate create challenge: %w", err))
	}

	challenge := encodeBase64URL(challengeBuffer)

	err = s.db.WithChannelTx(ctx, input.UUID, func(ctx context.Context, tx *store.ChannelTx) error {
		tombstone, err := tx.GetTerminalTombstone(ctx)
		if err != nil {
			return err
		}
		if tombstone != nil {
			return lockForbidden("channel already exists")
		}

		existing, err := tx.GetChannel(ctx)
		if err != nil {
			return err
		}
		if existing != nil {
			if existing.Expired(now) {
				if _, err := tx.FinalizeTerminalState(ctx, store.TerminalReasonExpired, now); err != nil {
					return err
				}
			}
			return lockForbidden("channel already exists")
		}

		adminMode := store.AdminModeWebAuthn
		lockKeyPlaceholder := ""
		placeholderCredential, err := json.Marshal(webAuthnStoredCredential{
			CredentialID: "",
			PublicKey:    "",
			SignCount:    0,
			AAGUID:       "",
		})
		if err != nil {
			return err
		}

		if _, err := tx.SaveChannel(ctx, store.Channel{
			UUID:            input.UUID,
			State:           store.ChannelStateWaiting,
			CreatedAt:       now,
			ExpiresAt:       now.Add(time.Duration(ttlMS) * time.Millisecond),
			TTLMS:           ttlMS,
			SecurityProfile: toStoreSecurityProfile(input.SecurityProfile),
			AdminMode:       &adminMode,
			AdminCredential: placeholderCredential,
			LockKey:         &lockKeyPlaceholder,
			Version:         0,
		}); err != nil {
			if errors.Is(err, store.ErrChannelTombstoned) {
				return lockForbidden("channel already exists")
			}
			return err
		}

		_, err = tx.SaveChallenge(ctx, store.ActiveChallenge{
			Kind:           store.ChallengeKindCreate,
			ChallengeValue: stringPtr(challenge),
			IssuedAt:       timePtr(now),
		})
		return err
	})
	if err != nil {
		return CreateBeginOutput{}, mapProtocolError(err)
	}

	return CreateBeginOutput{
		OK: true,
		CreationOptions: map[string]any{
			"challenge": challenge,
			"rp": map[string]any{
				"name": "ZeroLink",
				"id":   s.rpID,
			},
			"user": map[string]any{
				"id":          encodeBase64URL([]byte(input.UUID)),
				"name":        fmt.Sprintf("zerolink-%s", input.UUID),
				"displayName": fmt.Sprintf("ZeroLink (%s)", input.UUID),
			},
			"pubKeyCredParams": []map[string]any{
				{"type": "public-key", "alg": -7},
			},
			"authenticatorSelection": map[string]any{
				"userVerification":   ternary(input.SecurityProfile == string(store.SecurityProfileSecure), "required", "preferred"),
				"residentKey":        "discouraged",
				"requireResidentKey": false,
			},
			"attestation": "none",
			"timeout":     60000,
		},
	}, nil
}

func (s *ProtocolService) CreateFinish(ctx context.Context, input CreateFinishInput) (CreateFinishOutput, error) {
	if s.db == nil {
		return CreateFinishOutput{}, internalError(errProtocolNilDB)
	}
	if s.verifier == nil {
		return CreateFinishOutput{}, internalError(errProtocolNilVerifier)
	}

	if err := validateCreateFinishInput(input); err != nil {
		return CreateFinishOutput{}, err
	}

	now := s.now().UTC()
	err := s.db.WithChannelTx(ctx, input.UUID, func(ctx context.Context, tx *store.ChannelTx) error {
		channel, err := tx.LoadActiveChannel(ctx, now)
		if err != nil {
			return err
		}
		if channel == nil {
			return notFound("channel not found")
		}

		if channel.LockKey != nil && *channel.LockKey != "" {
			return lockForbidden("channel already finalized")
		}

		if channel.SecurityProfile == store.SecurityProfileSecure && input.AdminMode != string(store.AdminModeWebAuthn) {
			return lockForbidden("secure channels require webauthn")
		}

		adminCredential, err := s.resolveAdminCredential(ctx, tx, channel, input)
		if err != nil {
			return err
		}

		adminMode := store.AdminMode(input.AdminMode)
		channel.AdminMode = &adminMode
		channel.AdminCredential = adminCredential
		channel.LockKey = stringPtr(input.LockKeyB64u)

		if _, err := tx.SaveChannel(ctx, *channel); err != nil {
			if errors.Is(err, store.ErrChannelTombstoned) {
				return notFound("channel not found")
			}
			return err
		}

		return tx.DeleteChallenge(ctx, store.ChallengeKindCreate)
	})
	if err != nil {
		return CreateFinishOutput{}, mapProtocolError(err)
	}

	return CreateFinishOutput{
		OK:        true,
		ShareURL:  fmt.Sprintf("%s/s/%s", s.rpOrigin, input.UUID),
		ManageURL: fmt.Sprintf("%s/m/%s", s.rpOrigin, input.UUID),
	}, nil
}

func (s *ProtocolService) PublicStatus(ctx context.Context, uuid string) (PublicStatusOutput, error) {
	if s.db == nil {
		return PublicStatusOutput{}, internalError(errProtocolNilDB)
	}
	if !isValidUUID(uuid) {
		return PublicStatusOutput{}, badRequest("invalid uuid")
	}

	now := s.now().UTC()
	var output PublicStatusOutput
	var channelNotFound bool

	err := s.db.WithChannelTx(ctx, uuid, func(ctx context.Context, tx *store.ChannelTx) error {
		channel, err := tx.LoadActiveChannel(ctx, now)
		if errors.Is(err, store.ErrChannelNotFound) {
			channelNotFound = true
			return nil // commit so any tombstone written by lazy expiry finalization is persisted
		}
		if err != nil {
			return err
		}

		adminMode := string(store.AdminModeWebAuthn)
		if channel.AdminMode != nil && *channel.AdminMode != "" {
			adminMode = string(*channel.AdminMode)
		}

		output = PublicStatusOutput{
			OK:              true,
			State:           string(channel.State),
			AdminMode:       adminMode,
			SecurityProfile: string(channel.SecurityProfile),
		}
		if channel.ReceiverPubFpr != nil {
			output.ReceiverPubFpr = *channel.ReceiverPubFpr
		}
		return nil
	})
	if err != nil {
		return PublicStatusOutput{}, mapProtocolError(err)
	}
	if channelNotFound {
		return PublicStatusOutput{}, notFound("channel not found")
	}

	return output, nil
}

func (s *ProtocolService) RealtimeState(ctx context.Context, uuid string) (RealtimeStateOutput, error) {
	if s.db == nil {
		return RealtimeStateOutput{}, internalError(errProtocolNilDB)
	}
	if !isValidUUID(uuid) {
		return RealtimeStateOutput{}, badRequest("invalid uuid")
	}

	now := s.now().UTC()
	var output RealtimeStateOutput

	err := s.db.WithChannelTx(ctx, uuid, func(ctx context.Context, tx *store.ChannelTx) error {
		channel, err := tx.LoadActiveChannel(ctx, now)
		if err != nil {
			return err
		}

		output = buildRealtimeState(*channel)
		return nil
	})
	if err != nil {
		return RealtimeStateOutput{}, mapProtocolError(err)
	}

	return output, nil
}

func validateCreateBeginInput(input CreateBeginInput) (int64, error) {
	if !isValidUUID(input.UUID) {
		return 0, badRequest("invalid uuid")
	}
	if input.Timestamp == nil || *input.Timestamp < 0 {
		return 0, badRequest("invalid timestamp")
	}
	if input.SecurityProfile != string(store.SecurityProfileQuick) && input.SecurityProfile != string(store.SecurityProfileSecure) {
		return 0, badRequest("invalid security profile")
	}

	if input.TTL == nil {
		return channelTTLOneHourMS, nil
	}

	switch *input.TTL {
	case channelTTLOneHourMS, channelTTLOneDayMS, channelTTLSevenDaysMS:
		return *input.TTL, nil
	default:
		return 0, badRequest("invalid ttl")
	}
}

func validateCreateFinishInput(input CreateFinishInput) error {
	if !isValidUUID(input.UUID) {
		return badRequest("invalid uuid")
	}
	if input.Timestamp == nil || *input.Timestamp < 0 {
		return badRequest("invalid timestamp")
	}
	if !isBase64URL(input.LockKeyB64u) {
		return badRequest("invalid lockKeyB64u")
	}

	switch input.AdminMode {
	case string(store.AdminModeWebAuthn):
		if input.Attestation == nil || !input.Attestation.Valid() {
			return badRequest("invalid attestation")
		}
	case string(store.AdminModePassword), string(store.AdminModeSoftkey):
		if input.SoftkeyPubJWK == nil || !input.SoftkeyPubJWK.Valid() {
			return badRequest("invalid softkeyPubJwk")
		}
	default:
		return badRequest("invalid adminMode")
	}

	return nil
}

func (a AttestationJSON) Valid() bool {
	if a.Type != "public-key" {
		return false
	}
	if !isBase64URL(a.ID) || !isBase64URL(a.RawID) {
		return false
	}
	if !isBase64URL(a.Response.ClientDataJSON) || !isBase64URL(a.Response.AttestationObject) {
		return false
	}

	for _, transport := range a.Response.Transports {
		switch transport {
		case "usb", "nfc", "ble", "smart-card", "hybrid", "internal":
		default:
			return false
		}
	}

	return true
}

func (j ECDSAPublicKeyJWK) Valid() bool {
	if j.KTY != "EC" || j.CRV != "P-256" || !j.Ext {
		return false
	}
	if !isBase64URL(j.X) || !isBase64URL(j.Y) {
		return false
	}
	if len(j.KeyOps) != 1 || j.KeyOps[0] != "verify" {
		return false
	}
	return true
}

func mapProtocolError(err error) error {
	if err == nil {
		return nil
	}

	var protocolErr *ProtocolError
	if errors.As(err, &protocolErr) {
		return protocolErr
	}
	if errors.Is(err, store.ErrNonceReplay) {
		return nonceReplay("nonce already consumed")
	}
	if errors.Is(err, store.ErrChannelNotFound) || errors.Is(err, store.ErrChannelTombstoned) {
		return notFound("channel not found")
	}
	return internalError(err)
}

func badRequest(message string) error {
	return &ProtocolError{Code: "BAD_REQUEST", Status: 400, Message: message}
}

func challengeInvalid(message string) error {
	return &ProtocolError{Code: "CHALLENGE_INVALID", Status: 401, Message: message}
}

func challengeConsumed(message string) error {
	return &ProtocolError{Code: "CHALLENGE_CONSUMED", Status: 409, Message: message}
}

func lockForbidden(message string) error {
	return &ProtocolError{Code: "LOCK_FORBIDDEN", Status: 403, Message: message}
}

func versionMismatch(message string) error {
	return &ProtocolError{Code: "VERSION_MISMATCH", Status: 409, Message: message}
}

func nonceReplay(message string) error {
	return &ProtocolError{Code: "NONCE_REPLAY", Status: 409, Message: message}
}

func timestampOutOfRange(message string) error {
	return &ProtocolError{Code: "TIMESTAMP_OUT_OF_RANGE", Status: 400, Message: message}
}

func intentHashMismatch(message string) error {
	return &ProtocolError{Code: "INTENT_HASH_MISMATCH", Status: 400, Message: message}
}

func cipherBundleInvalid(message string) error {
	return &ProtocolError{Code: "CIPHER_BUNDLE_INVALID", Status: 400, Message: message}
}

func assertionInvalid(message string) error {
	return &ProtocolError{Code: "ASSERTION_INVALID", Status: 403, Message: message}
}

func rateLimited(message string, retryAfterSeconds int) error {
	if retryAfterSeconds < 1 {
		retryAfterSeconds = 1
	}
	return &ProtocolError{
		Code:              "RATE_LIMITED",
		Status:            429,
		Message:           message,
		RetryAfterSeconds: retryAfterSeconds,
	}
}

func attestationUnverifiable(message string) error {
	return &ProtocolError{Code: "ATTESTATION_UNVERIFIABLE", Status: 403, Message: message}
}

func channelNotDelivered(message string) error {
	return &ProtocolError{Code: "CHANNEL_NOT_DELIVERED", Status: 409, Message: message}
}

func notFound(message string) error {
	return &ProtocolError{Code: "NOT_FOUND", Status: 404, Message: message}
}

func internalError(err error) error {
	return &ProtocolError{Code: "INTERNAL_ERROR", Status: 500, Message: "unexpected internal error", Cause: err}
}

func toStoreSecurityProfile(value string) store.SecurityProfile {
	if value == string(store.SecurityProfileSecure) {
		return store.SecurityProfileSecure
	}
	return store.SecurityProfileQuick
}

func isValidUUID(value string) bool {
	return len(value) == uuidLength && uuidPattern.MatchString(value)
}

func isBase64URL(value string) bool {
	return value != "" && base64URLPattern.MatchString(value)
}

func encodeBase64URL(value []byte) string {
	return base64.RawURLEncoding.EncodeToString(value)
}

func stringPtr(value string) *string {
	return &value
}

func timePtr(value time.Time) *time.Time {
	utcValue := value.UTC()
	return &utcValue
}

func ternary[T any](condition bool, left T, right T) T {
	if condition {
		return left
	}
	return right
}

func buildRealtimeState(channel store.Channel) RealtimeStateOutput {
	return RealtimeStateOutput{
		ChannelID:       channel.UUID,
		State:           string(channel.State),
		Version:         channel.Version,
		AdminMode:       string(resolveChannelAdminMode(&channel)),
		SecurityProfile: string(channel.SecurityProfile),
		ReceiverPubFpr:  stringValue(channel.ReceiverPubFpr),
		ExpiresAt:       channel.ExpiresAt.UTC(),
	}
}

func stringValue(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}
