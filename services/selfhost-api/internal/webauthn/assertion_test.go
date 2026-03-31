package webauthn

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"encoding/binary"
	"encoding/json"
	"strings"
	"testing"

	"github.com/fxamacker/cbor/v2"
)

func TestVerifyAssertionAcceptsValidES256Assertion(t *testing.T) {
	privateKey, storedPublicKey := generateStoredCredential(t)
	expectedChallenge := []byte("expected-challenge-001")
	clientDataJSON := mustJSON(t, clientData{
		Type:      "webauthn.get",
		Origin:    "http://localhost:5173",
		Challenge: encodeBase64URL(expectedChallenge),
	})
	authenticatorData := buildAssertionAuthenticatorData("localhost", 9)
	signature := signAssertion(t, privateKey, authenticatorData, clientDataJSON)

	result, err := NativeVerifier{}.VerifyAssertion(context.Background(), AssertionInput{
		ChannelID:               "channel-1",
		AssertionID:             "credential-1",
		ClientDataJSONB64u:      encodeBase64URL(clientDataJSON),
		AuthenticatorDataB64u:   encodeBase64URL(authenticatorData),
		SignatureB64u:           encodeBase64URL(signature),
		ExpectedRPID:            "localhost",
		ExpectedOrigin:          "http://localhost:5173",
		ExpectedChallenge:       expectedChallenge,
		StoredCredentialID:      "credential-1",
		StoredPublicKey:         storedPublicKey,
		StoredSignCount:         3,
		RequireUserVerification: true,
	})
	if err != nil {
		t.Fatalf("VerifyAssertion() error = %v", err)
	}
	if result.NewSignCount != 9 {
		t.Fatalf("result.NewSignCount = %d, want 9", result.NewSignCount)
	}
}

func TestVerifyAssertionRejectsChallengeMismatch(t *testing.T) {
	privateKey, storedPublicKey := generateStoredCredential(t)
	clientDataJSON := mustJSON(t, clientData{
		Type:      "webauthn.get",
		Origin:    "http://localhost:5173",
		Challenge: encodeBase64URL([]byte("challenge-from-client")),
	})
	authenticatorData := buildAssertionAuthenticatorData("localhost", 4)
	signature := signAssertion(t, privateKey, authenticatorData, clientDataJSON)

	_, err := NativeVerifier{}.VerifyAssertion(context.Background(), AssertionInput{
		ChannelID:               "channel-2",
		AssertionID:             "credential-2",
		ClientDataJSONB64u:      encodeBase64URL(clientDataJSON),
		AuthenticatorDataB64u:   encodeBase64URL(authenticatorData),
		SignatureB64u:           encodeBase64URL(signature),
		ExpectedRPID:            "localhost",
		ExpectedOrigin:          "http://localhost:5173",
		ExpectedChallenge:       []byte("different-challenge"),
		StoredCredentialID:      "credential-2",
		StoredPublicKey:         storedPublicKey,
		StoredSignCount:         1,
		RequireUserVerification: true,
	})
	if err == nil {
		t.Fatal("VerifyAssertion() error = nil, want challenge mismatch")
	}
	if !strings.Contains(err.Error(), "challenge mismatch") {
		t.Fatalf("VerifyAssertion() error = %v, want challenge mismatch", err)
	}
}

func generateStoredCredential(t *testing.T) (*ecdsa.PrivateKey, string) {
	t.Helper()

	privateKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("ecdsa.GenerateKey() error = %v", err)
	}

	cosePublicKey, err := cbor.Marshal(map[int]any{
		1:  2,
		3:  -7,
		-1: 1,
		-2: privateKey.PublicKey.X.FillBytes(make([]byte, 32)),
		-3: privateKey.PublicKey.Y.FillBytes(make([]byte, 32)),
	})
	if err != nil {
		t.Fatalf("cbor.Marshal() error = %v", err)
	}

	return privateKey, encodeBase64URL(cosePublicKey)
}

func buildAssertionAuthenticatorData(rpID string, signCount uint32) []byte {
	rpIDHash := sha256.Sum256([]byte(rpID))
	data := make([]byte, 37)
	copy(data[:32], rpIDHash[:])
	data[32] = userPresenceFlag | userVerificationFlag
	binary.BigEndian.PutUint32(data[33:], signCount)
	return data
}

func signAssertion(t *testing.T, privateKey *ecdsa.PrivateKey, authData []byte, clientDataJSON []byte) []byte {
	t.Helper()

	clientDataHash := sha256.Sum256(clientDataJSON)
	payload := make([]byte, 0, len(authData)+len(clientDataHash))
	payload = append(payload, authData...)
	payload = append(payload, clientDataHash[:]...)
	digest := sha256.Sum256(payload)

	signature, err := ecdsa.SignASN1(rand.Reader, privateKey, digest[:])
	if err != nil {
		t.Fatalf("ecdsa.SignASN1() error = %v", err)
	}
	return signature
}

func mustJSON(t *testing.T, value any) []byte {
	t.Helper()

	encoded, err := json.Marshal(value)
	if err != nil {
		t.Fatalf("json.Marshal() error = %v", err)
	}
	return encoded
}
