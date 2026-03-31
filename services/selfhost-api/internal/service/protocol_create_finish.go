package service

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"

	"github.com/yclgkd/ZeroLink/services/selfhost-api/internal/store"
	"github.com/yclgkd/ZeroLink/services/selfhost-api/internal/webauthn"
)

func (s *ProtocolService) resolveAdminCredential(
	ctx context.Context,
	tx *store.ChannelTx,
	channel *store.Channel,
	input CreateFinishInput,
) (json.RawMessage, error) {
	if input.AdminMode != string(store.AdminModeWebAuthn) {
		return buildSoftkeyAdminCredential(input)
	}

	attestationInput, err := s.loadAttestationInput(ctx, tx, channel, input)
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
			channel.SecurityProfile,
			result.Format,
		)
		return nil, attestationUnverifiable(message)
	}

	return buildWebAuthnAdminCredential(result, input.Attestation.Response.Transports)
}

func (s *ProtocolService) loadAttestationInput(
	ctx context.Context,
	tx *store.ChannelTx,
	channel *store.Channel,
	input CreateFinishInput,
) (webauthn.AttestationInput, error) {
	challenge, err := tx.GetChallenge(ctx, store.ChallengeKindCreate)
	if err != nil {
		return webauthn.AttestationInput{}, err
	}
	if challenge == nil || challenge.ChallengeValue == nil || *challenge.ChallengeValue == "" {
		return webauthn.AttestationInput{}, challengeInvalid("creation challenge not found")
	}

	expectedChallenge, err := base64.RawURLEncoding.DecodeString(*challenge.ChallengeValue)
	if err != nil {
		return webauthn.AttestationInput{}, challengeInvalid("creation challenge is invalid")
	}

	return webauthn.AttestationInput{
		ChannelID:               channel.UUID,
		AttestationObjectB64u:   input.Attestation.Response.AttestationObject,
		ClientDataJSONB64u:      input.Attestation.Response.ClientDataJSON,
		ExpectedRPID:            s.rpID,
		ExpectedOrigin:          s.rpOrigin,
		ExpectedChallenge:       expectedChallenge,
		RequireUserVerification: channel.SecurityProfile == store.SecurityProfileSecure,
	}, nil
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
