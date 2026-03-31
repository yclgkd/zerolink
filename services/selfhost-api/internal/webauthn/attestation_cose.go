package webauthn

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/sha256"
	"errors"
	"fmt"
	"math/big"

	"github.com/fxamacker/cbor/v2"
)

func verifyStatement(
	attestation attestationObject,
	clientDataJSON []byte,
	authData authenticatorData,
) (bool, string, error) {
	switch attestation.Format {
	case "packed":
		return verifyPacked(attestation, clientDataJSON, authData)
	case "none":
		return false, "fmt:'none' attestation - no attestation statement provided; credential origin is unverifiable", nil
	default:
		return false, "", errors.New("unsupported attestation format")
	}
}

func verifyPacked(
	attestation attestationObject,
	clientDataJSON []byte,
	authData authenticatorData,
) (bool, string, error) {
	if len(attestation.Stmt.X5C) > 0 {
		return false, "", errors.New("x5c attestation (certificate chain) is not yet supported; only packed self-attestation and fmt:'none' are accepted")
	}
	if attestation.Stmt.Algorithm != -7 {
		return false, "", fmt.Errorf("packed self-attestation alg must be -7 (ES256), got %d", attestation.Stmt.Algorithm)
	}
	if len(attestation.Stmt.Signature) == 0 {
		return false, "", errors.New("packed attestation missing sig field; cannot verify")
	}
	verified, err := verifyPackedSelf(
		attestation.AuthData,
		clientDataJSON,
		attestation.Stmt.Signature,
		authData.CredentialPublicKey,
	)
	if err != nil {
		return false, "", err
	}
	if !verified {
		return false, "", errors.New("packed self-attestation signature verification failed")
	}
	return true, "packed self-attestation verified; no certificate chain - hardware origin is not cryptographically proven", nil
}

func verifyPackedSelf(authDataRaw, clientDataJSON, signature, publicKey []byte) (bool, error) {
	key, err := parseCOSEPublicKey(publicKey)
	if err != nil {
		return false, err
	}
	clientHash := sha256.Sum256(clientDataJSON)
	signedData := append(append([]byte(nil), authDataRaw...), clientHash[:]...)
	digest := sha256.Sum256(signedData)
	return ecdsa.VerifyASN1(key, digest[:], signature), nil
}

func parseCOSEPublicKey(raw []byte) (*ecdsa.PublicKey, error) {
	var decoded map[int64]any
	if err := cbor.Unmarshal(raw, &decoded); err != nil {
		return nil, err
	}
	if !matchesInt(decoded[1], 2) || !matchesInt(decoded[3], -7) || !matchesInt(decoded[-1], 1) {
		return nil, errors.New("Unsupported COSE key format (only P-256/ES256 supported)")
	}
	x, xOK := decoded[-2].([]byte)
	y, yOK := decoded[-3].([]byte)
	if !xOK || !yOK || len(x) != 32 || len(y) != 32 {
		return nil, errors.New("Invalid COSE key coordinates")
	}
	key := &ecdsa.PublicKey{
		Curve: elliptic.P256(),
		X:     new(big.Int).SetBytes(x),
		Y:     new(big.Int).SetBytes(y),
	}
	if !key.Curve.IsOnCurve(key.X, key.Y) {
		return nil, errors.New("COSE key coordinates are not on the P-256 curve")
	}
	return key, nil
}

func matchesInt(value any, want int64) bool {
	switch typed := value.(type) {
	case int64:
		return typed == want
	case uint64:
		return want >= 0 && typed == uint64(want)
	case int:
		return int64(typed) == want
	case uint:
		return want >= 0 && typed == uint(want)
	default:
		return false
	}
}
