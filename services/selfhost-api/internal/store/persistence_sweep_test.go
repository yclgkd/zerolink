package store

import (
	"context"
	"encoding/json"
	"testing"
	"time"
)

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

func TestSweepExpiredChannelsWaitsForChannelLock(t *testing.T) {
	db := openTestDatabase(t)
	resetTestTables(t, db)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	now := time.Now().UTC()
	channel := Channel{
		UUID:            "channel-expired-sweep-lock",
		State:           ChannelStateWaiting,
		CreatedAt:       now.Add(-time.Hour),
		ExpiresAt:       now.Add(-time.Minute),
		TTLMS:           int64(time.Hour / time.Millisecond),
		SecurityProfile: SecurityProfileSecure,
		Version:         0,
	}

	if err := db.WithChannelTx(ctx, channel.UUID, func(ctx context.Context, tx *ChannelTx) error {
		_, err := tx.SaveChannel(ctx, channel)
		return err
	}); err != nil {
		t.Fatalf("seed expired channel for lock test: %v", err)
	}

	firstEntered := make(chan struct{})
	releaseFirst := make(chan struct{})
	firstErr := make(chan error, 1)
	sweepDone := make(chan struct {
		deleted int64
		err     error
	}, 1)

	go func() {
		firstErr <- db.WithChannelTx(ctx, channel.UUID, func(_ context.Context, _ *ChannelTx) error {
			close(firstEntered)
			<-releaseFirst
			return nil
		})
	}()

	<-firstEntered

	go func() {
		deleted, err := db.SweepExpiredChannels(ctx, now)
		sweepDone <- struct {
			deleted int64
			err     error
		}{
			deleted: deleted,
			err:     err,
		}
	}()

	select {
	case result := <-sweepDone:
		t.Fatalf("SweepExpiredChannels() returned early: deleted=%d err=%v", result.deleted, result.err)
	case <-time.After(250 * time.Millisecond):
	}

	close(releaseFirst)

	if err := <-firstErr; err != nil {
		t.Fatalf("blocking transaction error = %v", err)
	}

	select {
	case result := <-sweepDone:
		if result.err != nil {
			t.Fatalf("SweepExpiredChannels() error = %v", result.err)
		}
		if result.deleted != 1 {
			t.Fatalf("SweepExpiredChannels() deleted = %d, want 1", result.deleted)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("SweepExpiredChannels() did not finish after lock release")
	}
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

func TestSweepExpiredEphemeraWaitsForChannelLock(t *testing.T) {
	db := openTestDatabase(t)
	resetTestTables(t, db)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	now := time.Now().UTC()
	channel := Channel{
		UUID:            "channel-ephemera-sweep-lock",
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
		return tx.RegisterNonce(ctx, "expired-ephemera-lock-nonce", now.Add(-5*time.Minute), now.Add(-time.Minute))
	}); err != nil {
		t.Fatalf("seed ephemera for lock test: %v", err)
	}

	firstEntered := make(chan struct{})
	releaseFirst := make(chan struct{})
	firstErr := make(chan error, 1)
	sweepDone := make(chan struct {
		deletedChallenges int64
		deletedNonces     int64
		err               error
	}, 1)

	go func() {
		firstErr <- db.WithChannelTx(ctx, channel.UUID, func(_ context.Context, _ *ChannelTx) error {
			close(firstEntered)
			<-releaseFirst
			return nil
		})
	}()

	<-firstEntered

	go func() {
		deletedChallenges, deletedNonces, err := db.SweepExpiredEphemera(ctx, now)
		sweepDone <- struct {
			deletedChallenges int64
			deletedNonces     int64
			err               error
		}{
			deletedChallenges: deletedChallenges,
			deletedNonces:     deletedNonces,
			err:               err,
		}
	}()

	select {
	case result := <-sweepDone:
		t.Fatalf(
			"SweepExpiredEphemera() returned early: deletedChallenges=%d deletedNonces=%d err=%v",
			result.deletedChallenges,
			result.deletedNonces,
			result.err,
		)
	case <-time.After(250 * time.Millisecond):
	}

	close(releaseFirst)

	if err := <-firstErr; err != nil {
		t.Fatalf("blocking transaction error = %v", err)
	}

	select {
	case result := <-sweepDone:
		if result.err != nil {
			t.Fatalf("SweepExpiredEphemera() error = %v", result.err)
		}
		if result.deletedChallenges != 1 {
			t.Fatalf("SweepExpiredEphemera() deletedChallenges = %d, want 1", result.deletedChallenges)
		}
		if result.deletedNonces != 1 {
			t.Fatalf("SweepExpiredEphemera() deletedNonces = %d, want 1", result.deletedNonces)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("SweepExpiredEphemera() did not finish after lock release")
	}
}
