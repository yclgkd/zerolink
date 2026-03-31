package webauthn

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/asn1"
	"encoding/json"
	"errors"
	"math/big"

	"github.com/fxamacker/cbor/v2"
)

const (
	authenticatorDataMinLength = 37
	rpIDHashLength             = 32
	flagsOffset                = 32
	signCountOffset            = 33
	userPresenceFlag           = 0x01
	userVerificationFlag       = 0x04
)

type coseKey struct {
	KeyType   int64
	Algorithm int64
	Curve     int64
	X         []byte
	Y         []byte
}

type ecdsaSignature struct {
	R *big.Int
	S *big.Int
}

func (NativeVerifier) VerifyAssertion(_ context.Context, input AssertionInput) (AssertionResult, error) {
	if input.AssertionID != input.StoredCredentialID {
		return AssertionResult{}, errors.New("credential ID mismatch")
	}

	clientDataBytes, err := decodeBase64URL(input.ClientDataJSONB64u)
	if err != nil {
		return AssertionResult{}, err
	}

	var parsedClient clientData
	if err := json.Unmarshal(clientDataBytes, &parsedClient); err != nil {
		return AssertionResult{}, errors.New("invalid clientDataJSON")
	}

	authDataBytes, err := decodeBase64URL(input.AuthenticatorDataB64u)
	if err != nil {
		return AssertionResult{}, err
	}
	if len(authDataBytes) < authenticatorDataMinLength {
		return AssertionResult{}, errors.New("authenticatorData too short")
	}

	authData, err := parseAuthenticatorData(authDataBytes)
	if err != nil {
		return AssertionResult{}, err
	}
	if err := validateAssertionContext(input, parsedClient, authData); err != nil {
		return AssertionResult{}, err
	}
	if err := validateFlags(input.RequireUserVerification, authData.Flags); err != nil {
		return AssertionResult{}, err
	}

	clientHash := sha256.Sum256(clientDataBytes)
	signedData := make([]byte, 0, len(authDataBytes)+len(clientHash))
	signedData = append(signedData, authDataBytes...)
	signedData = append(signedData, clientHash[:]...)
	digest := sha256.Sum256(signedData)

	publicKey, err := decodeStoredPublicKey(input.StoredPublicKey)
	if err != nil {
		return AssertionResult{}, err
	}

	signatureBytes, err := decodeBase64URL(input.SignatureB64u)
	if err != nil {
		return AssertionResult{}, err
	}

	valid, err := verifyECDSASignature(publicKey, digest[:], signatureBytes)
	if err != nil {
		return AssertionResult{}, err
	}
	if !valid {
		return AssertionResult{}, errors.New("signature verification failed")
	}

	return AssertionResult{
		NewSignCount: int64(authData.SignCount),
	}, nil
}

func validateAssertionContext(input AssertionInput, client clientData, authData authenticatorData) error {
	rpIDHash := sha256.Sum256([]byte(input.ExpectedRPID))
	if subtle.ConstantTimeCompare(authData.RPIDHash, rpIDHash[:]) != 1 {
		return errors.New("rpIdHash mismatch")
	}
	if client.Type != "webauthn.get" {
		return errors.New("invalid clientData type")
	}
	if client.Origin != input.ExpectedOrigin {
		return errors.New("origin mismatch")
	}
	if client.Challenge == "" {
		return errors.New("challenge field in clientData is not a string")
	}
	challenge, err := decodeBase64URL(client.Challenge)
	if err != nil {
		return err
	}
	if subtle.ConstantTimeCompare(challenge, input.ExpectedChallenge) != 1 {
		return errors.New("challenge mismatch")
	}
	return nil
}

func decodeStoredPublicKey(encoded string) (*ecdsa.PublicKey, error) {
	publicKeyBytes, err := decodeBase64URL(encoded)
	if err != nil {
		return nil, err
	}

	var raw map[int64]any
	if err := cbor.Unmarshal(publicKeyBytes, &raw); err != nil {
		return nil, errors.New("failed to decode stored public key")
	}

	key := coseKey{}
	if value, ok := raw[1].(uint64); ok {
		key.KeyType = int64(value)
	} else if value, ok := raw[1].(int64); ok {
		key.KeyType = value
	}
	if value, ok := raw[3].(int64); ok {
		key.Algorithm = value
	} else if value, ok := raw[3].(uint64); ok {
		key.Algorithm = int64(value)
	}
	if value, ok := raw[-1].(uint64); ok {
		key.Curve = int64(value)
	} else if value, ok := raw[-1].(int64); ok {
		key.Curve = value
	}
	if value, ok := raw[-2].([]byte); ok {
		key.X = append([]byte(nil), value...)
	}
	if value, ok := raw[-3].([]byte); ok {
		key.Y = append([]byte(nil), value...)
	}

	if key.KeyType != 2 || key.Algorithm != -7 || key.Curve != 1 || len(key.X) != 32 || len(key.Y) != 32 {
		return nil, errors.New("invalid COSE P-256 public key")
	}

	return &ecdsa.PublicKey{
		Curve: elliptic.P256(),
		X:     new(big.Int).SetBytes(key.X),
		Y:     new(big.Int).SetBytes(key.Y),
	}, nil
}

func verifyECDSASignature(publicKey *ecdsa.PublicKey, digest []byte, signature []byte) (bool, error) {
	switch {
	case len(signature) == 64:
		r := new(big.Int).SetBytes(signature[:32])
		s := new(big.Int).SetBytes(signature[32:])
		return ecdsa.Verify(publicKey, digest, r, s), nil
	case len(signature) == 0:
		return false, errors.New("empty signature")
	default:
		var parsed ecdsaSignature
		if _, err := asn1.Unmarshal(signature, &parsed); err != nil {
			return false, errors.New("invalid ECDSA signature encoding")
		}
		if parsed.R == nil || parsed.S == nil {
			return false, errors.New("invalid ECDSA signature encoding")
		}
		return ecdsa.Verify(publicKey, digest, parsed.R, parsed.S), nil
	}
}
