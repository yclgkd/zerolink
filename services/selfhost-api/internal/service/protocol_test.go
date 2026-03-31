package service

import (
	"bytes"
	"context"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/yclgkd/ZeroLink/services/selfhost-api/internal/config"
	"github.com/yclgkd/ZeroLink/services/selfhost-api/internal/store"
)

func TestProtocolServiceCreateQuickChannelAndReadPublicStatus(t *testing.T) {
	db := openTestDatabase(t)
	resetTestTables(t, db)

	svc := NewProtocolService(db, ProtocolConfig{
		RPID:     "localhost",
		RPOrigin: "http://localhost:5173",
	})

	ctx := context.Background()
	timestamp := int64(1_730_000_000_000)
	ttl := channelTTLOneHourMS
	uuid := "aaaaaaaaaaaaaaaaaaaaa"

	beginOutput, err := svc.CreateBegin(ctx, CreateBeginInput{
		UUID:            uuid,
		Timestamp:       &timestamp,
		SecurityProfile: string(store.SecurityProfileQuick),
		TTL:             &ttl,
	})
	if err != nil {
		t.Fatalf("CreateBegin() error = %v", err)
	}
	if !beginOutput.OK {
		t.Fatal("CreateBegin() ok = false, want true")
	}

	finishOutput, err := svc.CreateFinish(ctx, CreateFinishInput{
		AdminMode:     string(store.AdminModePassword),
		UUID:          uuid,
		SoftkeyPubJWK: sampleSoftkeyJWK(),
		LockKeyB64u:   encodeBase64URL([]byte("lock-key")),
		Timestamp:     &timestamp,
	})
	if err != nil {
		t.Fatalf("CreateFinish() error = %v", err)
	}
	if finishOutput.ShareURL != "http://localhost:5173/s/"+uuid {
		t.Fatalf("ShareURL = %q", finishOutput.ShareURL)
	}
	if finishOutput.ManageURL != "http://localhost:5173/m/"+uuid {
		t.Fatalf("ManageURL = %q", finishOutput.ManageURL)
	}

	status, err := svc.PublicStatus(ctx, uuid)
	if err != nil {
		t.Fatalf("PublicStatus() error = %v", err)
	}
	if status.State != string(store.ChannelStateWaiting) {
		t.Fatalf("state = %q, want waiting", status.State)
	}
	if status.AdminMode != string(store.AdminModePassword) {
		t.Fatalf("adminMode = %q, want password", status.AdminMode)
	}
	if status.SecurityProfile != string(store.SecurityProfileQuick) {
		t.Fatalf("securityProfile = %q, want quick", status.SecurityProfile)
	}

	if err := db.WithChannelTx(ctx, uuid, func(ctx context.Context, tx *store.ChannelTx) error {
		channel, err := tx.GetChannel(ctx)
		if err != nil {
			return err
		}
		if channel == nil {
			t.Fatal("expected channel row to exist")
		}
		if channel.AdminMode == nil || *channel.AdminMode != store.AdminModePassword {
			t.Fatalf("channel adminMode = %v, want password", channel.AdminMode)
		}
		if !bytes.Contains(channel.AdminCredential, []byte(`"type":"softkey"`)) {
			t.Fatalf("admin credential = %s, want softkey payload", string(channel.AdminCredential))
		}
		if channel.LockKey == nil || *channel.LockKey == "" {
			t.Fatal("expected lockKey to be stored after create_finish")
		}
		return nil
	}); err != nil {
		t.Fatalf("inspect stored quick channel: %v", err)
	}
}

