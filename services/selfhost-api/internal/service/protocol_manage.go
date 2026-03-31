package service

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/subtle"
	"crypto/x509"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"time"

	"github.com/yclgkd/ZeroLink/services/selfhost-api/internal/store"
	"github.com/yclgkd/ZeroLink/services/selfhost-api/internal/webauthn"
)

const (
	lockChallengeIDBytes     = 16
	compoundChallengeIDBytes = 16
	challengeTTLMS           = int64(60_000)
	nonceTTLMS               = int64(600_000)
	timestampSkewMS          = int64(120_000)
	padBlockMax              = int64(65_536)
)

type LockBeginInput struct {
	UUID string `json:"uuid"`
}

type LockBeginOutput struct {
	OK            bool          `json:"ok"`
	LockChallenge LockChallenge `json:"lockChallenge"`
}

type LockChallenge struct {
	ID        string `json:"id"`
	Challenge string `json:"challenge"`
	ExpiresAt int64  `json:"expiresAt"`
}

type LockCommitInput struct {
	UUID            string          `json:"uuid"`
	LockChallengeID string          `json:"lockChallengeId"`
	LockProof       string          `json:"lockProof"`
	ReceiverPubJWK  RSAPublicKeyJWK `json:"receiverPubJwk"`
	ReceiverPubFpr  string          `json:"receiverPubFpr"`
	LockedAt        int64           `json:"lockedAt"`
}

type LockCommitOutput struct {
	OK bool `json:"ok"`
}

type CompoundBeginInput struct {
	UUID string `json:"uuid"`
}

type CompoundChallenge struct {
	ID        string `json:"id"`
	Seed      string `json:"seed"`
	ExpiresAt int64  `json:"expiresAt"`
}

type PublicKeyCredentialDescriptorJSON struct {
	ID   string `json:"id"`
	Type string `json:"type"`
}

type CompoundBeginOutput struct {
	OK               bool                                `json:"ok"`
	Challenge        CompoundChallenge                   `json:"challenge"`
	AllowCredentials []PublicKeyCredentialDescriptorJSON `json:"allowCredentials,omitempty"`
	ReceiverPubFpr   string                              `json:"receiverPubFpr,omitempty"`
	ReceiverPubJWK   *RSAPublicKeyJWK                    `json:"receiverPubJwk,omitempty"`
	CurrentVersion   int64                               `json:"currentVersion"`
	SecurityProfile  string                              `json:"securityProfile"`
	AdminMode        string                              `json:"adminMode"`
}

type AssertionJSON struct {
	ID       string                `json:"id"`
	RawID    string                `json:"rawId"`
	Type     string                `json:"type"`
	Response AssertionResponseJSON `json:"response"`
}

type AssertionResponseJSON struct {
	ClientDataJSON    string  `json:"clientDataJSON"`
	AuthenticatorData string  `json:"authenticatorData"`
	Signature         string  `json:"signature"`
	UserHandle        *string `json:"userHandle,omitempty"`
}

type RSAPublicKeyJWK struct {
	KTY    string   `json:"kty"`
	ALG    string   `json:"alg"`
	N      string   `json:"n"`
	E      string   `json:"e"`
	Ext    bool     `json:"ext"`
	KeyOps []string `json:"key_ops"`
}

type CipherBundle struct {
	Ciphertext     string `json:"ciphertext"`
	IV             string `json:"iv"`
	AAD            string `json:"aad"`
	EncContentKey  string `json:"encContentKey"`
	CiphertextHash string `json:"ciphertextHash"`
	PadBlock       int64  `json:"padBlock"`
}

type ManageIntent struct {
	Op             string          `json:"op"`
	UUID           string          `json:"uuid"`
	Version        int64           `json:"version"`
	Timestamp      int64           `json:"timestamp"`
	Nonce          string          `json:"nonce"`
	ReceiverPubFpr string          `json:"receiverPubFpr,omitempty"`
	CipherBundle   *CipherBundle   `json:"cipherBundle,omitempty"`
	ExpireAt       json.RawMessage `json:"expireAt,omitempty"`
}

type CompoundCommitInput struct {
	AdminMode        string         `json:"adminMode,omitempty"`
	UUID             string         `json:"uuid"`
	Assertion        *AssertionJSON `json:"assertion,omitempty"`
	SoftkeySignature string         `json:"softkeySignature,omitempty"`
	IntentHash       string         `json:"intentHash"`
	Intent           ManageIntent   `json:"intent"`
}

type CompoundCommitOutput struct {
	OK bool `json:"ok"`
}

type DecryptFetchOutput struct {
	OK             bool            `json:"ok"`
	CipherBundle   CipherBundle    `json:"cipherBundle"`
	ReceiverPubFpr string          `json:"receiverPubFpr"`
	CipherVersion  int64           `json:"cipherVersion"`
	DeliveryAuth   json.RawMessage `json:"deliveryAuth,omitempty"`
	DeliveredAt    int64           `json:"deliveredAt"`
}

