package service

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/fxamacker/cbor/v2"

	"github.com/yclgkd/ZeroLink/services/selfhost-api/internal/store"
	"github.com/yclgkd/ZeroLink/services/selfhost-api/internal/webauthn"
)

const (
	regressionRPID     = "localhost"
	regressionRPOrigin = "http://localhost:5173"
)

type regressionCredential struct {
	privateKey   *ecdsa.PrivateKey
	credentialID string
	publicKey    string
}

type regressionVerifier struct {
	attestation webauthn.AttestationResult
}

func (v regressionVerifier) VerifyAttestation(
	_ context.Context,
	_ webauthn.AttestationInput,
) (webauthn.AttestationResult, error) {
	return v.attestation, nil
}

func (v regressionVerifier) VerifyAssertion(
	ctx context.Context,
	input webauthn.AssertionInput,
) (webauthn.AssertionResult, error) {
	return webauthn.NativeVerifier{}.VerifyAssertion(ctx, input)
}

type secureFixture struct {
	ctx            context.Context
	svc            Protocol
	uuid           string
	lockKeyB64u    string
	credential     regressionCredential
	receiverPubJWK RSAPublicKeyJWK
	receiverPubFpr string
}

func TestProtocolServiceProtocolRegressionSuite(t *testing.T) {
	t.Run("happy path stays green", func(t *testing.T) {
		fixture := newLockedSecureFixture(t, 1)
		begin, intent := beginSignedUpdate(t, fixture, 0, "nonce-regression-happy", 2, nil)

		if _, err := fixture.svc.CompoundCommit(fixture.ctx, CompoundCommitInput{
			UUID:       fixture.uuid,
			Assertion:  buildRegressionAssertion(t, fixture.credential, regressionRPID, regressionRPOrigin, begin, intent, 2),
			IntentHash: mustIntentHash(t, intent),
			Intent:     intent,
		}); err != nil {
			t.Fatalf("CompoundCommit() error = %v", err)
		}

		status, err := fixture.svc.PublicStatus(fixture.ctx, fixture.uuid)
		if err != nil {
			t.Fatalf("PublicStatus() error = %v", err)
		}
		if status.State != string(store.ChannelStateDelivered) {
			t.Fatalf("status.State = %q, want delivered", status.State)
		}

		decrypt, err := fixture.svc.DecryptFetch(fixture.ctx, fixture.uuid)
		if err != nil {
			t.Fatalf("DecryptFetch() error = %v", err)
		}
		if decrypt.CipherBundle == nil {
			t.Fatal("DecryptFetch().CipherBundle = nil, want inline payload")
		}
		if decrypt.ReceiverPubFpr != fixture.receiverPubFpr {
			t.Fatalf("DecryptFetch().ReceiverPubFpr = %q, want %q", decrypt.ReceiverPubFpr, fixture.receiverPubFpr)
		}
	})

	t.Run("invalid lockProof is rejected", func(t *testing.T) {
		fixture := newSecureFixture(t, 2)
		begin, err := fixture.svc.LockBegin(fixture.ctx, LockBeginInput{UUID: fixture.uuid})
		if err != nil {
			t.Fatalf("LockBegin() error = %v", err)
		}
		receiverPubJWK, receiverPubFpr := generateReceiverPublicKey(t)

		_, err = fixture.svc.LockCommit(fixture.ctx, LockCommitInput{
			UUID:            fixture.uuid,
			LockChallengeID: begin.LockChallenge.ID,
			LockProof:       strings.Repeat("0", 64),
			ReceiverPubJWK:  receiverPubJWK,
			ReceiverPubFpr:  receiverPubFpr,
			LockedAt:        time.Now().UTC().UnixMilli(),
		})
		requireProtocolError(t, err, "LOCK_FORBIDDEN", 403)
	})

	t.Run("intent hash mismatch is rejected", func(t *testing.T) {
		fixture := newLockedSecureFixture(t, 3)
		begin, intent := beginSignedUpdate(t, fixture, 0, "nonce-regression-hash", 2, nil)
		wrongIntentHash := strings.Repeat("f", 64)

		_, err := fixture.svc.CompoundCommit(fixture.ctx, CompoundCommitInput{
			UUID:       fixture.uuid,
			Assertion:  buildRegressionAssertionWithIntentHash(t, fixture.credential, begin, fixture.uuid, wrongIntentHash, 2),
			IntentHash: wrongIntentHash,
			Intent:     intent,
		})
		requireProtocolError(t, err, "INTENT_HASH_MISMATCH", 400)
	})

	t.Run("nonce replay is rejected", func(t *testing.T) {
		fixture := newLockedSecureFixture(t, 4)
		firstBegin, firstIntent := beginSignedUpdate(t, fixture, 0, "nonce-regression-replay", 2, nil)
		firstHash := mustIntentHash(t, firstIntent)

		if _, err := fixture.svc.CompoundCommit(fixture.ctx, CompoundCommitInput{
			UUID:       fixture.uuid,
			Assertion:  buildRegressionAssertion(t, fixture.credential, regressionRPID, regressionRPOrigin, firstBegin, firstIntent, 2),
			IntentHash: firstHash,
			Intent:     firstIntent,
		}); err != nil {
			t.Fatalf("first CompoundCommit() error = %v", err)
		}

		secondBegin, secondIntent := beginSignedUpdate(t, fixture, 1, "nonce-regression-replay", 3, nil)
		secondHash := mustIntentHash(t, secondIntent)

		_, err := fixture.svc.CompoundCommit(fixture.ctx, CompoundCommitInput{
			UUID:       fixture.uuid,
			Assertion:  buildRegressionAssertion(t, fixture.credential, regressionRPID, regressionRPOrigin, secondBegin, secondIntent, 3),
			IntentHash: secondHash,
			Intent:     secondIntent,
		})
		requireProtocolError(t, err, "NONCE_REPLAY", 409)
	})

	t.Run("stale version commits are rejected", func(t *testing.T) {
		fixture := newLockedSecureFixture(t, 5)
		firstBegin, firstIntent := beginSignedUpdate(t, fixture, 0, "nonce-regression-version-1", 2, nil)
		firstHash := mustIntentHash(t, firstIntent)

		if _, err := fixture.svc.CompoundCommit(fixture.ctx, CompoundCommitInput{
			UUID:       fixture.uuid,
			Assertion:  buildRegressionAssertion(t, fixture.credential, regressionRPID, regressionRPOrigin, firstBegin, firstIntent, 2),
			IntentHash: firstHash,
			Intent:     firstIntent,
		}); err != nil {
			t.Fatalf("first CompoundCommit() error = %v", err)
		}

		secondBegin, secondIntent := beginSignedUpdate(t, fixture, 0, "nonce-regression-version-2", 3, nil)
		secondHash := mustIntentHash(t, secondIntent)

		_, err := fixture.svc.CompoundCommit(fixture.ctx, CompoundCommitInput{
			UUID:       fixture.uuid,
			Assertion:  buildRegressionAssertion(t, fixture.credential, regressionRPID, regressionRPOrigin, secondBegin, secondIntent, 3),
			IntentHash: secondHash,
			Intent:     secondIntent,
		})
		requireProtocolError(t, err, "VERSION_MISMATCH", 409)
	})

	t.Run("bad webauthn assertion is rejected", func(t *testing.T) {
		fixture := newLockedSecureFixture(t, 6)
		_, intent := beginSignedUpdate(t, fixture, 0, "nonce-regression-assertion", 2, nil)
		intentHash := mustIntentHash(t, intent)
		wrongChallenge := encodeBase64URL([]byte("wrong-regression-challenge"))
		clientDataJSON := mustRegressionClientData(t, wrongChallenge)
		authenticatorData := buildRegressionAuthenticatorData(regressionRPID, 2)
		signature := signRegressionAssertion(
			t,
			fixture.credential.privateKey,
			authenticatorData,
			mustDecodeBase64URL(t, clientDataJSON),
		)

		_, err := fixture.svc.CompoundCommit(fixture.ctx, CompoundCommitInput{
			UUID: fixture.uuid,
			Assertion: &AssertionJSON{
				ID:    fixture.credential.credentialID,
				RawID: fixture.credential.credentialID,
				Type:  "public-key",
				Response: AssertionResponseJSON{
					ClientDataJSON:    clientDataJSON,
					AuthenticatorData: encodeBase64URL(authenticatorData),
					Signature:         encodeBase64URL(signature),
				},
			},
			IntentHash: intentHash,
			Intent:     intent,
		})
		requireProtocolError(t, err, "ASSERTION_INVALID", 403)
	})

	t.Run("ciphertext integrity failures are rejected", func(t *testing.T) {
		fixture := newLockedSecureFixture(t, 7)
		begin, intent := beginSignedUpdate(t, fixture, 0, "nonce-regression-cipher", 2, func(intent *ManageIntent) {
			intent.CipherBundle.CiphertextHash = strings.Repeat("f", 64)
		})
		intentHash := mustIntentHash(t, intent)

		_, err := fixture.svc.CompoundCommit(fixture.ctx, CompoundCommitInput{
			UUID:       fixture.uuid,
			Assertion:  buildRegressionAssertion(t, fixture.credential, regressionRPID, regressionRPOrigin, begin, intent, 2),
			IntentHash: intentHash,
			Intent:     intent,
		})
		requireProtocolError(t, err, "CIPHER_BUNDLE_INVALID", 400)
	})
}