func TestProtocolServiceCreateSecureChannelPersistsWebAuthnMetadata(t *testing.T) {
	db := openTestDatabase(t)
	resetTestTables(t, db)

	svc := NewProtocolService(db, ProtocolConfig{
		RPID:     "localhost",
		RPOrigin: "http://localhost:5173",
	})

	ctx := context.Background()
	timestamp := int64(1_730_000_000_000)
	ttl := channelTTLOneHourMS
	uuid := "bbbbbbbbbbbbbbbbbbbbb"

	if _, err := svc.CreateBegin(ctx, CreateBeginInput{
		UUID:            uuid,
		Timestamp:       &timestamp,
		SecurityProfile: string(store.SecurityProfileSecure),
		TTL:             &ttl,
	}); err != nil {
		t.Fatalf("CreateBegin() error = %v", err)
	}

	if _, err := svc.CreateFinish(ctx, CreateFinishInput{
		AdminMode:   string(store.AdminModeWebAuthn),
		UUID:        uuid,
		Attestation: sampleAttestation(),
		LockKeyB64u: encodeBase64URL([]byte("secure-lock-key")),
		Timestamp:   &timestamp,
	}); err != nil {
		t.Fatalf("CreateFinish() error = %v", err)
	}

	status, err := svc.PublicStatus(ctx, uuid)
	if err != nil {
		t.Fatalf("PublicStatus() error = %v", err)
	}
	if status.AdminMode != string(store.AdminModeWebAuthn) {
		t.Fatalf("adminMode = %q, want webauthn", status.AdminMode)
	}
	if status.SecurityProfile != string(store.SecurityProfileSecure) {
		t.Fatalf("securityProfile = %q, want secure", status.SecurityProfile)
	}

	if err := db.WithChannelTx(ctx, uuid, func(ctx context.Context, tx *store.ChannelTx) error {
		channel, err := tx.GetChannel(ctx)
		if err != nil {
			return err
		}
		if channel == nil {
			t.Fatal("expected channel row to exist")
		}
		if !bytes.Contains(channel.AdminCredential, []byte(`"credentialId":"Y3JlZC1pZA"`)) {
			t.Fatalf("admin credential = %s, want stored credential id", string(channel.AdminCredential))
		}
		if !bytes.Contains(channel.AdminCredential, []byte(`"attestationObject":"YXR0ZXN0YXRpb24tb2JqZWN0"`)) {
			t.Fatalf("admin credential = %s, want attestation metadata", string(channel.AdminCredential))
		}
		return nil
	}); err != nil {
		t.Fatalf("inspect stored secure channel: %v", err)
	}
}

func TestProtocolServiceRejectsSecurePasswordDowngrade(t *testing.T) {
	db := openTestDatabase(t)
	resetTestTables(t, db)

	svc := NewProtocolService(db, ProtocolConfig{
		RPID:     "localhost",
		RPOrigin: "http://localhost:5173",
	})

	ctx := context.Background()
	timestamp := int64(1_730_000_000_000)
	uuid := "ccccccccccccccccccccc"

	if _, err := svc.CreateBegin(ctx, CreateBeginInput{
		UUID:            uuid,
		Timestamp:       &timestamp,
		SecurityProfile: string(store.SecurityProfileSecure),
	}); err != nil {
		t.Fatalf("CreateBegin() error = %v", err)
	}

	_, err := svc.CreateFinish(ctx, CreateFinishInput{
		AdminMode:     string(store.AdminModePassword),
		UUID:          uuid,
		SoftkeyPubJWK: sampleSoftkeyJWK(),
		LockKeyB64u:   encodeBase64URL([]byte("downgrade-lock-key")),
		Timestamp:     &timestamp,
	})
	requireProtocolError(t, err, "LOCK_FORBIDDEN", 403)
}