func (s *ProtocolService) LockBegin(ctx context.Context, input LockBeginInput) (LockBeginOutput, error) {
	if s.db == nil {
		return LockBeginOutput{}, internalError(errProtocolNilDB)
	}
	if !isValidUUID(input.UUID) {
		return LockBeginOutput{}, badRequest("invalid uuid")
	}

	now := s.now().UTC()
	var output LockBeginOutput

	err := s.db.WithChannelTx(ctx, input.UUID, func(ctx context.Context, tx *store.ChannelTx) error {
		channel, err := tx.LoadActiveChannel(ctx, now)
		if err != nil {
			return err
		}
		if channel.State != store.ChannelStateWaiting {
			return lockForbidden("lock transition requires waiting state")
		}
		if channel.LockKey == nil || *channel.LockKey == "" {
			return lockForbidden("channel is not ready to lock")
		}

		activeChallenge, err := tx.GetChallenge(ctx, store.ChallengeKindLock)
		if err != nil {
			return err
		}
		if activeChallenge != nil &&
			activeChallenge.ConsumedAt == nil &&
			activeChallenge.ExpiresAt != nil &&
			activeChallenge.ExpiresAt.After(now) &&
			activeChallenge.ChallengeID != nil &&
			activeChallenge.ChallengeValue != nil {
			output = LockBeginOutput{
				OK: true,
				LockChallenge: LockChallenge{
					ID:        *activeChallenge.ChallengeID,
					Challenge: *activeChallenge.ChallengeValue,
					ExpiresAt: activeChallenge.ExpiresAt.UTC().UnixMilli(),
				},
			}
			return nil
		}

		if err := s.enforceRateLimit(protocolRateLimitLockBegin, input.UUID, now); err != nil {
			return err
		}

		challengeID, err := s.randomBase64URL(lockChallengeIDBytes)
		if err != nil {
			return err
		}
		challengeValue, err := s.randomBase64URL(createChallengeBytes)
		if err != nil {
			return err
		}
		expiresAt := now.Add(time.Duration(challengeTTLMS) * time.Millisecond)

		if _, err := tx.SaveChallenge(ctx, store.ActiveChallenge{
			Kind:           store.ChallengeKindLock,
			ChallengeID:    stringPtr(challengeID),
			ChallengeValue: stringPtr(challengeValue),
			IssuedAt:       timePtr(now),
			ExpiresAt:      timePtr(expiresAt),
		}); err != nil {
			return err
		}

		output = LockBeginOutput{
			OK: true,
			LockChallenge: LockChallenge{
				ID:        challengeID,
				Challenge: challengeValue,
				ExpiresAt: expiresAt.UnixMilli(),
			},
		}
		return nil
	})
	if err != nil {
		return LockBeginOutput{}, mapProtocolError(err)
	}

	return output, nil
}

func (s *ProtocolService) LockCommit(ctx context.Context, input LockCommitInput) (LockCommitOutput, error) {
	if s.db == nil {
		return LockCommitOutput{}, internalError(errProtocolNilDB)
	}
	if err := input.Validate(); err != nil {
		return LockCommitOutput{}, err
	}

	now := s.now().UTC()
	err := s.db.WithChannelTx(ctx, input.UUID, func(ctx context.Context, tx *store.ChannelTx) error {
		channel, err := tx.LoadActiveChannel(ctx, now)
		if err != nil {
			return err
		}
		if channel.State != store.ChannelStateWaiting {
			return lockForbidden("lock transition requires waiting state")
		}
		if channel.LockKey == nil || *channel.LockKey == "" {
			return lockForbidden("channel is not ready to lock")
		}

		challenge, err := tx.GetChallenge(ctx, store.ChallengeKindLock)
		if err != nil {
			return err
		}
		if challenge == nil || challenge.ChallengeID == nil || challenge.ChallengeValue == nil {
			return challengeInvalid("lock challenge not found")
		}
		if challenge.ExpiresAt == nil || !challenge.ExpiresAt.After(now) {
			if err := tx.DeleteChallenge(ctx, store.ChallengeKindLock); err != nil {
				return err
			}
			return challengeInvalid("lock challenge expired")
		}
		if challenge.ConsumedAt != nil {
			return challengeConsumed("lock challenge already consumed")
		}
		if *challenge.ChallengeID != input.LockChallengeID {
			return challengeInvalid("lock challenge not found")
		}
		if err := s.enforceRateLimit(protocolRateLimitLockCommit, input.UUID, now); err != nil {
			return err
		}

		expectedProof, err := computeLockProof(input.UUID, input.LockChallengeID, *challenge.ChallengeValue, *channel.LockKey)
		if err != nil {
			return err
		}
		if !constantTimeEqualString(expectedProof, input.LockProof) {
			return lockForbidden("lock proof mismatch")
		}

		computedFpr, err := computeReceiverFingerprint(input.ReceiverPubJWK)
		if err != nil {
			return lockForbidden("invalid receiver public key JWK")
		}
		if !constantTimeEqualString(computedFpr, input.ReceiverPubFpr) {
			return lockForbidden("receiverPubFpr does not match SHA256(SPKI(receiverPubJwk))")
		}

		channel.State = store.ChannelStateLocked
		receiverPubJWK, err := json.Marshal(input.ReceiverPubJWK)
		if err != nil {
			return badRequest("invalid receiverPubJwk")
		}
		lockedAt := unixMilliToTime(input.LockedAt)
		channel.ReceiverPubJWK = receiverPubJWK
		channel.ReceiverPubFpr = stringPtr(input.ReceiverPubFpr)
		channel.LockedAt = &lockedAt
		if _, err := tx.SaveChannel(ctx, *channel); err != nil {
			return err
		}
		if _, err := tx.MarkChallengeConsumed(ctx, store.ChallengeKindLock, now); err != nil {
			return err
		}

		return nil
	})
	if err != nil {
		return LockCommitOutput{}, mapProtocolError(err)
	}

	return LockCommitOutput{OK: true}, nil
}

