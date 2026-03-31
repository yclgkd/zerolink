package service

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math/big"
	"testing"
	"time"

	"github.com/yclgkd/ZeroLink/services/selfhost-api/internal/store"
	"github.com/yclgkd/ZeroLink/services/selfhost-api/internal/webauthn"
)

func TestProtocolServicePasswordHappyPathLockDeliverDecrypt(t *testing.T) {
	db := openTestDatabase(t)
	resetTestTables(t, db)

	svc := NewProtocolService(db, ProtocolConfig{
		RPID:     "localhost",
		RPOrigin: "http://localhost:5173",
		Verifier: webauthn.NoopVerifier{},
	})

	ctx := context.Background()
	timestamp := time.Now().UTC().UnixMilli()
	uuid := "mmmmmmmmmmmmmmmmmmmmm"
	lockKeyB64u := encodeBase64URL([]byte("lock-key-manage-flow-000000000001"))
	softkeyPrivateKey, softkeyPubJWK := generateSoftkeyKeyPair(t)

	if _, err := svc.CreateBegin(ctx, CreateBeginInput{
		UUID:            uuid,
		Timestamp:       &timestamp,
		SecurityProfile: string(store.SecurityProfileQuick),
	}); err != nil {
		t.Fatalf("CreateBegin() error = %v", err)
	}
	if _, err := svc.CreateFinish(ctx, CreateFinishInput{
		AdminMode:     string(store.AdminModePassword),
		UUID:          uuid,
		SoftkeyPubJWK: softkeyPubJWK,
		LockKeyB64u:   lockKeyB64u,
		Timestamp:     &timestamp,
	}); err != nil {
		t.Fatalf("CreateFinish() error = %v", err)
	}

	lockBegin, err := svc.LockBegin(ctx, LockBeginInput{UUID: uuid})
	if err != nil {
		t.Fatalf("LockBegin() error = %v", err)
	}
	receiverPubJWK, receiverPubFpr := generateReceiverPublicKey(t)
	lockProof, err := computeLockProof(uuid, lockBegin.LockChallenge.ID, lockBegin.LockChallenge.Challenge, lockKeyB64u)
	if err != nil {
		t.Fatalf("computeLockProof() error = %v", err)
	}
	if _, err := svc.LockCommit(ctx, LockCommitInput{
		UUID:            uuid,
		LockChallengeID: lockBegin.LockChallenge.ID,
		LockProof:       lockProof,
		ReceiverPubJWK:  receiverPubJWK,
		ReceiverPubFpr:  receiverPubFpr,
		LockedAt:        timestamp + 1_000,
	}); err != nil {
		t.Fatalf("LockCommit() error = %v", err)
	}

	compoundBegin, err := svc.CompoundBegin(ctx, CompoundBeginInput{UUID: uuid})
	if err != nil {
		t.Fatalf("CompoundBegin() error = %v", err)
	}
	if compoundBegin.AdminMode != string(store.AdminModePassword) {
		t.Fatalf("compoundBegin.AdminMode = %q, want password", compoundBegin.AdminMode)
	}
	if compoundBegin.CurrentVersion != 0 {
		t.Fatalf("compoundBegin.CurrentVersion = %d, want 0", compoundBegin.CurrentVersion)
	}

	intent := ManageIntent{
		Op:             "update",
		UUID:           uuid,
		Version:        0,
		Timestamp:      timestamp + 2_000,
		Nonce:          encodeBase64URL([]byte("nonce-manage-flow-000001")),
		ReceiverPubFpr: receiverPubFpr,
		CipherBundle:   buildCipherBundle(t, uuid, 0, receiverPubFpr, []byte("ciphertext-001")),
		ExpireAt:       json.RawMessage("null"),
	}
	intentHash, err := intent.ComputeHash()
	if err != nil {
		t.Fatalf("intent.ComputeHash() error = %v", err)
	}
	expectedChallenge, err := computeExpectedCompoundChallengeBytes(
		uuid,
		intentHash,
		&store.ActiveChallenge{
			ChallengeID:   stringPtr(compoundBegin.Challenge.ID),
			ChallengeSeed: stringPtr(compoundBegin.Challenge.Seed),
		},
		intent.Op,
	)
	if err != nil {
		t.Fatalf("computeExpectedCompoundChallengeBytes() error = %v", err)
	}
	signature := signSoftkeyPayload(t, softkeyPrivateKey, expectedChallenge)

	if _, err := svc.CompoundCommit(ctx, CompoundCommitInput{
		AdminMode:        string(store.AdminModePassword),
		UUID:             uuid,
		SoftkeySignature: signature,
		IntentHash:       intentHash,
		Intent:           intent,
	}); err != nil {
		t.Fatalf("CompoundCommit() error = %v", err)
	}

	decryptFetch, err := svc.DecryptFetch(ctx, uuid)
	if err != nil {
		t.Fatalf("DecryptFetch() error = %v", err)
	}
	if decryptFetch.CipherVersion != 0 {
		t.Fatalf("decryptFetch.CipherVersion = %d, want 0", decryptFetch.CipherVersion)
	}
	if decryptFetch.ReceiverPubFpr != receiverPubFpr {
		t.Fatalf("decryptFetch.ReceiverPubFpr = %q, want %q", decryptFetch.ReceiverPubFpr, receiverPubFpr)
	}
	if decryptFetch.DeliveredAt != intent.Timestamp {
		t.Fatalf("decryptFetch.DeliveredAt = %d, want %d", decryptFetch.DeliveredAt, intent.Timestamp)
	}
	if decryptFetch.CipherBundle.Ciphertext != intent.CipherBundle.Ciphertext {
		t.Fatalf("decryptFetch.CipherBundle.Ciphertext = %q, want %q", decryptFetch.CipherBundle.Ciphertext, intent.CipherBundle.Ciphertext)
	}

	var deliveryAuth struct {
		AdminMode string `json:"adminMode"`
		Signer    struct {
			SoftkeyPubJWK ECDSAPublicKeyJWK `json:"softkeyPubJwk"`
		} `json:"signer"`
		Meta struct {
			Version   int64  `json:"version"`
			Timestamp int64  `json:"timestamp"`
			Nonce     string `json:"nonce"`
			ExpireAt  *int64 `json:"expireAt"`
		} `json:"meta"`
		Proof struct {
			SoftkeySignature string `json:"softkeySignature"`
		} `json:"proof"`
	}
	if err := json.Unmarshal(decryptFetch.DeliveryAuth, &deliveryAuth); err != nil {
		t.Fatalf("unmarshal deliveryAuth: %v", err)
	}
	if deliveryAuth.AdminMode != string(store.AdminModePassword) {
		t.Fatalf("deliveryAuth.AdminMode = %q, want password", deliveryAuth.AdminMode)
	}
	if deliveryAuth.Meta.Version != intent.Version {
		t.Fatalf("deliveryAuth.Meta.Version = %d, want %d", deliveryAuth.Meta.Version, intent.Version)
	}
	if deliveryAuth.Meta.ExpireAt != nil {
		t.Fatalf("deliveryAuth.Meta.ExpireAt = %v, want nil", deliveryAuth.Meta.ExpireAt)
	}
	if deliveryAuth.Proof.SoftkeySignature != signature {
		t.Fatalf("deliveryAuth.Proof.SoftkeySignature = %q, want %q", deliveryAuth.Proof.SoftkeySignature, signature)
	}
	if deliveryAuth.Signer.SoftkeyPubJWK.X != softkeyPubJWK.X {
		t.Fatalf("deliveryAuth signer mismatch")
	}

	if err := db.WithChannelTx(ctx, uuid, func(ctx context.Context, tx *store.ChannelTx) error {
		channel, err := tx.GetChannel(ctx)
		if err != nil {
			return err
		}
		if channel == nil {
			t.Fatal("expected delivered channel to remain active")
		}
		if channel.State != store.ChannelStateDelivered {
			t.Fatalf("channel.State = %s, want delivered", channel.State)
		}
		if channel.Version != 1 {
			t.Fatalf("channel.Version = %d, want 1", channel.Version)
		}
		challenge, err := tx.GetChallenge(ctx, store.ChallengeKindCompound)
		if err != nil {
			return err
		}
		if challenge == nil || challenge.ConsumedAt == nil {
			t.Fatal("expected compound challenge to be consumed")
		}
		return nil
	}); err != nil {
		t.Fatalf("inspect delivered channel: %v", err)
	}
}

