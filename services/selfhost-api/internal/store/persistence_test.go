package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/yclgkd/ZeroLink/services/selfhost-api/internal/config"
)

func TestWithChannelTxSerializesSameChannel(t *testing.T) {
	db := openTestDatabase(t)
	resetTestTables(t, db)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	firstEntered := make(chan struct{})
	releaseFirst := make(chan struct{})
	secondEntered := make(chan struct{})
	firstErr := make(chan error, 1)
	secondErr := make(chan error, 1)

	go func() {
		firstErr <- db.WithChannelTx(ctx, "channel-lock-order", func(_ context.Context, _ *ChannelTx) error {
			close(firstEntered)
			<-releaseFirst
			return nil
		})
	}()

	<-firstEntered

	go func() {
		secondErr <- db.WithChannelTx(ctx, "channel-lock-order", func(_ context.Context, _ *ChannelTx) error {
			close(secondEntered)
			return nil
		})
	}()

	select {
	case <-secondEntered:
		t.Fatal("second transaction entered before first released the advisory lock")
	case <-time.After(250 * time.Millisecond):
	}

	close(releaseFirst)

	select {
	case <-secondEntered:
	case <-time.After(2 * time.Second):
		t.Fatal("second transaction did not enter after first released the advisory lock")
	}

	if err := <-firstErr; err != nil {
		t.Fatalf("first transaction error = %v", err)
	}
	if err := <-secondErr; err != nil {
		t.Fatalf("second transaction error = %v", err)
	}
}

func TestRegisterNonceRejectsActiveReplay(t *testing.T) {
	db := openTestDatabase(t)
	resetTestTables(t, db)

	ctx := context.Background()
	now := time.Now().UTC()
	channel := Channel{
		UUID:            "channel-nonce-replay",
		State:           ChannelStateWaiting,
		CreatedAt:       now.Add(-time.Minute),
		ExpiresAt:       now.Add(time.Hour),
		TTLMS:           int64(time.Hour / time.Millisecond),
		SecurityProfile: SecurityProfileSecure,
		Version:         0,
	}

	if err := db.WithChannelTx(ctx, channel.UUID, func(ctx context.Context, tx *ChannelTx) error {
		if _, err := tx.SaveChannel(ctx, channel); err != nil {
			return err
		}
		return tx.RegisterNonce(ctx, "nonce-replay", now, now.Add(10*time.Minute))
	}); err != nil {
		t.Fatalf("seed nonce: %v", err)
	}

	err := db.WithChannelTx(ctx, channel.UUID, func(ctx context.Context, tx *ChannelTx) error {
		return tx.RegisterNonce(ctx, "nonce-replay", now.Add(30*time.Second), now.Add(11*time.Minute))
	})
	if !errors.Is(err, ErrNonceReplay) {
		t.Fatalf("WithChannelTx() error = %v, want ErrNonceReplay", err)
	}
}

func TestLoadActiveChannelFinalizesExpiredRecordIntoExpiredTombstone(t *testing.T) {
	db := openTestDatabase(t)
	resetTestTables(t, db)

	ctx := context.Background()
	now := time.Now().UTC()
	channel := Channel{
		UUID:            "channel-expired-finalize",
		State:           ChannelStateLocked,
		CreatedAt:       now.Add(-2 * time.Hour),
		ExpiresAt:       now.Add(-time.Minute),
		TTLMS:           int64(time.Hour / time.Millisecond),
		SecurityProfile: SecurityProfileQuick,
		ReceiverPubJWK:  json.RawMessage(`{"kty":"RSA"}`),
		ReceiverPubFpr:  stringPtrValue("receiver-fingerprint"),
		LockedAt:        timePtrValue(now.Add(-90 * time.Minute)),
		Version:         0,
	}

	if err := db.WithChannelTx(ctx, channel.UUID, func(ctx context.Context, tx *ChannelTx) error {
		if _, err := tx.SaveChannel(ctx, channel); err != nil {
			return err
		}
		if _, err := tx.SaveChallenge(ctx, ActiveChallenge{
			Kind:           ChallengeKindLock,
			ChallengeID:    stringPtrValue("lock-challenge"),
			ChallengeValue: stringPtrValue("challenge-bytes"),
			IssuedAt:       timePtrValue(now.Add(-2 * time.Minute)),
			ExpiresAt:      timePtrValue(now.Add(-time.Minute)),
		}); err != nil {
			return err
		}
		return tx.RegisterNonce(ctx, "expired-nonce", now.Add(-2*time.Minute), now.Add(-time.Minute))
	}); err != nil {
		t.Fatalf("seed expired channel: %v", err)
	}

	if err := db.WithChannelTx(ctx, channel.UUID, func(ctx context.Context, tx *ChannelTx) error {
		loaded, err := tx.LoadActiveChannel(ctx, now)
		if !errors.Is(err, ErrChannelNotFound) {
			return fmt.Errorf("expected ErrChannelNotFound after lazy expiry finalization, got %w", err)
		}
		if loaded != nil {
			t.Fatal("expected no active channel after lazy expiry finalization")
		}

		tombstone, err := tx.GetTerminalTombstone(ctx)
		if err != nil {
			return err
		}
		if tombstone == nil {
			t.Fatal("expected terminal tombstone after lazy expiry finalization")
		}
		if tombstone.Reason != TerminalReasonExpired {
			t.Fatalf("tombstone reason = %s, want %s", tombstone.Reason, TerminalReasonExpired)
		}
		return nil
	}); err != nil {
		t.Fatalf("lazy expiry finalization: %v", err)
	}

	assertNoChannelRow(t, db, channel.UUID)
	assertNoChallengeRow(t, db, channel.UUID)
	assertNoNonceRow(t, db, channel.UUID, "expired-nonce")
}