func (s *ProtocolService) CompoundBegin(ctx context.Context, input CompoundBeginInput) (CompoundBeginOutput, error) {
	if s.db == nil {
		return CompoundBeginOutput{}, internalError(errProtocolNilDB)
	}
	if !isValidUUID(input.UUID) {
		return CompoundBeginOutput{}, badRequest("invalid uuid")
	}

	now := s.now().UTC()
	var output CompoundBeginOutput

	err := s.db.WithChannelTx(ctx, input.UUID, func(ctx context.Context, tx *store.ChannelTx) error {
		channel, err := tx.LoadActiveChannel(ctx, now)
		if err != nil {
			return err
		}

		activeChallenge, err := tx.GetChallenge(ctx, store.ChallengeKindCompound)
		if err != nil {
			return err
		}
		if activeChallenge == nil ||
			activeChallenge.ConsumedAt != nil ||
			activeChallenge.ExpiresAt == nil ||
			!activeChallenge.ExpiresAt.After(now) ||
			activeChallenge.ChallengeID == nil ||
			activeChallenge.ChallengeSeed == nil {
			if err := s.enforceRateLimit(protocolRateLimitCompoundBegin, input.UUID, now); err != nil {
				return err
			}
			challengeID, err := s.randomBase64URL(compoundChallengeIDBytes)
			if err != nil {
				return err
			}
			challengeSeed, err := s.randomBase64URL(createChallengeBytes)
			if err != nil {
				return err
			}
			expiresAt := now.Add(time.Duration(challengeTTLMS) * time.Millisecond)

			activeChallenge, err = tx.SaveChallenge(ctx, store.ActiveChallenge{
				Kind:          store.ChallengeKindCompound,
				ChallengeID:   stringPtr(challengeID),
				ChallengeSeed: stringPtr(challengeSeed),
				IssuedAt:      timePtr(now),
				ExpiresAt:     timePtr(expiresAt),
			})
			if err != nil {
				return err
			}
		}

		adminMode := resolveChannelAdminMode(channel)
		output = CompoundBeginOutput{
			OK: true,
			Challenge: CompoundChallenge{
				ID:        *activeChallenge.ChallengeID,
				Seed:      *activeChallenge.ChallengeSeed,
				ExpiresAt: activeChallenge.ExpiresAt.UTC().UnixMilli(),
			},
			CurrentVersion:  channel.Version,
			SecurityProfile: string(channel.SecurityProfile),
			AdminMode:       string(adminMode),
		}

		if adminMode == store.AdminModeWebAuthn {
			credential, err := decodeStoredWebAuthnCredential(channel.AdminCredential)
			if err != nil {
				return err
			}
			if credential.CredentialID != "" {
				output.AllowCredentials = []PublicKeyCredentialDescriptorJSON{
					{ID: credential.CredentialID, Type: "public-key"},
				}
			}
		}

		if channel.ReceiverPubFpr != nil {
			output.ReceiverPubFpr = *channel.ReceiverPubFpr
		}
		if len(channel.ReceiverPubJWK) > 0 {
			var receiverPubJWK RSAPublicKeyJWK
			if err := json.Unmarshal(channel.ReceiverPubJWK, &receiverPubJWK); err != nil {
				return err
			}
			output.ReceiverPubJWK = &receiverPubJWK
		}

		return nil
	})
	if err != nil {
		return CompoundBeginOutput{}, mapProtocolError(err)
	}

	return output, nil
}

