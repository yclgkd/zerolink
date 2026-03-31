package webauthn

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"testing"

	"github.com/fxamacker/cbor/v2"
)

func TestVerifyAttestationRejectsChallengeMismatch(t *testing.T) {
	t.Parallel()

	verifier := NewVerifier()
	fixture := buildAttestationFixture(t, "none")
	fixture.Input.ExpectedChallenge = []byte("wrong challenge")

	_, err := verifier.VerifyAttestation(t.Context(), fixture.Input)
	if err == nil || err.Error() != "Challenge mismatch" {
		t.Fatalf("VerifyAttestation() error = %v, want Challenge mismatch", err)
	}
}

func TestVerifyAttestationReturnsStoredCredentialForFmtNone(t *testing.T) {
	t.Parallel()

	verifier := NewVerifier()
	fixture := buildAttestationFixture(t, "none")

	result, err := verifier.VerifyAttestation(t.Context(), fixture.Input)
	if err != nil {
		t.Fatalf("VerifyAttestation() error = %v", err)
	}
	if result.Verified {
		t.Fatal("Verified = true, want false for fmt:none")
	}
	if result.Format != "none" {
		t.Fatalf("Format = %q, want none", result.Format)
	}
	if result.CredentialID != fixture.CredentialID {
		t.Fatalf("CredentialID = %q, want %q", result.CredentialID, fixture.CredentialID)
	}
	if result.PublicKey != fixture.PublicKey {
		t.Fatalf("PublicKey = %q, want %q", result.PublicKey, fixture.PublicKey)
	}
	if result.AAGUID != fixture.AAGUID {
		t.Fatalf("AAGUID = %q, want %q", result.AAGUID, fixture.AAGUID)
	}
	if result.SignCount != 9 {
		t.Fatalf("SignCount = %d, want 9", result.SignCount)
	}
}

func TestVerifyAttestationVerifiesPackedSelfAttestation(t *testing.T) {
	t.Parallel()

	verifier := NewVerifier()
	fixture := buildAttestationFixture(t, "packed")

	result, err := verifier.VerifyAttestation(t.Context(), fixture.Input)
	if err != nil {
		t.Fatalf("VerifyAttestation() error = %v", err)
	}
	if !result.Verified {
		t.Fatal("Verified = false, want true for packed self-attestation")
	}
	if result.Format != "packed" {
		t.Fatalf("Format = %q, want packed", result.Format)
	}
}

type attestationFixture struct {
	Input        AttestationInput
	CredentialID string
	PublicKey    string
	AAGUID       string
}

func buildAttestationFixture(t *testing.T, format string) attestationFixture {
	t.Helper()

	privateKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("GenerateKey() error = %v", err)
	}

	challenge := []byte("create challenge bytes")
	clientDataJSON, err := json.Marshal(map[string]any{
		"type":      "webauthn.create",
		"challenge": packageBase64URL(challenge),
		"origin":    "https://example.com",
	})
	if err != nil {
		t.Fatalf("Marshal(clientDataJSON) error = %v", err)
	}

	publicKeyCose, err := cbor.Marshal(map[int]any{
		1:  2,
		3:  -7,
		-1: 1,
		-2: privateKey.PublicKey.X.FillBytes(make([]byte, 32)),
		-3: privateKey.PublicKey.Y.FillBytes(make([]byte, 32)),
	})
	if err != nil {
		t.Fatalf("Marshal(publicKeyCose) error = %v", err)
	}

	aaguid := []byte("0123456789abcdef")
	credentialID := []byte("credential-id")
	authData := buildAuthenticatorData(t, "example.com", aaguid, credentialID, publicKeyCose)
	attestationObject := map[string]any{
		"fmt":      format,
		"attStmt":  map[string]any{},
		"authData": authData,
	}
	if format == "packed" {
		signature := signPackedSelf(t, privateKey, authData, clientDataJSON)
		attestationObject["attStmt"] = map[string]any{"sig": signature}
	}

	encodedAttestation, err := cbor.Marshal(attestationObject)
	if err != nil {
		t.Fatalf("Marshal(attestationObject) error = %v", err)
	}

	return attestationFixture{
		Input: AttestationInput{
			ChannelID:               "channel-id",
			AttestationObjectB64u:   packageBase64URL(encodedAttestation),
			ClientDataJSONB64u:      packageBase64URL(clientDataJSON),
			ExpectedRPID:            "example.com",
			ExpectedOrigin:          "https://example.com",
			ExpectedChallenge:       challenge,
			RequireUserVerification: true,
		},
		CredentialID: packageBase64URL(credentialID),
		PublicKey:    packageBase64URL(publicKeyCose),
		AAGUID:       packageBase64URL(aaguid),
	}
}

func buildAuthenticatorData(
	t *testing.T,
	rpID string,
	aaguid []byte,
	credentialID []byte,
	publicKeyCose []byte,
) []byte {
	t.Helper()

	rpIDHash := sha256.Sum256([]byte(rpID))
	authData := make([]byte, 37+16+2+len(credentialID)+len(publicKeyCose))
	copy(authData[:32], rpIDHash[:])
	authData[32] = 0x45
	binary.BigEndian.PutUint32(authData[33:37], 9)
	copy(authData[37:53], aaguid)
	binary.BigEndian.PutUint16(authData[53:55], uint16(len(credentialID)))
	copy(authData[55:55+len(credentialID)], credentialID)
	copy(authData[55+len(credentialID):], publicKeyCose)
	return authData
}

func signPackedSelf(t *testing.T, key *ecdsa.PrivateKey, authData []byte, clientDataJSON []byte) []byte {
	t.Helper()

	clientHash := sha256.Sum256(clientDataJSON)
	signedData := append(append([]byte(nil), authData...), clientHash[:]...)
	digest := sha256.Sum256(signedData)
	signature, err := ecdsa.SignASN1(rand.Reader, key, digest[:])
	if err != nil {
		t.Fatalf("SignASN1() error = %v", err)
	}
	return signature
}

func packageBase64URL(value []byte) string {
	return base64.RawURLEncoding.EncodeToString(value)
}