func TestProtocolServiceDeleteCommitFinalizesDeletedTombstone(t *testing.T) {
	db := openTestDatabase(t)
	resetTestTables(t, db)

	svc := NewProtocolService(db, ProtocolConfig{
		RPID:     "localhost",
		RPOrigin: "http://localhost:5173",
		Verifier: webauthn.NoopVerifier{},
	})

	uuid := "nnnnnnnnnnnnnnnnnnnnn"
	timestamp := time.Now().UTC().UnixMilli()
	softkeyPrivateKey, softkeyPubJWK := generateSoftkeyKeyPair(t)

	createAndLockPasswordChannel(t, svc, uuid, timestamp, softkeyPubJWK)

	begin, err := svc.CompoundBegin(context.Background(), CompoundBeginInput{UUID: uuid})
	if err != nil {
		t.Fatalf("CompoundBegin() error = %v", err)
	}

	intent := ManageIntent{
		Op:        "delete",
		UUID:      uuid,
		Version:   begin.CurrentVersion,
		Timestamp: timestamp + 3_000,
		Nonce:     encodeBase64URL([]byte("nonce-delete-flow-000001")),
	}
	intentHash, err := intent.ComputeHash()
	if err != nil {
		t.Fatalf("intent.ComputeHash() error = %v", err)
	}
	expectedChallenge, err := computeExpectedCompoundChallengeBytes(
		uuid,
		intentHash,
		&store.ActiveChallenge{
			ChallengeID:   stringPtr(begin.Challenge.ID),
			ChallengeSeed: stringPtr(begin.Challenge.Seed),
		},
		intent.Op,
	)
	if err != nil {
		t.Fatalf("computeExpectedCompoundChallengeBytes() error = %v", err)
	}
	signature := signSoftkeyPayload(t, softkeyPrivateKey, expectedChallenge)

	if _, err := svc.CompoundCommit(context.Background(), CompoundCommitInput{
		AdminMode:        string(store.AdminModePassword),
		UUID:             uuid,
		SoftkeySignature: signature,
		IntentHash:       intentHash,
		Intent:           intent,
	}); err != nil {
		t.Fatalf("CompoundCommit() error = %v", err)
	}

	_, err = svc.PublicStatus(context.Background(), uuid)
	requireProtocolError(t, err, "NOT_FOUND", 404)

	if err := db.WithChannelTx(context.Background(), uuid, func(ctx context.Context, tx *store.ChannelTx) error {
		channel, err := tx.GetChannel(ctx)
		if err != nil {
			return err
		}
		if channel != nil {
			t.Fatal("expected channel row to be deleted")
		}
		tombstone, err := tx.GetTerminalTombstone(ctx)
		if err != nil {
			return err
		}
		if tombstone == nil {
			t.Fatal("expected deleted tombstone to be stored")
		}
		if tombstone.Reason != store.TerminalReasonDeleted {
			t.Fatalf("tombstone.Reason = %s, want deleted", tombstone.Reason)
		}
		return nil
	}); err != nil {
		t.Fatalf("inspect deleted tombstone: %v", err)
	}
}