func newSecureFixture(t *testing.T, seed int) secureFixture {
	t.Helper()

	db := openTestDatabase(t)
	resetTestTables(t, db)

	credential := generateRegressionCredential(t)
	svc := NewProtocolService(db, ProtocolConfig{
		RPID:     regressionRPID,
		RPOrigin: regressionRPOrigin,
		Verifier: regressionVerifier{
			attestation: webauthn.AttestationResult{
				Verified:     true,
				Format:       "none",
				CredentialID: credential.credentialID,
				PublicKey:    credential.publicKey,
				SignCount:    1,
				AAGUID:       encodeBase64URL([]byte("regression-aaguid")),
			},
		},
	})

	ctx := context.Background()
	uuid := fmt.Sprintf("rg%019d", seed)
	lockKeyB64u := encodeBase64URL([]byte(fmt.Sprintf("regression-lock-key-%04d", seed)))
	now := time.Now().UTC().UnixMilli()

	if _, err := svc.CreateBegin(ctx, CreateBeginInput{
		UUID:            uuid,
		Timestamp:       &now,
		SecurityProfile: string(store.SecurityProfileSecure),
	}); err != nil {
		t.Fatalf("CreateBegin() error = %v", err)
	}
	if _, err := svc.CreateFinish(ctx, CreateFinishInput{
		AdminMode:   string(store.AdminModeWebAuthn),
		UUID:        uuid,
		Attestation: sampleAttestation(),
		LockKeyB64u: lockKeyB64u,
		Timestamp:   &now,
	}); err != nil {
		t.Fatalf("CreateFinish() error = %v", err)
	}

	return secureFixture{
		ctx:         ctx,
		svc:         svc,
		uuid:        uuid,
		lockKeyB64u: lockKeyB64u,
		credential:  credential,
	}
}

