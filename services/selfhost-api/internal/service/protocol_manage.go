package service

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/yclgkd/ZeroLink/services/selfhost-api/internal/realtime"
	"github.com/yclgkd/ZeroLink/services/selfhost-api/internal/store"
	"github.com/yclgkd/ZeroLink/services/selfhost-api/internal/store/filestore"
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
	Op             string                      `json:"op"`
	UUID           string                      `json:"uuid"`
	Version        int64                       `json:"version"`
	Timestamp      int64                       `json:"timestamp"`
	Nonce          string                      `json:"nonce"`
	ReceiverPubFpr string                      `json:"receiverPubFpr,omitempty"`
	PayloadKind    string                      `json:"payloadKind,omitempty"`
	CipherBundle   *CipherBundle               `json:"cipherBundle,omitempty"`
	FileRef        *filestore.MultipartFileRef `json:"fileRef,omitempty"`
	ExpireAt       json.RawMessage             `json:"expireAt,omitempty"`
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
	OK             bool                        `json:"ok"`
	CipherBundle   *CipherBundle               `json:"cipherBundle,omitempty"`
	FileRef        *filestore.MultipartFileRef `json:"fileRef,omitempty"`
	ReceiverPubFpr string                      `json:"receiverPubFpr"`
	CipherVersion  int64                       `json:"cipherVersion"`
	DeliveryAuth   json.RawMessage             `json:"deliveryAuth,omitempty"`
	DeliveredAt    int64                       `json:"deliveredAt"`
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
	var publishedState RealtimeStateOutput
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

		publishedState = buildRealtimeState(*channel)
		return nil
	})
	if err != nil {
		return LockCommitOutput{}, mapProtocolError(err)
	}

	s.publishRealtimeState(ctx, publishedState)
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

	var publishedState RealtimeStateOutput
	var closedReason *realtime.CloseReason
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

			credential.SignCount = assertionResult.NewSignCount
			channel.AdminCredential, err = json.Marshal(credential)
			if err != nil {
				return err
			}

			if input.Intent.Op == "delete" {
				if _, err := tx.SaveChannel(ctx, *channel); err != nil {
					return err
				}
				_, err := tx.FinalizeTerminalState(ctx, store.TerminalReasonDeleted, now)
				if err == nil {
					reason := realtime.CloseReasonDeleted
					closedReason = &reason
				}
				return err
			}

			state, err := s.validateAndApplyDelivery(ctx, tx, channel, input, now)
			if err != nil {
				return err
			}
			publishedState = state
			return nil
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
			if err == nil {
				reason := realtime.CloseReasonDeleted
				closedReason = &reason
			}
			return err
		}

		state, err := s.validateAndApplyDelivery(ctx, tx, channel, input, now)
		if err != nil {
			return err
		}
		publishedState = state
		return nil
	})
	if err != nil {
		return CompoundCommitOutput{}, mapProtocolError(err)
	}

	if closedReason != nil {
		s.publishRealtimeClosed(ctx, input.UUID, *closedReason)
	} else {
		s.publishRealtimeState(ctx, publishedState)
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

	updateProof, err := buildStoredUpdateDeliveryProofJSON(resolveChannelAdminMode(channel), input)
	if err != nil {
		return err
	}

	channel.State = store.ChannelStateDelivered
	if input.Intent.CipherBundle != nil {
		cipherBundle, err := json.Marshal(input.Intent.CipherBundle)
		if err != nil {
			return err
		}
		channel.CipherBundle = cipherBundle
		channel.FileRef = nil
	}
	if input.Intent.FileRef != nil {
		fileRef, err := json.Marshal(input.Intent.FileRef)
		if err != nil {
			return err
		}
		channel.FileRef = fileRef
		channel.CipherBundle = nil
	}
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

func (s *ProtocolService) validateAndApplyDelivery(
	ctx context.Context,
	tx *store.ChannelTx,
	channel *store.Channel,
	input CompoundCommitInput,
	now time.Time,
) (RealtimeStateOutput, error) {
	if err := validateDeliveryChannel(channel, input.Intent.ReceiverPubFpr); err != nil {
		return RealtimeStateOutput{}, err
	}

	expireAt, err := parseFutureExpireAt(input.Intent, now)
	if err != nil {
		return RealtimeStateOutput{}, err
	}
	if input.Intent.CipherBundle != nil {
		if err := validateCipherBundle(
			*input.Intent.CipherBundle,
			input.Intent,
			*channel.ReceiverPubFpr,
			s.filePolicy.MaxFileBytes,
		); err != nil {
			return RealtimeStateOutput{}, err
		}
	}
	if input.Intent.FileRef != nil {
		if !s.filePolicy.MultipartSupported {
			return RealtimeStateOutput{}, badRequest("multipart files are not supported")
		}
		if err := validateMultipartFileRef(*input.Intent.FileRef); err != nil {
			return RealtimeStateOutput{}, err
		}
	}
	if err := s.applyDelivery(ctx, tx, channel, input, now, expireAt); err != nil {
		return RealtimeStateOutput{}, err
	}
	return buildRealtimeState(*channel), nil
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
		if channel.State != store.ChannelStateDelivered || (len(channel.CipherBundle) == 0 && len(channel.FileRef) == 0) || channel.DeliveredAt == nil || channel.ReceiverPubFpr == nil {
			return channelNotDelivered("ciphertext is not available yet")
		}

		output = DecryptFetchOutput{
			OK:             true,
			ReceiverPubFpr: *channel.ReceiverPubFpr,
			CipherVersion:  channel.Version - 1,
			DeliveredAt:    channel.DeliveredAt.UTC().UnixMilli(),
		}

		if len(channel.FileRef) > 0 {
			var fileRef filestore.MultipartFileRef
			if err := json.Unmarshal(channel.FileRef, &fileRef); err != nil {
				return err
			}
			output.FileRef = &fileRef
		} else {
			var cipherBundle CipherBundle
			if err := json.Unmarshal(channel.CipherBundle, &cipherBundle); err != nil {
				return err
			}
			output.CipherBundle = &cipherBundle
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

func (s *ProtocolService) publishRealtimeState(ctx context.Context, state RealtimeStateOutput) {
	if s.publisher == nil || state.ChannelID == "" {
		return
	}

	_ = s.publisher.PublishState(ctx, realtime.StateSnapshot{
		ChannelID:       state.ChannelID,
		State:           state.State,
		Version:         state.Version,
		AdminMode:       state.AdminMode,
		SecurityProfile: state.SecurityProfile,
		ReceiverPubFpr:  state.ReceiverPubFpr,
		ExpiresAt:       state.ExpiresAt,
	})
}

func (s *ProtocolService) publishRealtimeClosed(ctx context.Context, channelID string, reason realtime.CloseReason) {
	if s.publisher == nil || channelID == "" {
		return
	}

	_ = s.publisher.PublishClosed(ctx, channelID, reason)
}