func (s *ProtocolService) CompoundCommit(ctx context.Context, input CompoundCommitInput) (CompoundCommitOutput, error) {
	if s.db == nil {
		return CompoundCommitOutput{}, internalError(errProtocolNilDB)
	}
	if s.verifier == nil {
		return CompoundCommitOutput{}, internalError(errProtocolNilVerifier)
	}
	if err := input.Validate(); err != nil {
		return CompoundCommitOutput{}, err
	}

	now := s.now().UTC()
	intentHash, err := input.Intent.ComputeHash()
	if err != nil {
		return CompoundCommitOutput{}, badRequest("invalid intent")
	}
	if !constantTimeEqualString(intentHash, input.IntentHash) {
		return CompoundCommitOutput{}, intentHashMismatch("intent hash does not match")
	}
	if absInt64(input.Intent.Timestamp-now.UnixMilli()) > timestampSkewMS {
		return CompoundCommitOutput{}, timestampOutOfRange(
			fmt.Sprintf("timestamp skew exceeds %dms", timestampSkewMS),
		)
	}

	err = s.db.WithChannelTx(ctx, input.UUID, func(ctx context.Context, tx *store.ChannelTx) error {
		channel, err := tx.LoadActiveChannel(ctx, now)
		if err != nil {
			return err
		}

		if input.Intent.UUID != channel.UUID {
			return lockForbidden("intent uuid mismatch")
		}
		if input.Intent.Version != channel.Version {
			return versionMismatch(
				fmt.Sprintf("expected version %d, got %d", channel.Version, input.Intent.Version),
			)
		}

		challenge, err := tx.GetChallenge(ctx, store.ChallengeKindCompound)
		if err != nil {
			return err
		}
		if challenge == nil || challenge.ChallengeID == nil || challenge.ChallengeSeed == nil {
			return challengeInvalid("compound challenge not found")
		}
		if challenge.ExpiresAt == nil || !challenge.ExpiresAt.After(now) {
			if err := tx.DeleteChallenge(ctx, store.ChallengeKindCompound); err != nil {
				return err
			}
			return challengeInvalid("compound challenge expired")
		}
		if challenge.ConsumedAt != nil {
			return challengeConsumed("compound challenge already consumed")
		}

		adminMode := resolveChannelAdminMode(channel)
		expectedChallengeBytes, err := computeExpectedCompoundChallengeBytes(channel.UUID, input.IntentHash, challenge, input.Intent.Op)
		if err != nil {
			return err
		}
		if err := s.enforceRateLimit(protocolRateLimitCompoundCommit, input.UUID, now); err != nil {
			return err
		}

		if adminMode == store.AdminModeWebAuthn {
			credential, err := decodeStoredWebAuthnCredential(channel.AdminCredential)
			if err != nil {
				return err
			}
			if input.Assertion == nil || input.AdminMode == string(store.AdminModePassword) || input.AdminMode == string(store.AdminModeSoftkey) {
				return assertionInvalid("webauthn commit payload required for webauthn channel")
			}

			assertionResult, err := s.verifier.VerifyAssertion(ctx, webauthn.AssertionInput{
				ChannelID:               channel.UUID,
				AssertionID:             input.Assertion.ID,
				ClientDataJSONB64u:      input.Assertion.Response.ClientDataJSON,
				AuthenticatorDataB64u:   input.Assertion.Response.AuthenticatorData,
				SignatureB64u:           input.Assertion.Response.Signature,
				ExpectedRPID:            s.rpID,
				ExpectedOrigin:          s.rpOrigin,
				ExpectedChallenge:       expectedChallengeBytes,
				StoredCredentialID:      credential.CredentialID,
				StoredPublicKey:         credential.PublicKey,
				StoredSignCount:         credential.SignCount,
				RequireUserVerification: true,
			})
			if err != nil {
				return assertionInvalid(err.Error())
			}

			if input.Intent.Op == "delete" {
				_, err := tx.FinalizeTerminalState(ctx, store.TerminalReasonDeleted, now)
				return err
			}

			if channel.State != store.ChannelStateLocked && channel.State != store.ChannelStateDelivered {
				return lockForbidden("delivery transition requires locked or delivered state")
			}
			if channel.ReceiverPubFpr == nil {
				return lockForbidden("delivery requires a locked receiver identity")
			}
			if input.Intent.ReceiverPubFpr != *channel.ReceiverPubFpr {
				return lockForbidden("intent receiverPubFpr does not match locked receiver fingerprint")
			}

			expireAt, err := input.Intent.ParseExpireAt()
			if err != nil {
				return badRequest("invalid intent")
			}
			if expireAt != nil && *expireAt <= now.UnixMilli() {
				return timestampOutOfRange("expireAt must be a future timestamp")
			}

			if err := validateCipherBundle(*input.Intent.CipherBundle, input.Intent, *channel.ReceiverPubFpr); err != nil {
				return err
			}

			credential.SignCount = assertionResult.NewSignCount
			channel.AdminCredential, err = json.Marshal(credential)
			if err != nil {
				return err
			}

			return s.applyDelivery(ctx, tx, channel, input, now, expireAt)
		}

		softkeyCredential, err := decodeStoredSoftkeyCredential(channel.AdminCredential)
		if err != nil {
			return err
		}
		if input.AdminMode != string(store.AdminModePassword) && input.AdminMode != string(store.AdminModeSoftkey) {
			return assertionInvalid("password commit payload required for password/softkey channel")
		}
		if err := verifySoftkeySignature(softkeyCredential.SoftkeyPubJWK, expectedChallengeBytes, input.SoftkeySignature); err != nil {
			return assertionInvalid(err.Error())
		}

		if input.Intent.Op == "delete" {
			_, err := tx.FinalizeTerminalState(ctx, store.TerminalReasonDeleted, now)
			return err
		}

		if channel.State != store.ChannelStateLocked && channel.State != store.ChannelStateDelivered {
			return lockForbidden("delivery transition requires locked or delivered state")
		}
		if channel.ReceiverPubFpr == nil {
			return lockForbidden("delivery requires a locked receiver identity")
		}
		if input.Intent.ReceiverPubFpr != *channel.ReceiverPubFpr {
			return lockForbidden("intent receiverPubFpr does not match locked receiver fingerprint")
		}

		expireAt, err := input.Intent.ParseExpireAt()
		if err != nil {
			return badRequest("invalid intent")
		}
		if expireAt != nil && *expireAt <= now.UnixMilli() {
			return timestampOutOfRange("expireAt must be a future timestamp")
		}

		if err := validateCipherBundle(*input.Intent.CipherBundle, input.Intent, *channel.ReceiverPubFpr); err != nil {
			return err
		}

		return s.applyDelivery(ctx, tx, channel, input, now, expireAt)
	})
	if err != nil {
		return CompoundCommitOutput{}, mapProtocolError(err)
	}

	return CompoundCommitOutput{OK: true}, nil
}