func newLockedSecureFixture(t *testing.T, seed int) secureFixture {
	t.Helper()

	fixture := newSecureFixture(t, seed)
	begin, err := fixture.svc.LockBegin(fixture.ctx, LockBeginInput{UUID: fixture.uuid})
	if err != nil {
		t.Fatalf("LockBegin() error = %v", err)
	}
	receiverPubJWK, receiverPubFpr := generateReceiverPublicKey(t)
	lockProof, err := computeLockProof(
		fixture.uuid,
		begin.LockChallenge.ID,
		begin.LockChallenge.Challenge,
		fixture.lockKeyB64u,
	)
	if err != nil {
		t.Fatalf("computeLockProof() error = %v", err)
	}
	if _, err := fixture.svc.LockCommit(fixture.ctx, LockCommitInput{
		UUID:            fixture.uuid,
		LockChallengeID: begin.LockChallenge.ID,
		LockProof:       lockProof,
		ReceiverPubJWK:  receiverPubJWK,
		ReceiverPubFpr:  receiverPubFpr,
		LockedAt:        time.Now().UTC().UnixMilli(),
	}); err != nil {
		t.Fatalf("LockCommit() error = %v", err)
	}

	fixture.receiverPubJWK = receiverPubJWK
	fixture.receiverPubFpr = receiverPubFpr
	return fixture
}

func beginSignedUpdate(
	t *testing.T,
	fixture secureFixture,
	version int64,
	nonceSeed string,
	signCount uint32,
	mutate func(*ManageIntent),
) (CompoundBeginOutput, ManageIntent) {
	t.Helper()

	begin, err := fixture.svc.CompoundBegin(fixture.ctx, CompoundBeginInput{UUID: fixture.uuid})
	if err != nil {
		t.Fatalf("CompoundBegin() error = %v", err)
	}

	intent := ManageIntent{
		Op:             "update",
		UUID:           fixture.uuid,
		Version:        version,
		Timestamp:      time.Now().UTC().UnixMilli(),
		Nonce:          encodeBase64URL([]byte(nonceSeed)),
		ReceiverPubFpr: fixture.receiverPubFpr,
		CipherBundle:   buildCipherBundle(t, fixture.uuid, version, fixture.receiverPubFpr, []byte(fmt.Sprintf("ciphertext-%d-%d", version, signCount))),
		ExpireAt:       json.RawMessage("null"),
	}
	if mutate != nil {
		mutate(&intent)
	}

	return begin, intent
}

