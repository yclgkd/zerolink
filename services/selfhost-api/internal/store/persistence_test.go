package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/yclgkd/ZeroLink/services/selfhost-api/internal/config"
	"github.com/yclgkd/ZeroLink/services/selfhost-api/internal/store/sqlcgen"
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

func TestRegisterNonceReusesExpiredEntryWithoutDuplicateRows(t *testing.T) {
	db := openTestDatabase(t)
	resetTestTables(t, db)

	ctx := context.Background()
	now := time.Now().UTC()
	channel := Channel{
		UUID:            "channel-nonce-expired-reuse",
		State:           ChannelStateWaiting,
		CreatedAt:       now.Add(-time.Minute),
		ExpiresAt:       now.Add(time.Hour),
		TTLMS:           int64(time.Hour / time.Millisecond),
		SecurityProfile: SecurityProfileSecure,
		Version:         0,
	}

	initialUsedAt := now.Add(-10 * time.Minute)
	initialExpiresAt := now.Add(-5 * time.Minute)

	if err := db.WithChannelTx(ctx, channel.UUID, func(ctx context.Context, tx *ChannelTx) error {
		if _, err := tx.SaveChannel(ctx, channel); err != nil {
			return err
		}
		return tx.RegisterNonce(ctx, "nonce-expired-reuse", initialUsedAt, initialExpiresAt)
	}); err != nil {
		t.Fatalf("seed expired nonce: %v", err)
	}

	reusedAt := now
	reusedExpiresAt := now.Add(15 * time.Minute)
	if err := db.WithChannelTx(ctx, channel.UUID, func(ctx context.Context, tx *ChannelTx) error {
		return tx.RegisterNonce(ctx, "nonce-expired-reuse", reusedAt, reusedExpiresAt)
	}); err != nil {
		t.Fatalf("reuse expired nonce: %v", err)
	}

	var (
		rowCount        int
		storedUsedAt    time.Time
		storedExpiresAt time.Time
	)
	if err := db.pool.QueryRow(
		ctx,
		`SELECT COUNT(*), MIN(used_at), MIN(expires_at)
FROM used_nonces
WHERE channel_id = $1
  AND nonce = $2`,
		channel.UUID,
		"nonce-expired-reuse",
	).Scan(&rowCount, &storedUsedAt, &storedExpiresAt); err != nil {
		t.Fatalf("query reused nonce row: %v", err)
	}

	if rowCount != 1 {
		t.Fatalf("used nonce row count = %d, want 1", rowCount)
	}
	if !storedUsedAt.UTC().Equal(reusedAt.UTC().Truncate(time.Microsecond)) {
		t.Fatalf("used_at = %s, want %s", storedUsedAt.UTC(), reusedAt.UTC().Truncate(time.Microsecond))
	}
	if !storedExpiresAt.UTC().Equal(reusedExpiresAt.UTC().Truncate(time.Microsecond)) {
		t.Fatalf(
			"expires_at = %s, want %s",
			storedExpiresAt.UTC(),
			reusedExpiresAt.UTC().Truncate(time.Microsecond),
		)
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

func TestSaveChannelRejectsTombstonedUUID(t *testing.T) {
	db := openTestDatabase(t)
	resetTestTables(t, db)

	ctx := context.Background()
	now := time.Now().UTC()
	channel := Channel{
		UUID:            "channel-tombstone-guard",
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
		_, err := tx.FinalizeTerminalState(ctx, TerminalReasonDeleted, now)
		return err
	}); err != nil {
		t.Fatalf("finalize tombstone: %v", err)
	}

	err := db.WithChannelTx(ctx, channel.UUID, func(ctx context.Context, tx *ChannelTx) error {
		_, err := tx.SaveChannel(ctx, channel)
		return err
	})
	if !errors.Is(err, ErrChannelTombstoned) {
		t.Fatalf("SaveChannel() error = %v, want ErrChannelTombstoned", err)
	}
}

func TestDirectUpsertRejectsTombstonedUUID(t *testing.T) {
	db := openTestDatabase(t)
	resetTestTables(t, db)

	ctx := context.Background()
	now := time.Now().UTC()
	channelID := "channel-tombstone-trigger"

	if _, err := db.pool.Exec(
		ctx,
		"INSERT INTO terminal_tombstones (channel_id, reason, finalized_at) VALUES ($1, $2, $3)",
		channelID,
		string(TerminalReasonDeleted),
		now,
	); err != nil {
		t.Fatalf("seed tombstone: %v", err)
	}

	_, err := sqlcgen.New(db.pool).UpsertChannel(ctx, sqlcgen.UpsertChannelParams{
		Uuid:            channelID,
		State:           string(ChannelStateWaiting),
		CreatedAt:       requiredTimestamp(now.Add(-time.Minute)),
		ExpiresAt:       requiredTimestamp(now.Add(time.Hour)),
		TtlMs:           int64(time.Hour / time.Millisecond),
		SecurityProfile: string(SecurityProfileQuick),
		Version:         0,
	})
	if err == nil {
		t.Fatal("expected direct channel upsert to be rejected by tombstone trigger")
	}
	if !strings.Contains(err.Error(), "terminally tombstoned") {
		t.Fatalf("direct upsert error = %v, want tombstone trigger failure", err)
	}
}

func TestSweepExpiredChannelsFinalizesExpiredRows(t *testing.T) {
	db := openTestDatabase(t)
	resetTestTables(t, db)

	ctx := context.Background()
	now := time.Now().UTC()
	expiredChannel := Channel{
		UUID:            "channel-expired-sweep",
		State:           ChannelStateLocked,
		CreatedAt:       now.Add(-2 * time.Hour),
		ExpiresAt:       now.Add(-time.Minute),
		TTLMS:           int64(time.Hour / time.Millisecond),
		SecurityProfile: SecurityProfileQuick,
		ReceiverPubJWK:  json.RawMessage(`{"kty":"RSA"}`),
		ReceiverPubFpr:  stringPtrValue("receiver-fingerprint"),
		LockedAt:        timePtrValue(now.Add(-90 * time.Minute)),
		Version:         1,
	}
	activeChannel := Channel{
		UUID:            "channel-active-sweep",
		State:           ChannelStateWaiting,
		CreatedAt:       now.Add(-time.Minute),
		ExpiresAt:       now.Add(time.Hour),
		TTLMS:           int64(time.Hour / time.Millisecond),
		SecurityProfile: SecurityProfileSecure,
		Version:         0,
	}

	if err := db.WithChannelTx(ctx, expiredChannel.UUID, func(ctx context.Context, tx *ChannelTx) error {
		if _, err := tx.SaveChannel(ctx, expiredChannel); err != nil {
			return err
		}
		if _, err := tx.SaveChallenge(ctx, ActiveChallenge{
			Kind:           ChallengeKindLock,
			ChallengeID:    stringPtrValue("lock-challenge"),
			ChallengeValue: stringPtrValue("challenge-value"),
			IssuedAt:       timePtrValue(now.Add(-10 * time.Minute)),
			ExpiresAt:      timePtrValue(now.Add(-time.Minute)),
		}); err != nil {
			return err
		}
		return tx.RegisterNonce(ctx, "expired-sweep-nonce", now.Add(-10*time.Minute), now.Add(-time.Minute))
	}); err != nil {
		t.Fatalf("seed expired channel for sweep: %v", err)
	}

	if err := db.WithChannelTx(ctx, activeChannel.UUID, func(ctx context.Context, tx *ChannelTx) error {
		_, err := tx.SaveChannel(ctx, activeChannel)
		return err
	}); err != nil {
		t.Fatalf("seed active channel for sweep: %v", err)
	}

	deletedChannels, err := db.SweepExpiredChannels(ctx, now)
	if err != nil {
		t.Fatalf("SweepExpiredChannels() error = %v", err)
	}
	if deletedChannels != 1 {
		t.Fatalf("SweepExpiredChannels() deletedChannels = %d, want 1", deletedChannels)
	}

	assertNoChannelRow(t, db, expiredChannel.UUID)
	assertNoChallengeRow(t, db, expiredChannel.UUID)
	assertNoNonceRow(t, db, expiredChannel.UUID, "expired-sweep-nonce")
	assertChannelRow(t, db, activeChannel.UUID)
	assertTombstoneReason(t, db, expiredChannel.UUID, TerminalReasonExpired)
}

func TestSweepExpiredEphemeraDeletesOnlyExpiredRows(t *testing.T) {
	db := openTestDatabase(t)
	resetTestTables(t, db)

	ctx := context.Background()
	now := time.Now().UTC()
	channel := Channel{
		UUID:            "channel-ephemera-sweep",
		State:           ChannelStateLocked,
		CreatedAt:       now.Add(-time.Hour),
		ExpiresAt:       now.Add(time.Hour),
		TTLMS:           int64(time.Hour / time.Millisecond),
		SecurityProfile: SecurityProfileQuick,
		ReceiverPubJWK:  json.RawMessage(`{"kty":"RSA"}`),
		ReceiverPubFpr:  stringPtrValue("receiver-fingerprint"),
		LockedAt:        timePtrValue(now.Add(-30 * time.Minute)),
		Version:         1,
	}

	if err := db.WithChannelTx(ctx, channel.UUID, func(ctx context.Context, tx *ChannelTx) error {
		if _, err := tx.SaveChannel(ctx, channel); err != nil {
			return err
		}
		if _, err := tx.SaveChallenge(ctx, ActiveChallenge{
			Kind:           ChallengeKindLock,
			ChallengeID:    stringPtrValue("expired-lock"),
			ChallengeValue: stringPtrValue("expired-value"),
			IssuedAt:       timePtrValue(now.Add(-10 * time.Minute)),
			ExpiresAt:      timePtrValue(now.Add(-time.Minute)),
		}); err != nil {
			return err
		}
		if _, err := tx.SaveChallenge(ctx, ActiveChallenge{
			Kind:          ChallengeKindCompound,
			ChallengeID:   stringPtrValue("active-compound"),
			ChallengeSeed: stringPtrValue("seed"),
			IssuedAt:      timePtrValue(now.Add(-time.Minute)),
			ExpiresAt:     timePtrValue(now.Add(10 * time.Minute)),
		}); err != nil {
			return err
		}
		if err := tx.RegisterNonce(ctx, "expired-ephemera-nonce", now.Add(-5*time.Minute), now.Add(-time.Minute)); err != nil {
			return err
		}
		return tx.RegisterNonce(ctx, "active-ephemera-nonce", now, now.Add(10*time.Minute))
	}); err != nil {
		t.Fatalf("seed ephemera rows: %v", err)
	}

	deletedChallenges, deletedNonces, err := db.SweepExpiredEphemera(ctx, now)
	if err != nil {
		t.Fatalf("SweepExpiredEphemera() error = %v", err)
	}
	if deletedChallenges != 1 {
		t.Fatalf("SweepExpiredEphemera() deletedChallenges = %d, want 1", deletedChallenges)
	}
	if deletedNonces != 1 {
		t.Fatalf("SweepExpiredEphemera() deletedNonces = %d, want 1", deletedNonces)
	}

	assertNoChallengeKindRow(t, db, channel.UUID, ChallengeKindLock)
	assertChallengeKindRow(t, db, channel.UUID, ChallengeKindCompound)
	assertNoNonceRow(t, db, channel.UUID, "expired-ephemera-nonce")
	assertNonceRow(t, db, channel.UUID, "active-ephemera-nonce")
}

func openTestDatabase(t *testing.T) *Database {
	t.Helper()

	databaseURL := os.Getenv("SELFHOST_API_TEST_DATABASE_URL")
	if databaseURL == "" {
		databaseURL = os.Getenv("SELFHOST_API_DATABASE_URL")
	}
	if databaseURL == "" {
		if os.Getenv("CI") != "" {
			t.Fatal("SELFHOST_API_TEST_DATABASE_URL is not set in CI")
		}
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

func assertChannelRow(t *testing.T, db *Database, channelID string) {
	t.Helper()

	var count int
	if err := db.pool.QueryRow(
		context.Background(),
		"SELECT COUNT(*) FROM channels WHERE uuid = $1",
		channelID,
	).Scan(&count); err != nil {
		t.Fatalf("count channel rows: %v", err)
	}
	if count != 1 {
		t.Fatalf("channel row count = %d, want 1", count)
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

func assertNoChallengeKindRow(t *testing.T, db *Database, channelID string, kind ChallengeKind) {
	t.Helper()

	var count int
	if err := db.pool.QueryRow(
		context.Background(),
		"SELECT COUNT(*) FROM active_challenges WHERE channel_id = $1 AND kind = $2",
		channelID,
		string(kind),
	).Scan(&count); err != nil {
		t.Fatalf("count active challenge rows: %v", err)
	}
	if count != 0 {
		t.Fatalf("active challenge row count = %d, want 0", count)
	}
}

func assertChallengeKindRow(t *testing.T, db *Database, channelID string, kind ChallengeKind) {
	t.Helper()

	var count int
	if err := db.pool.QueryRow(
		context.Background(),
		"SELECT COUNT(*) FROM active_challenges WHERE channel_id = $1 AND kind = $2",
		channelID,
		string(kind),
	).Scan(&count); err != nil {
		t.Fatalf("count active challenge rows: %v", err)
	}
	if count != 1 {
		t.Fatalf("active challenge row count = %d, want 1", count)
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

func assertNonceRow(t *testing.T, db *Database, channelID string, nonce string) {
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
	if count != 1 {
		t.Fatalf("used nonce row count = %d, want 1", count)
	}
}

func assertTombstoneReason(t *testing.T, db *Database, channelID string, reason TerminalReason) {
	t.Helper()

	var storedReason string
	if err := db.pool.QueryRow(
		context.Background(),
		"SELECT reason FROM terminal_tombstones WHERE channel_id = $1",
		channelID,
	).Scan(&storedReason); err != nil {
		t.Fatalf("query tombstone reason: %v", err)
	}
	if TerminalReason(storedReason) != reason {
		t.Fatalf("tombstone reason = %s, want %s", storedReason, reason)
	}
}

func stringPtrValue(value string) *string {
	return &value
}

func timePtrValue(value time.Time) *time.Time {
	utcValue := value.UTC()
	return &utcValue
}