func (s *ProtocolService) applyDelivery(
	ctx context.Context,
	tx *store.ChannelTx,
	channel *store.Channel,
	input CompoundCommitInput,
	now time.Time,
	expireAt *int64,
) error {
	expiresAt := channel.CreatedAt.Add(time.Duration(channel.TTLMS) * time.Millisecond)
	if expireAt != nil {
		expiresAt = unixMilliToTime(*expireAt)
	}

	cipherBundle, err := json.Marshal(input.Intent.CipherBundle)
	if err != nil {
		return err
	}
	updateProof, err := buildStoredUpdateDeliveryProofJSON(resolveChannelAdminMode(channel), input)
	if err != nil {
		return err
	}

	channel.State = store.ChannelStateDelivered
	channel.CipherBundle = cipherBundle
	channel.UpdateDeliveryProof = updateProof
	deliveredAt := unixMilliToTime(input.Intent.Timestamp)
	channel.DeliveredAt = &deliveredAt
	channel.ExpiresAt = expiresAt
	channel.Version++

	if _, err := tx.SaveChannel(ctx, *channel); err != nil {
		return err
	}
	if _, err := tx.MarkChallengeConsumed(ctx, store.ChallengeKindCompound, now); err != nil {
		return err
	}
	if err := tx.RegisterNonce(
		ctx,
		input.Intent.Nonce,
		now,
		now.Add(time.Duration(nonceTTLMS)*time.Millisecond),
	); err != nil {
		return err
	}

	return nil
}

func (s *ProtocolService) DecryptFetch(ctx context.Context, uuid string) (DecryptFetchOutput, error) {
	if s.db == nil {
		return DecryptFetchOutput{}, internalError(errProtocolNilDB)
	}
	if !isValidUUID(uuid) {
		return DecryptFetchOutput{}, badRequest("invalid uuid")
	}

	now := s.now().UTC()
	var output DecryptFetchOutput

	err := s.db.WithChannelTx(ctx, uuid, func(ctx context.Context, tx *store.ChannelTx) error {
		channel, err := tx.LoadActiveChannel(ctx, now)
		if err != nil {
			return err
		}
		if channel.State != store.ChannelStateDelivered || len(channel.CipherBundle) == 0 || channel.DeliveredAt == nil || channel.ReceiverPubFpr == nil {
			return channelNotDelivered("ciphertext is not available yet")
		}

		var cipherBundle CipherBundle
		if err := json.Unmarshal(channel.CipherBundle, &cipherBundle); err != nil {
			return err
		}

		output = DecryptFetchOutput{
			OK:             true,
			CipherBundle:   cipherBundle,
			ReceiverPubFpr: *channel.ReceiverPubFpr,
			CipherVersion:  channel.Version - 1,
			DeliveredAt:    channel.DeliveredAt.UTC().UnixMilli(),
		}

		if len(channel.UpdateDeliveryProof) == 0 {
			return nil
		}

		deliveryAuth, err := buildDecryptFetchDeliveryAuthJSON(channel)
		if err != nil {
			return err
		}
		output.DeliveryAuth = deliveryAuth
		return nil
	})
	if err != nil {
		return DecryptFetchOutput{}, mapProtocolError(err)
	}

	return output, nil
}

func (input LockCommitInput) Validate() error {
	if !isValidUUID(input.UUID) {
		return badRequest("invalid uuid")
	}
	if !isBase64URL(input.LockChallengeID) {
		return badRequest("invalid lockChallengeId")
	}
	if !isLowerHex(input.LockProof, 0) {
		return badRequest("invalid lockProof")
	}
	if !input.ReceiverPubJWK.Valid() {
		return badRequest("invalid receiverPubJwk")
	}
	if !isLowerHex(input.ReceiverPubFpr, 64) {
		return badRequest("invalid receiverPubFpr")
	}
	if input.LockedAt < 0 {
		return badRequest("invalid lockedAt")
	}
	return nil
}