func TestProtocolServiceCompoundCommitRejectsVersionMismatch(t *testing.T) {
	db := openTestDatabase(t)
	resetTestTables(t, db)

	svc := NewProtocolService(db, ProtocolConfig{
		RPID:     "localhost",
		RPOrigin: "http://localhost:5173",
		Verifier: webauthn.NoopVerifier{},
	})

	uuid := "ooooooooooooooooooooo"
	timestamp := time.Now().UTC().UnixMilli()
	softkeyPrivateKey, softkeyPubJWK := generateSoftkeyKeyPair(t)
	_, receiverPubFpr := createAndLockPasswordChannel(t, svc, uuid, timestamp, softkeyPubJWK)

	intent := ManageIntent{
		Op:             "update",
		UUID:           uuid,
		Version:        99,
		Timestamp:      timestamp + 2_000,
		Nonce:          encodeBase64URL([]byte("nonce-version-mismatch")),
		ReceiverPubFpr: receiverPubFpr,
		CipherBundle:   buildCipherBundle(t, uuid, 99, receiverPubFpr, []byte("ciphertext-version")),
		ExpireAt:       json.RawMessage("null"),
	}
	intentHash, err := intent.ComputeHash()
	if err != nil {
		t.Fatalf("intent.ComputeHash() error = %v", err)
	}
	signature := signSoftkeyPayload(t, softkeyPrivateKey, []byte("version-mismatch"))

	_, err = svc.CompoundCommit(context.Background(), CompoundCommitInput{
		AdminMode:        string(store.AdminModePassword),
		UUID:             uuid,
		SoftkeySignature: signature,
		IntentHash:       intentHash,
		Intent:           intent,
	})
	requireProtocolError(t, err, "VERSION_MISMATCH", 409)
}