func TestFinalizeTerminalStatePreservesDeleteTombstone(t *testing.T) {
	db := openTestDatabase(t)
	resetTestTables(t, db)

	ctx := context.Background()
	now := time.Now().UTC()
	channel := Channel{
		UUID:            "channel-delete-finalize",
		State:           ChannelStateDelivered,
		CreatedAt:       now.Add(-time.Hour),
		ExpiresAt:       now.Add(30 * time.Minute),
		TTLMS:           int64(time.Hour / time.Millisecond),
		SecurityProfile: SecurityProfileSecure,
		CipherBundle:    json.RawMessage(`{"ciphertext":"ct"}`),
		DeliveredAt:     timePtrValue(now.Add(-5 * time.Minute)),
		Version:         1,
	}

	if err := db.WithChannelTx(ctx, channel.UUID, func(ctx context.Context, tx *ChannelTx) error {
		if _, err := tx.SaveChannel(ctx, channel); err != nil {
			return err
		}
		tombstone, err := tx.FinalizeTerminalState(ctx, TerminalReasonDeleted, now)
		if err != nil {
			return err
		}
		if tombstone.Reason != TerminalReasonDeleted {
			t.Fatalf("tombstone reason = %s, want %s", tombstone.Reason, TerminalReasonDeleted)
		}
		return nil
	}); err != nil {
		t.Fatalf("finalize deleted channel: %v", err)
	}

	assertNoChannelRow(t, db, channel.UUID)

	if err := db.WithChannelTx(ctx, channel.UUID, func(ctx context.Context, tx *ChannelTx) error {
		tombstone, err := tx.GetTerminalTombstone(ctx)
		if err != nil {
			return err
		}
		if tombstone == nil {
			t.Fatal("expected tombstone to persist after channel delete finalization")
		}
		if tombstone.Reason != TerminalReasonDeleted {
			t.Fatalf("tombstone reason = %s, want %s", tombstone.Reason, TerminalReasonDeleted)
		}
		return nil
	}); err != nil {
		t.Fatalf("read delete tombstone: %v", err)
	}
}

func openTestDatabase(t *testing.T) *Database {
	t.Helper()

	databaseURL := os.Getenv("SELFHOST_API_TEST_DATABASE_URL")
	if databaseURL == "" {
		databaseURL = os.Getenv("SELFHOST_API_DATABASE_URL")
	}
	if databaseURL == "" {
		t.Skip("SELFHOST_API_TEST_DATABASE_URL is not set")
	}

	db, err := Open(context.Background(), config.DatabaseConfig{
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

	if _, err := RunMigrations(context.Background(), db); err != nil {
		t.Fatalf("run migrations: %v", err)
	}

	return db
}

func resetTestTables(t *testing.T, db *Database) {
	t.Helper()

	if _, err := db.pool.Exec(
		context.Background(),
		"TRUNCATE TABLE active_challenges, used_nonces, terminal_tombstones, channels",
	); err != nil {
		t.Fatalf("truncate test tables: %v", err)
	}
}

func assertNoChannelRow(t *testing.T, db *Database, channelID string) {
	t.Helper()

	var count int
	if err := db.pool.QueryRow(
		context.Background(),
		"SELECT COUNT(*) FROM channels WHERE uuid = $1",
		channelID,
	).Scan(&count); err != nil {
		t.Fatalf("count channel rows: %v", err)
	}
	if count != 0 {
		t.Fatalf("channel row count = %d, want 0", count)
	}
}

func assertNoChallengeRow(t *testing.T, db *Database, channelID string) {
	t.Helper()

	var count int
	if err := db.pool.QueryRow(
		context.Background(),
		"SELECT COUNT(*) FROM active_challenges WHERE channel_id = $1",
		channelID,
	).Scan(&count); err != nil {
		t.Fatalf("count challenge rows: %v", err)
	}
	if count != 0 {
		t.Fatalf("active challenge row count = %d, want 0", count)
	}
}

func assertNoNonceRow(t *testing.T, db *Database, channelID string, nonce string) {
	t.Helper()

	var count int
	if err := db.pool.QueryRow(
		context.Background(),
		"SELECT COUNT(*) FROM used_nonces WHERE channel_id = $1 AND nonce = $2",
		channelID,
		nonce,
	).Scan(&count); err != nil {
		t.Fatalf("count used nonce rows: %v", err)
	}
	if count != 0 {
		t.Fatalf("used nonce row count = %d, want 0", count)
	}
}

func stringPtrValue(value string) *string {
	return &value
}

func timePtrValue(value time.Time) *time.Time {
	utcValue := value.UTC()
	return &utcValue
}