func (input CompoundCommitInput) Validate() error {
	if !isValidUUID(input.UUID) {
		return badRequest("invalid uuid")
	}
	if !isLowerHex(input.IntentHash, 64) {
		return badRequest("invalid intentHash")
	}
	if err := input.Intent.Validate(); err != nil {
		return err
	}
	hasAssertion := input.Assertion != nil
	hasSoftkey := input.SoftkeySignature != ""

	switch {
	case hasAssertion:
		if input.AdminMode != "" || hasSoftkey {
			return badRequest("invalid compound commit payload")
		}
		if !input.Assertion.Valid() {
			return badRequest("invalid assertion")
		}
	case hasSoftkey:
		if input.AdminMode != string(store.AdminModePassword) && input.AdminMode != string(store.AdminModeSoftkey) {
			return badRequest("invalid compound commit payload")
		}
		if !isLowerHex(input.SoftkeySignature, 0) {
			return badRequest("invalid softkeySignature")
		}
	case input.AdminMode != "":
		return badRequest("invalid compound commit payload")
	default:
		return badRequest("invalid compound commit payload")
	}
	return nil
}

func (intent ManageIntent) Validate() error {
	if intent.Op != "update" && intent.Op != "delete" {
		return badRequest("invalid intent")
	}
	if !isValidUUID(intent.UUID) {
		return badRequest("invalid intent")
	}
	if intent.Version < 0 || intent.Timestamp < 0 {
		return badRequest("invalid intent")
	}
	if !isBase64URL(intent.Nonce) {
		return badRequest("invalid intent")
	}

	switch intent.Op {
	case "update":
		if len(intent.ExpireAt) == 0 {
			return badRequest("invalid intent")
		}
		if !isLowerHex(intent.ReceiverPubFpr, 64) || intent.CipherBundle == nil || !intent.CipherBundle.Valid() {
			return badRequest("invalid intent")
		}
		if _, err := intent.ParseExpireAt(); err != nil {
			return badRequest("invalid intent")
		}
	case "delete":
		if len(intent.ExpireAt) > 0 {
			if _, err := intent.ParseExpireAt(); err != nil {
				return badRequest("invalid intent")
			}
		}
	}

	return nil
}

func (intent ManageIntent) ComputeHash() (string, error) {
	canonicalJSON, err := json.Marshal(intent.CanonicalValue())
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(canonicalJSON)
	return hex.EncodeToString(sum[:]), nil
}

func (intent ManageIntent) CanonicalValue() map[string]any {
	switch intent.Op {
	case "update":
		expireAt, _ := intent.ParseExpireAt()
		return map[string]any{
			"op":             intent.Op,
			"uuid":           intent.UUID,
			"version":        intent.Version,
			"timestamp":      intent.Timestamp,
			"nonce":          intent.Nonce,
			"receiverPubFpr": intent.ReceiverPubFpr,
			"cipherBundle": map[string]any{
				"ciphertext":     intent.CipherBundle.Ciphertext,
				"iv":             intent.CipherBundle.IV,
				"aad":            intent.CipherBundle.AAD,
				"encContentKey":  intent.CipherBundle.EncContentKey,
				"ciphertextHash": intent.CipherBundle.CiphertextHash,
				"padBlock":       intent.CipherBundle.PadBlock,
			},
			"expireAt": nullableInt64ToAny(expireAt),
		}
	default:
		return map[string]any{
			"op":        intent.Op,
			"uuid":      intent.UUID,
			"version":   intent.Version,
			"timestamp": intent.Timestamp,
			"nonce":     intent.Nonce,
		}
	}
}

func (intent ManageIntent) ParseExpireAt() (*int64, error) {
	if len(intent.ExpireAt) == 0 {
		return nil, nil
	}
	if string(intent.ExpireAt) == "null" {
		return nil, nil
	}
	var value int64
	if err := json.Unmarshal(intent.ExpireAt, &value); err != nil {
		return nil, err
	}
	if value < 0 {
		return nil, errors.New("invalid expireAt")
	}
	return &value, nil
}

func (bundle CipherBundle) Valid() bool {
	return isBase64URL(bundle.Ciphertext) &&
		isBase64URL(bundle.IV) &&
		isBase64URL(bundle.AAD) &&
		isBase64URL(bundle.EncContentKey) &&
		isLowerHex(bundle.CiphertextHash, 64) &&
		bundle.PadBlock > 0 &&
		bundle.PadBlock <= padBlockMax
}

func (a AssertionJSON) Valid() bool {
	if a.Type != "public-key" {
		return false
	}
	if !isBase64URL(a.ID) || !isBase64URL(a.RawID) {
		return false
	}
	if !isBase64URL(a.Response.ClientDataJSON) ||
		!isBase64URL(a.Response.AuthenticatorData) ||
		!isBase64URL(a.Response.Signature) {
		return false
	}
	if a.Response.UserHandle != nil && *a.Response.UserHandle != "" && !isBase64URL(*a.Response.UserHandle) {
		return false
	}
	return true
}