func buildRegressionAssertion(
	t *testing.T,
	credential regressionCredential,
	rpID string,
	origin string,
	begin CompoundBeginOutput,
	intent ManageIntent,
	signCount uint32,
) *AssertionJSON {
	t.Helper()

	intentHash := mustIntentHash(t, intent)
	return buildRegressionAssertionWithIntentHash(t, credential, begin, intent.UUID, intentHash, signCount)
}

func buildRegressionAssertionWithIntentHash(
	t *testing.T,
	credential regressionCredential,
	begin CompoundBeginOutput,
	uuid string,
	intentHash string,
	signCount uint32,
) *AssertionJSON {
	t.Helper()

	expectedChallenge, err := computeExpectedCompoundChallengeBytes(
		uuid,
		intentHash,
		&store.ActiveChallenge{
			ChallengeID:   stringPtr(begin.Challenge.ID),
			ChallengeSeed: stringPtr(begin.Challenge.Seed),
		},
		"update",
	)
	if err != nil {
		t.Fatalf("computeExpectedCompoundChallengeBytes() error = %v", err)
	}
	clientDataJSON := mustRegressionClientData(t, encodeBase64URL(expectedChallenge))
	authenticatorData := buildRegressionAuthenticatorData(regressionRPID, signCount)
	signature := signRegressionAssertion(t, credential.privateKey, authenticatorData, mustDecodeBase64URL(t, clientDataJSON))

	return &AssertionJSON{
		ID:    credential.credentialID,
		RawID: credential.credentialID,
		Type:  "public-key",
		Response: AssertionResponseJSON{
			ClientDataJSON:    clientDataJSON,
			AuthenticatorData: encodeBase64URL(authenticatorData),
			Signature:         encodeBase64URL(signature),
		},
	}
}

func generateRegressionCredential(t *testing.T) regressionCredential {
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

	return regressionCredential{
		privateKey:   privateKey,
		credentialID: encodeBase64URL([]byte("regression-credential-id")),
		publicKey:    encodeBase64URL(cosePublicKey),
	}
}

func mustIntentHash(t *testing.T, intent ManageIntent) string {
	t.Helper()

	hash, err := intent.ComputeHash()
	if err != nil {
		t.Fatalf("intent.ComputeHash() error = %v", err)
	}
	return hash
}

func mustRegressionClientData(t *testing.T, challengeB64u string) string {
	t.Helper()

	clientDataJSON, err := json.Marshal(map[string]any{
		"type":      "webauthn.get",
		"origin":    regressionRPOrigin,
		"challenge": challengeB64u,
	})
	if err != nil {
		t.Fatalf("json.Marshal(clientData) error = %v", err)
	}
	return encodeBase64URL(clientDataJSON)
}

func buildRegressionAuthenticatorData(rpID string, signCount uint32) []byte {
	rpIDHash := sha256.Sum256([]byte(rpID))
	data := make([]byte, 37)
	copy(data[:32], rpIDHash[:])
	data[32] = 0x01 | 0x04
	binary.BigEndian.PutUint32(data[33:], signCount)
	return data
}

func signRegressionAssertion(
	t *testing.T,
	privateKey *ecdsa.PrivateKey,
	authenticatorData []byte,
	clientDataJSON []byte,
) []byte {
	t.Helper()

	clientDataHash := sha256.Sum256(clientDataJSON)
	payload := make([]byte, 0, len(authenticatorData)+len(clientDataHash))
	payload = append(payload, authenticatorData...)
	payload = append(payload, clientDataHash[:]...)
	digest := sha256.Sum256(payload)

	signature, err := ecdsa.SignASN1(rand.Reader, privateKey, digest[:])
	if err != nil {
		t.Fatalf("ecdsa.SignASN1() error = %v", err)
	}
	return signature
}

func mustDecodeBase64URL(t *testing.T, value string) []byte {
	t.Helper()

	decoded, err := base64.RawURLEncoding.DecodeString(value)
	if err != nil {
		t.Fatalf("base64.RawURLEncoding.DecodeString() error = %v", err)
	}
	return decoded
}