func TestProtocolServicePublicStatusFinalizesExpiredChannel(t *testing.T) {
	db := openTestDatabase(t)
	resetTestTables(t, db)

	svc := NewProtocolService(db, ProtocolConfig{
		RPID:     "localhost",
		RPOrigin: "http://localhost:5173",
	})

	ctx := context.Background()
	now := time.Now().UTC()
	uuid := "ddddddddddddddddddddd"
	adminMode := store.AdminModeWebAuthn
	lockKey := ""

	if err := db.WithChannelTx(ctx, uuid, func(ctx context.Context, tx *store.ChannelTx) error {
		placeholderCredential := []byte(`{"credentialId":"","publicKey":"","signCount":0,"aaguid":"","attestation":{"response":{}}}`)
		_, err := tx.SaveChannel(ctx, store.Channel{
			UUID:            uuid,
			State:           store.ChannelStateWaiting,
			CreatedAt:       now.Add(-2 * time.Hour),
			ExpiresAt:       now.Add(-time.Minute),
			TTLMS:           channelTTLOneHourMS,
			SecurityProfile: store.SecurityProfileQuick,
			AdminMode:       &adminMode,
			AdminCredential: placeholderCredential,
			LockKey:         &lockKey,
			Version:         0,
		})
		return err
	}); err != nil {
		t.Fatalf("seed expired channel: %v", err)
	}

	_, err := svc.PublicStatus(ctx, uuid)
	requireProtocolError(t, err, "NOT_FOUND", 404)

	if err := db.WithChannelTx(ctx, uuid, func(ctx context.Context, tx *store.ChannelTx) error {
		tombstone, err := tx.GetTerminalTombstone(ctx)
		if err != nil {
			return err
		}
		if tombstone == nil {
			t.Fatal("expected expired channel to be finalized into a tombstone")
		}
		if tombstone.Reason != store.TerminalReasonExpired {
			t.Fatalf("tombstone reason = %s, want expired", tombstone.Reason)
		}
		return nil
	}); err != nil {
		t.Fatalf("inspect expired tombstone: %v", err)
	}
}

func requireProtocolError(t *testing.T, err error, code string, status int) {
	t.Helper()

	if err == nil {
		t.Fatalf("error = nil, want %s", code)
	}

	var protocolErr *ProtocolError
	if !errors.As(err, &protocolErr) {
		t.Fatalf("error = %T, want *ProtocolError", err)
	}
	if protocolErr.Code != code {
		t.Fatalf("protocolErr.Code = %q, want %q", protocolErr.Code, code)
	}
	if protocolErr.Status != status {
		t.Fatalf("protocolErr.Status = %d, want %d", protocolErr.Status, status)
	}
}

func sampleSoftkeyJWK() *ECDSAPublicKeyJWK {
	return &ECDSAPublicKeyJWK{
		KTY:    "EC",
		CRV:    "P-256",
		X:      "c29mdGtleS14",
		Y:      "c29mdGtleS15",
		Ext:    true,
		KeyOps: []string{"verify"},
	}
}

func sampleAttestation() *AttestationJSON {
	return &AttestationJSON{
		ID:    "Y3JlZC1pZA",
		RawID: "Y3JlZC1yYXc",
		Type:  "public-key",
		Response: AttestationResponseJSON{
			ClientDataJSON:    "Y2xpZW50LWRhdGE",
			AttestationObject: "YXR0ZXN0YXRpb24tb2JqZWN0",
			Transports:        []string{"internal"},
		},
	}
}

func openTestDatabase(t *testing.T) *store.Database {
	t.Helper()

	databaseURL := os.Getenv("SELFHOST_API_TEST_DATABASE_URL")
	if databaseURL == "" {
		if os.Getenv("CI") != "" {
			t.Fatal("SELFHOST_API_TEST_DATABASE_URL is not set in CI")
		}
		if os.Getenv("SELFHOST_API_DATABASE_URL") != "" {
			t.Skip("SELFHOST_API_TEST_DATABASE_URL is not set; refusing to run destructive service tests against SELFHOST_API_DATABASE_URL")
		}
		t.Skip("SELFHOST_API_TEST_DATABASE_URL is not set")
	}

	db, err := store.Open(context.Background(), config.DatabaseConfig{
		URL:            databaseURL,
		MaxConns:       8,
		MinConns:       0,
		ConnectTimeout: 5 * time.Second,
		HealthTimeout:  2 * time.Second,
	})
	if err != nil {
		t.Fatalf("open database: %v", err)
	}

	t.Cleanup(db.Close)

	if _, err := store.RunMigrations(context.Background(), db); err != nil {
		t.Fatalf("run migrations: %v", err)
	}

	return db
}

func resetTestTables(t *testing.T, db *store.Database) {
	t.Helper()

	if _, err := db.Pool().Exec(
		context.Background(),
		"TRUNCATE TABLE active_challenges, used_nonces, terminal_tombstones, channels",
	); err != nil {
		t.Fatalf("truncate test tables: %v", err)
	}
}