func TestProtocolServiceCompoundCommitRejectsNonceReplay(t *testing.T) {
	db := openTestDatabase(t)
	resetTestTables(t, db)

	svc := NewProtocolService(db, ProtocolConfig{
		RPID:     "localhost",
		RPOrigin: "http://localhost:5173",
		Verifier: webauthn.NoopVerifier{},
	})

	uuid := "ppppppppppppppppppppp"
	timestamp := time.Now().UTC().UnixMilli()
	softkeyPrivateKey, softkeyPubJWK := generateSoftkeyKeyPair(t)
	_, receiverPubFpr := createAndLockPasswordChannel(t, svc, uuid, timestamp, softkeyPubJWK)

	firstBegin, err := svc.CompoundBegin(context.Background(), CompoundBeginInput{UUID: uuid})
	if err != nil {
		t.Fatalf("first CompoundBegin() error = %v", err)
	}

	firstIntent := ManageIntent{
		Op:             "update",
		UUID:           uuid,
		Version:        0,
		Timestamp:      timestamp + 2_000,
		Nonce:          encodeBase64URL([]byte("nonce-replay-000001")),
		ReceiverPubFpr: receiverPubFpr,
		CipherBundle:   buildCipherBundle(t, uuid, 0, receiverPubFpr, []byte("ciphertext-one")),
		ExpireAt:       json.RawMessage("null"),
	}
	firstHash, err := firstIntent.ComputeHash()
	if err != nil {
		t.Fatalf("firstIntent.ComputeHash() error = %v", err)
	}
	firstChallenge, err := computeExpectedCompoundChallengeBytes(
		uuid,
		firstHash,
		&store.ActiveChallenge{
			ChallengeID:   stringPtr(firstBegin.Challenge.ID),
			ChallengeSeed: stringPtr(firstBegin.Challenge.Seed),
		},
		firstIntent.Op,
	)
	if err != nil {
		t.Fatalf("computeExpectedCompoundChallengeBytes() error = %v", err)
	}
	firstSignature := signSoftkeyPayload(t, softkeyPrivateKey, firstChallenge)

	if _, err := svc.CompoundCommit(context.Background(), CompoundCommitInput{
		AdminMode:        string(store.AdminModePassword),
		UUID:             uuid,
		SoftkeySignature: firstSignature,
		IntentHash:       firstHash,
		Intent:           firstIntent,
	}); err != nil {
		t.Fatalf("first CompoundCommit() error = %v", err)
	}

	secondBegin, err := svc.CompoundBegin(context.Background(), CompoundBeginInput{UUID: uuid})
	if err != nil {
		t.Fatalf("second CompoundBegin() error = %v", err)
	}

	secondIntent := ManageIntent{
		Op:             "update",
		UUID:           uuid,
		Version:        1,
		Timestamp:      timestamp + 4_000,
		Nonce:          firstIntent.Nonce,
		ReceiverPubFpr: receiverPubFpr,
		CipherBundle:   buildCipherBundle(t, uuid, 1, receiverPubFpr, []byte("ciphertext-two")),
		ExpireAt:       json.RawMessage("null"),
	}
	secondHash, err := secondIntent.ComputeHash()
	if err != nil {
		t.Fatalf("secondIntent.ComputeHash() error = %v", err)
	}
	secondChallenge, err := computeExpectedCompoundChallengeBytes(
		uuid,
		secondHash,
		&store.ActiveChallenge{
			ChallengeID:   stringPtr(secondBegin.Challenge.ID),
			ChallengeSeed: stringPtr(secondBegin.Challenge.Seed),
		},
		secondIntent.Op,
	)
	if err != nil {
		t.Fatalf("computeExpectedCompoundChallengeBytes() error = %v", err)
	}
	secondSignature := signSoftkeyPayload(t, softkeyPrivateKey, secondChallenge)

	_, err = svc.CompoundCommit(context.Background(), CompoundCommitInput{
		AdminMode:        string(store.AdminModePassword),
		UUID:             uuid,
		SoftkeySignature: secondSignature,
		IntentHash:       secondHash,
		Intent:           secondIntent,
	})
	requireProtocolError(t, err, "NONCE_REPLAY", 409)
}

