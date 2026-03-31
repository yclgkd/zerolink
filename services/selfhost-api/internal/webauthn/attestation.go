package webauthn

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"

	"github.com/fxamacker/cbor/v2"
)

type NativeVerifier struct{}

type attestationObject struct {
	Format   string               `cbor:"fmt"`
	Stmt     attestationStatement `cbor:"attStmt"`
	AuthData []byte               `cbor:"authData"`
}

type attestationStatement struct {
	Signature []byte   `cbor:"sig"`
	X5C       [][]byte `cbor:"x5c"`
	Algorithm int64    `cbor:"alg"`
}

type authenticatorData struct {
	RPIDHash            []byte
	Flags               byte
	SignCount           uint32
	AAGUID              []byte
	CredentialID        []byte
	CredentialPublicKey []byte
}

type clientData struct {
	Type      string `json:"type"`
	Origin    string `json:"origin"`
	Challenge string `json:"challenge"`
}

func NewVerifier() Verifier {
	return NativeVerifier{}
}

func (NativeVerifier) VerifyAssertion(context.Context, AssertionInput) error {
	return ErrNotImplemented
}

func (NativeVerifier) VerifyAttestation(_ context.Context, input AttestationInput) (AttestationResult, error) {
	attestation, clientDataJSON, parsedClient, authData, err := parseAttestation(input)
	if err != nil {
		return AttestationResult{}, err
	}
	if err := validateContext(input, parsedClient, authData); err != nil {
		return AttestationResult{}, err
	}
	if err := validateFlags(input.RequireUserVerification, authData.Flags); err != nil {
		return AttestationResult{}, err
	}
	verified, warning, err := verifyStatement(attestation, clientDataJSON, authData)
	if err != nil {
		return AttestationResult{}, err
	}
	return buildResult(attestation.Format, verified, warning, authData)
}

func parseAttestation(
	input AttestationInput,
) (attestationObject, []byte, clientData, authenticatorData, error) {
	attestationBytes, err := decodeBase64URL(input.AttestationObjectB64u)
	if err != nil {
		return attestationObject{}, nil, clientData{}, authenticatorData{}, err
	}
	clientDataJSON, err := decodeBase64URL(input.ClientDataJSONB64u)
	if err != nil {
		return attestationObject{}, nil, clientData{}, authenticatorData{}, err
	}
	var attestation attestationObject
	if err := cbor.Unmarshal(attestationBytes, &attestation); err != nil {
		return attestationObject{}, nil, clientData{}, authenticatorData{}, err
	}
	var parsedClient clientData
	if err := json.Unmarshal(clientDataJSON, &parsedClient); err != nil {
		return attestationObject{}, nil, clientData{}, authenticatorData{}, err
	}
	authData, err := parseAuthenticatorData(attestation.AuthData)
	return attestation, clientDataJSON, parsedClient, authData, err
}

func parseAuthenticatorData(raw []byte) (authenticatorData, error) {
	if len(raw) < 37 {
		return authenticatorData{}, errors.New("Authenticator data too short")
	}
	authData := authenticatorData{
		RPIDHash:  append([]byte(nil), raw[:32]...),
		Flags:     raw[32],
		SignCount: uint32(raw[33])<<24 | uint32(raw[34])<<16 | uint32(raw[35])<<8 | uint32(raw[36]),
	}
	if authData.Flags&0x40 == 0 {
		return authData, nil
	}
	if len(raw) < 55 {
		return authenticatorData{}, errors.New("Authenticator data too short for attested credential data")
	}
	authData.AAGUID = append([]byte(nil), raw[37:53]...)
	credentialIDLength := int(raw[53])<<8 | int(raw[54])
	start := 55
	end := start + credentialIDLength
	if len(raw) < end {
		return authenticatorData{}, errors.New("Authenticator data too short for credential ID")
	}
	authData.CredentialID = append([]byte(nil), raw[start:end]...)
	authData.CredentialPublicKey = append([]byte(nil), raw[end:]...)
	return authData, nil
}

func validateContext(input AttestationInput, client clientData, authData authenticatorData) error {
	rpIDHash := sha256.Sum256([]byte(input.ExpectedRPID))
	if subtle.ConstantTimeCompare(authData.RPIDHash, rpIDHash[:]) != 1 {
		return errors.New("rpIdHash mismatch")
	}
	if client.Type != "webauthn.create" {
		return errors.New("Invalid clientData type")
	}
	if client.Origin != input.ExpectedOrigin {
		return errors.New("Invalid origin")
	}
	if client.Challenge == "" {
		return errors.New("challenge field in clientData is not a string")
	}
	challenge, err := decodeBase64URL(client.Challenge)
	if err != nil {
		return err
	}
	if subtle.ConstantTimeCompare(challenge, input.ExpectedChallenge) != 1 {
		return errors.New("Challenge mismatch")
	}
	return nil
}

func validateFlags(requireUserVerification bool, flags byte) error {
	if flags&0x01 == 0 {
		return errors.New("User presence flag not set")
	}
	if requireUserVerification && flags&0x04 == 0 {
		return errors.New("User verification flag not set")
	}
	return nil
}

func buildResult(format string, verified bool, warning string, authData authenticatorData) (AttestationResult, error) {
	if len(authData.CredentialID) == 0 || len(authData.CredentialPublicKey) == 0 {
		return AttestationResult{}, errors.New("Missing attested credential data")
	}
	return AttestationResult{
		Verified:     verified,
		Format:       format,
		CredentialID: encodeBase64URL(authData.CredentialID),
		PublicKey:    encodeBase64URL(authData.CredentialPublicKey),
		SignCount:    int64(authData.SignCount),
		AAGUID:       encodeBase64URL(zeroAAGUID(authData.AAGUID)),
		Warning:      warning,
	}, nil
}

func zeroAAGUID(value []byte) []byte {
	if len(value) != 0 {
		return value
	}
	return make([]byte, 16)
}

func decodeBase64URL(value string) ([]byte, error) {
	return base64.RawURLEncoding.DecodeString(value)
}

func encodeBase64URL(value []byte) string {
	return base64.RawURLEncoding.EncodeToString(value)
}