func (j RSAPublicKeyJWK) Valid() bool {
	if j.KTY != "RSA" || j.ALG != "RSA-OAEP-256" || !j.Ext {
		return false
	}
	if !isBase64URL(j.N) || !isBase64URL(j.E) {
		return false
	}
	return len(j.KeyOps) == 1 && j.KeyOps[0] == "encrypt"
}

func validateCipherBundle(bundle CipherBundle, intent ManageIntent, receiverPubFpr string) error {
	ciphertextBytes, err := base64.RawURLEncoding.DecodeString(bundle.Ciphertext)
	if err != nil {
		return cipherBundleInvalid("cipherBundle.ciphertext is not valid base64url")
	}

	cipherHash := sha256.Sum256(ciphertextBytes)
	if !constantTimeEqualString(hex.EncodeToString(cipherHash[:]), bundle.CiphertextHash) {
		return cipherBundleInvalid("cipherBundle.ciphertextHash does not match ciphertext")
	}

	expectedAAD := encodeBase64URL([]byte(fmt.Sprintf("%s||%d||%s", intent.UUID, intent.Version, receiverPubFpr)))
	if !constantTimeEqualString(expectedAAD, bundle.AAD) {
		return cipherBundleInvalid("cipherBundle.aad does not match the expected binding")
	}

	return nil
}

func buildStoredUpdateDeliveryProofJSON(
	adminMode store.AdminMode,
	input CompoundCommitInput,
) (json.RawMessage, error) {
	meta := map[string]any{
		"version":   input.Intent.Version,
		"timestamp": input.Intent.Timestamp,
		"nonce":     input.Intent.Nonce,
		"expireAt":  nullableInt64ToAny(mustParseExpireAt(input.Intent)),
	}

	var payload map[string]any
	if adminMode == store.AdminModeWebAuthn {
		payload = map[string]any{
			"adminMode": "webauthn",
			"meta":      meta,
			"proof": map[string]any{
				"clientDataJSON":    input.Assertion.Response.ClientDataJSON,
				"authenticatorData": input.Assertion.Response.AuthenticatorData,
				"signature":         input.Assertion.Response.Signature,
			},
		}
	} else {
		payload = map[string]any{
			"adminMode": string(adminMode),
			"meta":      meta,
			"proof": map[string]any{
				"softkeySignature": input.SoftkeySignature,
			},
		}
	}

	raw, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	return raw, nil
}

func buildDecryptFetchDeliveryAuthJSON(channel *store.Channel) (json.RawMessage, error) {
	var proof map[string]any
	if err := json.Unmarshal(channel.UpdateDeliveryProof, &proof); err != nil {
		return nil, err
	}

	adminMode, _ := proof["adminMode"].(string)
	meta, _ := proof["meta"].(map[string]any)
	detachedProof, _ := proof["proof"].(map[string]any)

	var payload map[string]any
	if adminMode == "webauthn" {
		credential, err := decodeStoredWebAuthnCredential(channel.AdminCredential)
		if err != nil {
			return nil, err
		}
		payload = map[string]any{
			"adminMode": adminMode,
			"meta":      meta,
			"signer": map[string]any{
				"credentialId": credential.CredentialID,
				"publicKey":    credential.PublicKey,
			},
			"proof": detachedProof,
		}
	} else {
		credential, err := decodeStoredSoftkeyCredential(channel.AdminCredential)
		if err != nil {
			return nil, err
		}
		payload = map[string]any{
			"adminMode": adminMode,
			"meta":      meta,
			"signer": map[string]any{
				"softkeyPubJwk": credential.SoftkeyPubJWK,
			},
			"proof": detachedProof,
		}
	}

	raw, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	return raw, nil
}

func computeExpectedCompoundChallengeBytes(
	uuid string,
	intentHash string,
	challenge *store.ActiveChallenge,
	op string,
) ([]byte, error) {
	if op == "update" {
		sum := sha256.Sum256([]byte("GL-delivery-proof" + uuid + intentHash))
		return sum[:], nil
	}
	challengeIDBytes, err := base64.RawURLEncoding.DecodeString(*challenge.ChallengeID)
	if err != nil {
		return nil, err
	}
	challengeSeedBytes, err := base64.RawURLEncoding.DecodeString(*challenge.ChallengeSeed)
	if err != nil {
		return nil, err
	}

	chunks := make([]byte, 0, len("GLv2.5")+len(uuid)+len(challengeIDBytes)+len(intentHash)+len(challengeSeedBytes))
	chunks = append(chunks, []byte("GLv2.5")...)
	chunks = append(chunks, []byte(uuid)...)
	chunks = append(chunks, challengeIDBytes...)
	chunks = append(chunks, []byte(intentHash)...)
	chunks = append(chunks, challengeSeedBytes...)
	sum := sha256.Sum256(chunks)
	return sum[:], nil
}