func createAndLockPasswordChannel(
	t *testing.T,
	svc Protocol,
	uuid string,
	timestamp int64,
	softkeyPubJWK *ECDSAPublicKeyJWK,
) (RSAPublicKeyJWK, string) {
	t.Helper()

	lockKeyB64u := encodeBase64URL([]byte("lock-key-password-channel-0000001"))
	if _, err := svc.CreateBegin(context.Background(), CreateBeginInput{
		UUID:            uuid,
		Timestamp:       &timestamp,
		SecurityProfile: string(store.SecurityProfileQuick),
	}); err != nil {
		t.Fatalf("CreateBegin() error = %v", err)
	}
	if _, err := svc.CreateFinish(context.Background(), CreateFinishInput{
		AdminMode:     string(store.AdminModePassword),
		UUID:          uuid,
		SoftkeyPubJWK: softkeyPubJWK,
		LockKeyB64u:   lockKeyB64u,
		Timestamp:     &timestamp,
	}); err != nil {
		t.Fatalf("CreateFinish() error = %v", err)
	}

	lockBegin, err := svc.LockBegin(context.Background(), LockBeginInput{UUID: uuid})
	if err != nil {
		t.Fatalf("LockBegin() error = %v", err)
	}

	receiverPubJWK, receiverPubFpr := generateReceiverPublicKey(t)
	lockProof, err := computeLockProof(uuid, lockBegin.LockChallenge.ID, lockBegin.LockChallenge.Challenge, lockKeyB64u)
	if err != nil {
		t.Fatalf("computeLockProof() error = %v", err)
	}
	if _, err := svc.LockCommit(context.Background(), LockCommitInput{
		UUID:            uuid,
		LockChallengeID: lockBegin.LockChallenge.ID,
		LockProof:       lockProof,
		ReceiverPubJWK:  receiverPubJWK,
		ReceiverPubFpr:  receiverPubFpr,
		LockedAt:        timestamp + 1_000,
	}); err != nil {
		t.Fatalf("LockCommit() error = %v", err)
	}

	return receiverPubJWK, receiverPubFpr
}

func generateSoftkeyKeyPair(t *testing.T) (*ecdsa.PrivateKey, *ECDSAPublicKeyJWK) {
	t.Helper()

	privateKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("ecdsa.GenerateKey() error = %v", err)
	}

	return privateKey, &ECDSAPublicKeyJWK{
		KTY:    "EC",
		CRV:    "P-256",
		X:      encodeBase64URL(privateKey.PublicKey.X.FillBytes(make([]byte, 32))),
		Y:      encodeBase64URL(privateKey.PublicKey.Y.FillBytes(make([]byte, 32))),
		Ext:    true,
		KeyOps: []string{"verify"},
	}
}

func signSoftkeyPayload(t *testing.T, privateKey *ecdsa.PrivateKey, payload []byte) string {
	t.Helper()

	digest := sha256.Sum256(payload)
	r, s, err := ecdsa.Sign(rand.Reader, privateKey, digest[:])
	if err != nil {
		t.Fatalf("ecdsa.Sign() error = %v", err)
	}

	signature := make([]byte, 64)
	copy(signature[:32], r.FillBytes(make([]byte, 32)))
	copy(signature[32:], s.FillBytes(make([]byte, 32)))
	return hex.EncodeToString(signature)
}

func generateReceiverPublicKey(t *testing.T) (RSAPublicKeyJWK, string) {
	t.Helper()

	privateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("rsa.GenerateKey() error = %v", err)
	}

	publicKey := privateKey.PublicKey
	jwk := RSAPublicKeyJWK{
		KTY:    "RSA",
		ALG:    "RSA-OAEP-256",
		N:      encodeBase64URL(publicKey.N.Bytes()),
		E:      encodeBase64URL(big.NewInt(int64(publicKey.E)).Bytes()),
		Ext:    true,
		KeyOps: []string{"encrypt"},
	}
	fingerprint, err := computeReceiverFingerprint(jwk)
	if err != nil {
		t.Fatalf("computeReceiverFingerprint() error = %v", err)
	}
	return jwk, fingerprint
}

func buildCipherBundle(
	t *testing.T,
	uuid string,
	version int64,
	receiverPubFpr string,
	ciphertext []byte,
) *CipherBundle {
	t.Helper()

	hash := sha256.Sum256(ciphertext)
	return &CipherBundle{
		Ciphertext:     encodeBase64URL(ciphertext),
		IV:             encodeBase64URL([]byte("cipher-iv-001")),
		AAD:            encodeBase64URL([]byte(uuid + "||" + int64String(version) + "||" + receiverPubFpr)),
		EncContentKey:  encodeBase64URL([]byte("encrypted-content-key")),
		CiphertextHash: hex.EncodeToString(hash[:]),
		PadBlock:       4096,
	}
}

func int64String(value int64) string {
	return fmt.Sprintf("%d", value)
}
