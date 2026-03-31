package service

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"time"

	"github.com/yclgkd/ZeroLink/services/selfhost-api/internal/store"
	"github.com/yclgkd/ZeroLink/services/selfhost-api/internal/webauthn"
)

func (s *ProtocolService) resolveAdminCredential(
	ctx context.Context,
	input CreateFinishInput,
	now time.Time,
) (json.RawMessage, error) {
	if input.AdminMode != string(store.AdminModeWebAuthn) {
		return buildSoftkeyAdminCredential(input)
	}

	attestationInput, profile, err := s.consumeCreateChallenge(ctx, input.UUID, now, input.Attestation)
	if err != nil {
		return nil, err
	}

	result, err := s.verifier.VerifyAttestation(ctx, attestationInput)
	if err != nil {
		return nil, attestationUnverifiable(err.Error())
	}
	if !result.Verified && result.Format != "none" {
		message := fmt.Sprintf(
			"security profile '%s' requires verified attestation for fmt:'%s'",
			profile,
			result.Format,
		)
		return nil, attestationUnverifiable(message)
	}

	return buildWebAuthnAdminCredential(result, input.Attestation.Response.Transports)
}

func (s *ProtocolService) consumeCreateChallenge(
	ctx context.Context,
	uuid string,
	now time.Time,
	attestation *AttestationJSON,
) (webauthn.AttestationInput, store.SecurityProfile, error) {
	var (
		verificationInput webauthn.AttestationInput
		profile           store.SecurityProfile
	)

	err := s.db.WithChannelTx(ctx, uuid, func(ctx context.Context, tx *store.ChannelTx) error {
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

		challenge, err := tx.GetChallenge(ctx, store.ChallengeKindCreate)
		if err != nil {
			return err
		}
		if challenge == nil || challenge.ChallengeValue == nil || *challenge.ChallengeValue == "" {
			return challengeInvalid("creation challenge not found")
		}

		expectedChallenge, err := base64.RawURLEncoding.DecodeString(*challenge.ChallengeValue)
		if err != nil {
			return challengeInvalid("creation challenge is invalid")
		}
		if err := tx.DeleteChallenge(ctx, store.ChallengeKindCreate); err != nil {
			return err
		}

		profile = channel.SecurityProfile
		verificationInput = webauthn.AttestationInput{
			ChannelID:               uuid,
			AttestationObjectB64u:   attestation.Response.AttestationObject,
			ClientDataJSONB64u:      attestation.Response.ClientDataJSON,
			ExpectedRPID:            s.rpID,
			ExpectedOrigin:          s.rpOrigin,
			ExpectedChallenge:       expectedChallenge,
			RequireUserVerification: channel.SecurityProfile == store.SecurityProfileSecure,
		}
		return nil
	})
	if err != nil {
		return webauthn.AttestationInput{}, "", mapProtocolError(err)
	}

	return verificationInput, profile, nil
}

func buildWebAuthnAdminCredential(
	result webauthn.AttestationResult,
	transports []string,
) (json.RawMessage, error) {
	payload, err := json.Marshal(webAuthnStoredCredential{
		CredentialID: result.CredentialID,
		PublicKey:    result.PublicKey,
		SignCount:    result.SignCount,
		AAGUID:       result.AAGUID,
		Transports:   append([]string(nil), transports...),
	})
	if err != nil {
		return nil, badRequest("invalid attestation payload")
	}
	return payload, nil
}

func buildSoftkeyAdminCredential(input CreateFinishInput) (json.RawMessage, error) {
	payload, err := json.Marshal(softkeyStoredCredential{
		Type:          "softkey",
		SoftkeyPubJWK: *input.SoftkeyPubJWK,
	})
	if err != nil {
		return nil, badRequest("invalid softkey payload")
	}
	return payload, nil
}