func computeLockProof(uuid string, challengeID string, challengeValue string, lockKey string) (string, error) {
	challengeIDBytes, err := base64.RawURLEncoding.DecodeString(challengeID)
	if err != nil {
		return "", err
	}
	challengeValueBytes, err := base64.RawURLEncoding.DecodeString(challengeValue)
	if err != nil {
		return "", err
	}
	lockKeyBytes, err := base64.RawURLEncoding.DecodeString(lockKey)
	if err != nil {
		return "", err
	}

	chunks := make([]byte, 0, len("GL-lock")+len(uuid)+len(challengeIDBytes)+len(challengeValueBytes)+len(lockKeyBytes))
	chunks = append(chunks, []byte("GL-lock")...)
	chunks = append(chunks, []byte(uuid)...)
	chunks = append(chunks, challengeIDBytes...)
	chunks = append(chunks, challengeValueBytes...)
	chunks = append(chunks, lockKeyBytes...)
	sum := sha256.Sum256(chunks)
	return hex.EncodeToString(sum[:]), nil
}

func computeReceiverFingerprint(jwk RSAPublicKeyJWK) (string, error) {
	modulusBytes, err := base64.RawURLEncoding.DecodeString(jwk.N)
	if err != nil {
		return "", err
	}
	exponentBytes, err := base64.RawURLEncoding.DecodeString(jwk.E)
	if err != nil {
		return "", err
	}

	exponent := 0
	for _, value := range exponentBytes {
		exponent = (exponent << 8) | int(value)
	}
	if exponent == 0 {
		return "", errors.New("invalid exponent")
	}

	publicKey := &rsa.PublicKey{
		N: new(big.Int).SetBytes(modulusBytes),
		E: exponent,
	}
	spkiBytes, err := x509.MarshalPKIXPublicKey(publicKey)
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(spkiBytes)
	return hex.EncodeToString(sum[:]), nil
}

func verifySoftkeySignature(jwk ECDSAPublicKeyJWK, payload []byte, signatureHex string) error {
	if !jwk.Valid() {
		return errors.New("invalid softkey public key")
	}
	if len(signatureHex) != 128 || !isLowerHex(signatureHex, 128) {
		return errors.New("invalid signature hex encoding")
	}

	signatureBytes, err := hex.DecodeString(signatureHex)
	if err != nil {
		return errors.New("invalid signature hex encoding")
	}
	xBytes, err := base64.RawURLEncoding.DecodeString(jwk.X)
	if err != nil {
		return err
	}
	yBytes, err := base64.RawURLEncoding.DecodeString(jwk.Y)
	if err != nil {
		return err
	}

	publicKey := &ecdsa.PublicKey{
		Curve: elliptic.P256(),
		X:     new(big.Int).SetBytes(xBytes),
		Y:     new(big.Int).SetBytes(yBytes),
	}
	digest := sha256.Sum256(payload)
	if !ecdsa.Verify(publicKey, digest[:], new(big.Int).SetBytes(signatureBytes[:32]), new(big.Int).SetBytes(signatureBytes[32:])) {
		return errors.New("signature verification failed")
	}
	return nil
}

func decodeStoredWebAuthnCredential(raw json.RawMessage) (webAuthnStoredCredential, error) {
	var credential webAuthnStoredCredential
	if err := json.Unmarshal(raw, &credential); err != nil {
		return webAuthnStoredCredential{}, err
	}
	return credential, nil
}

func decodeStoredSoftkeyCredential(raw json.RawMessage) (softkeyStoredCredential, error) {
	var credential softkeyStoredCredential
	if err := json.Unmarshal(raw, &credential); err != nil {
		return softkeyStoredCredential{}, err
	}
	return credential, nil
}

func resolveChannelAdminMode(channel *store.Channel) store.AdminMode {
	if channel.AdminMode == nil || *channel.AdminMode == "" {
		return store.AdminModeWebAuthn
	}
	return *channel.AdminMode
}

func (s *ProtocolService) randomBase64URL(size int) (string, error) {
	buffer := make([]byte, size)
	if _, err := s.randomRead(buffer); err != nil {
		return "", internalError(fmt.Errorf("generate random challenge: %w", err))
	}
	return encodeBase64URL(buffer), nil
}

func constantTimeEqualString(left string, right string) bool {
	if len(left) != len(right) {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(left), []byte(right)) == 1
}

func isLowerHex(value string, exactLen int) bool {
	if value == "" {
		return false
	}
	if exactLen > 0 && len(value) != exactLen {
		return false
	}
	for _, r := range value {
		if (r < '0' || r > '9') && (r < 'a' || r > 'f') {
			return false
		}
	}
	return true
}

func unixMilliToTime(value int64) time.Time {
	return time.UnixMilli(value).UTC()
}

func nullableInt64ToAny(value *int64) any {
	if value == nil {
		return nil
	}
	return *value
}

func mustParseExpireAt(intent ManageIntent) *int64 {
	value, _ := intent.ParseExpireAt()
	return value
}

func absInt64(value int64) int64 {
	if value < 0 {
		return -value
	}
	return value
}
