package store

import (
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/yclgkd/ZeroLink/services/selfhost-api/internal/store/sqlcgen"
)

const advisoryLockNamespace = "zerolink/selfhost/channel"

type ChannelTx struct {
	queries   *sqlcgen.Queries
	channelID string
}

func (d *Database) WithChannelTx(
	ctx context.Context,
	channelID string,
	fn func(context.Context, *ChannelTx) error,
) (err error) {
	if channelID == "" {
		return errors.New("channelID is required")
	}

	tx, err := d.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return fmt.Errorf("begin channel transaction: %w", err)
	}

	defer func() {
		rollbackErr := tx.Rollback(ctx)
		if rollbackErr == nil || errors.Is(rollbackErr, pgx.ErrTxClosed) {
			return
		}
		if err == nil {
			err = fmt.Errorf("rollback channel transaction: %w", rollbackErr)
		}
	}()

	queries := sqlcgen.New(tx)
	if err := queries.AcquireChannelAdvisoryLock(ctx, advisoryLockKey(channelID)); err != nil {
		return fmt.Errorf("acquire channel advisory lock: %w", err)
	}

	channelTx := &ChannelTx{
		queries:   queries,
		channelID: channelID,
	}

	if err := fn(ctx, channelTx); err != nil {
		return err
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit channel transaction: %w", err)
	}

	return nil
}

func (tx *ChannelTx) GetChannel(ctx context.Context) (*Channel, error) {
	row, err := tx.queries.GetChannel(ctx, tx.channelID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("get channel: %w", err)
	}

	channel := channelFromSQL(row)
	return &channel, nil
}

func (tx *ChannelTx) LoadActiveChannel(ctx context.Context, now time.Time) (*Channel, error) {
	channel, err := tx.GetChannel(ctx)
	if err != nil {
		return nil, err
	}
	if channel == nil {
		return nil, ErrChannelNotFound
	}
	if !channel.Expired(now.UTC()) {
		return channel, nil
	}

	if _, err := tx.FinalizeTerminalState(ctx, TerminalReasonExpired, now.UTC()); err != nil {
		return nil, err
	}

	return nil, ErrChannelNotFound
}

func (tx *ChannelTx) SaveChannel(ctx context.Context, channel Channel) (*Channel, error) {
	normalized, err := tx.normalizeChannel(channel)
	if err != nil {
		return nil, err
	}

	tombstone, err := tx.GetTerminalTombstone(ctx)
	if err != nil {
		return nil, err
	}
	if tombstone != nil {
		return nil, fmt.Errorf("%w: %s", ErrChannelTombstoned, tombstone.Reason)
	}

	row, err := tx.queries.UpsertChannel(ctx, sqlcgen.UpsertChannelParams{
		Uuid:                normalized.UUID,
		State:               string(normalized.State),
		CreatedAt:           requiredTimestamp(normalized.CreatedAt),
		ExpiresAt:           requiredTimestamp(normalized.ExpiresAt),
		TtlMs:               normalized.TTLMS,
		SecurityProfile:     string(normalized.SecurityProfile),
		AdminMode:           adminModeToSQL(normalized.AdminMode),
		AdminCredential:     cloneJSON(normalized.AdminCredential),
		LockKey:             stringPointer(normalized.LockKey),
		ReceiverPubJwk:      cloneJSON(normalized.ReceiverPubJWK),
		ReceiverPubFpr:      stringPointer(normalized.ReceiverPubFpr),
		LockedAt:            optionalTimestamp(normalized.LockedAt),
		CipherBundle:        cloneJSON(normalized.CipherBundle),
		UpdateDeliveryProof: cloneJSON(normalized.UpdateDeliveryProof),
		DeliveredAt:         optionalTimestamp(normalized.DeliveredAt),
		Version:             normalized.Version,
	})
	if err != nil {
		return nil, fmt.Errorf("upsert channel: %w", err)
	}

	saved := channelFromSQL(row)
	return &saved, nil
}

func (tx *ChannelTx) GetChallenge(ctx context.Context, kind ChallengeKind) (*ActiveChallenge, error) {
	row, err := tx.queries.GetActiveChallenge(ctx, sqlcgen.GetActiveChallengeParams{
		ChannelID: tx.channelID,
		Kind:      string(kind),
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("get active challenge: %w", err)
	}

	challenge := activeChallengeFromSQL(row)
	return &challenge, nil
}

func (tx *ChannelTx) SaveChallenge(
	ctx context.Context,
	challenge ActiveChallenge,
) (*ActiveChallenge, error) {
	normalized, err := tx.normalizeChallenge(challenge)
	if err != nil {
		return nil, err
	}

	row, err := tx.queries.UpsertActiveChallenge(ctx, sqlcgen.UpsertActiveChallengeParams{
		ChannelID:       normalized.ChannelID,
		Kind:            string(normalized.Kind),
		ChallengeID:     stringPointer(normalized.ChallengeID),
		ChallengeValue:  stringPointer(normalized.ChallengeValue),
		ChallengeSeed:   stringPointer(normalized.ChallengeSeed),
		IssuedAt:        optionalTimestamp(normalized.IssuedAt),
		ExpiresAt:       optionalTimestamp(normalized.ExpiresAt),
		ConsumedAt:      optionalTimestamp(normalized.ConsumedAt),
		CommitTokenMode: commitTokenModeToSQL(normalized.CommitTokenMode),
	})
	if err != nil {
		return nil, fmt.Errorf("upsert active challenge: %w", err)
	}

	saved := activeChallengeFromSQL(row)
	return &saved, nil
}

func (tx *ChannelTx) MarkChallengeConsumed(
	ctx context.Context,
	kind ChallengeKind,
	consumedAt time.Time,
) (*ActiveChallenge, error) {
	row, err := tx.queries.MarkChallengeConsumed(ctx, sqlcgen.MarkChallengeConsumedParams{
		ChannelID:  tx.channelID,
		Kind:       string(kind),
		ConsumedAt: requiredTimestamp(consumedAt),
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrChannelNotFound
		}
		return nil, fmt.Errorf("mark active challenge consumed: %w", err)
	}

	updated := activeChallengeFromSQL(row)
	return &updated, nil
}

func (tx *ChannelTx) DeleteChallenge(ctx context.Context, kind ChallengeKind) error {
	if err := tx.queries.DeleteActiveChallenge(ctx, sqlcgen.DeleteActiveChallengeParams{
		ChannelID: tx.channelID,
		Kind:      string(kind),
	}); err != nil {
		return fmt.Errorf("delete active challenge: %w", err)
	}
	return nil
}

func (tx *ChannelTx) RegisterNonce(
	ctx context.Context,
	nonce string,
	now time.Time,
	expiresAt time.Time,
) error {
	if nonce == "" {
		return errors.New("nonce is required")
	}
	if expiresAt.IsZero() {
		return errors.New("expiresAt is required")
	}

	now = now.UTC()
	expiresAt = expiresAt.UTC()

	existing, err := tx.queries.GetUsedNonce(ctx, sqlcgen.GetUsedNonceParams{
		ChannelID: tx.channelID,
		Nonce:     nonce,
	})
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return fmt.Errorf("get used nonce: %w", err)
	}

	if err == nil {
		existingNonce := usedNonceFromSQL(existing)
		if existingNonce.ExpiresAt.After(now) {
			return ErrNonceReplay
		}
	}

	if _, err := tx.queries.UpsertUsedNonce(ctx, sqlcgen.UpsertUsedNonceParams{
		ChannelID: tx.channelID,
		Nonce:     nonce,
		UsedAt:    requiredTimestamp(now),
		ExpiresAt: requiredTimestamp(expiresAt),
	}); err != nil {
		return fmt.Errorf("upsert used nonce: %w", err)
	}

	return nil
}

func (tx *ChannelTx) GetTerminalTombstone(ctx context.Context) (*TerminalTombstone, error) {
	row, err := tx.queries.GetTerminalTombstone(ctx, tx.channelID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("get terminal tombstone: %w", err)
	}

	tombstone := terminalTombstoneFromSQL(row)
	return &tombstone, nil
}

func (tx *ChannelTx) FinalizeTerminalState(
	ctx context.Context,
	reason TerminalReason,
	finalizedAt time.Time,
) (*TerminalTombstone, error) {
	row, err := tx.queries.UpsertTerminalTombstone(ctx, sqlcgen.UpsertTerminalTombstoneParams{
		ChannelID:   tx.channelID,
		Reason:      string(reason),
		FinalizedAt: requiredTimestamp(finalizedAt),
	})
	if err != nil {
		return nil, fmt.Errorf("upsert terminal tombstone: %w", err)
	}

	if err := tx.queries.DeleteChannel(ctx, tx.channelID); err != nil {
		return nil, fmt.Errorf("delete finalized channel: %w", err)
	}

	tombstone := terminalTombstoneFromSQL(row)
	return &tombstone, nil
}

func (d *Database) SweepExpiredChannels(ctx context.Context, now time.Time) (int64, error) {
	tx, err := d.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return 0, fmt.Errorf("begin expired channel sweep transaction: %w", err)
	}

	defer func() {
		_ = tx.Rollback(ctx)
	}()

	deletedChannels, err := sqlcgen.New(tx).FinalizeExpiredChannels(ctx, requiredTimestamp(now.UTC()))
	if err != nil {
		return 0, fmt.Errorf("finalize expired channels: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return 0, fmt.Errorf("commit expired channel sweep transaction: %w", err)
	}

	return deletedChannels, nil
}

func (d *Database) SweepExpiredEphemera(
	ctx context.Context,
	now time.Time,
) (deletedChallenges int64, deletedNonces int64, err error) {
	tx, err := d.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return 0, 0, fmt.Errorf("begin ephemera sweep transaction: %w", err)
	}

	defer func() {
		_ = tx.Rollback(ctx)
	}()

	queries := sqlcgen.New(tx)
	marker := requiredTimestamp(now.UTC())

	deletedChallenges, err = queries.DeleteExpiredChallenges(ctx, marker)
	if err != nil {
		return 0, 0, fmt.Errorf("delete expired challenges: %w", err)
	}

	deletedNonces, err = queries.DeleteExpiredUsedNonces(ctx, marker)
	if err != nil {
		return 0, 0, fmt.Errorf("delete expired used nonces: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return 0, 0, fmt.Errorf("commit ephemera sweep transaction: %w", err)
	}

	return deletedChallenges, deletedNonces, nil
}

func (tx *ChannelTx) normalizeChannel(channel Channel) (Channel, error) {
	if channel.UUID == "" {
		channel.UUID = tx.channelID
	}
	if channel.UUID != tx.channelID {
		return Channel{}, fmt.Errorf("channel uuid mismatch: tx=%s payload=%s", tx.channelID, channel.UUID)
	}
	if channel.CreatedAt.IsZero() {
		return Channel{}, errors.New("createdAt is required")
	}
	if channel.ExpiresAt.IsZero() {
		return Channel{}, errors.New("expiresAt is required")
	}
	if channel.TTLMS <= 0 {
		return Channel{}, errors.New("ttlMs must be greater than zero")
	}
	if channel.State == "" {
		return Channel{}, errors.New("state is required")
	}
	if channel.SecurityProfile == "" {
		return Channel{}, errors.New("securityProfile is required")
	}

	channel.CreatedAt = channel.CreatedAt.UTC()
	channel.ExpiresAt = channel.ExpiresAt.UTC()
	channel.LockedAt = timePointerUTC(channel.LockedAt)
	channel.DeliveredAt = timePointerUTC(channel.DeliveredAt)

	return channel, nil
}

func (tx *ChannelTx) normalizeChallenge(challenge ActiveChallenge) (ActiveChallenge, error) {
	if challenge.ChannelID == "" {
		challenge.ChannelID = tx.channelID
	}
	if challenge.ChannelID != tx.channelID {
		return ActiveChallenge{}, fmt.Errorf(
			"challenge channel mismatch: tx=%s payload=%s",
			tx.channelID,
			challenge.ChannelID,
		)
	}
	if challenge.Kind == "" {
		return ActiveChallenge{}, errors.New("challenge kind is required")
	}

	challenge.IssuedAt = timePointerUTC(challenge.IssuedAt)
	challenge.ExpiresAt = timePointerUTC(challenge.ExpiresAt)
	challenge.ConsumedAt = timePointerUTC(challenge.ConsumedAt)

	return challenge, nil
}

func advisoryLockKey(channelID string) int64 {
	sum := sha256.Sum256([]byte(advisoryLockNamespace + ":" + channelID))
	return int64(binary.BigEndian.Uint64(sum[:8]))
}

func channelFromSQL(row sqlcgen.Channel) Channel {
	return Channel{
		UUID:                row.Uuid,
		State:               ChannelState(row.State),
		CreatedAt:           row.CreatedAt.Time.UTC(),
		ExpiresAt:           row.ExpiresAt.Time.UTC(),
		TTLMS:               row.TtlMs,
		SecurityProfile:     SecurityProfile(row.SecurityProfile),
		AdminMode:           adminModeFromSQL(row.AdminMode),
		AdminCredential:     cloneJSON(row.AdminCredential),
		LockKey:             stringPointerFromSQL(row.LockKey),
		ReceiverPubJWK:      cloneJSON(row.ReceiverPubJwk),
		ReceiverPubFpr:      stringPointerFromSQL(row.ReceiverPubFpr),
		LockedAt:            timestampPointerFromSQL(row.LockedAt),
		CipherBundle:        cloneJSON(row.CipherBundle),
		UpdateDeliveryProof: cloneJSON(row.UpdateDeliveryProof),
		DeliveredAt:         timestampPointerFromSQL(row.DeliveredAt),
		Version:             row.Version,
	}
}

func activeChallengeFromSQL(row sqlcgen.ActiveChallenge) ActiveChallenge {
	return ActiveChallenge{
		ChannelID:       row.ChannelID,
		Kind:            ChallengeKind(row.Kind),
		ChallengeID:     stringPointerFromSQL(row.ChallengeID),
		ChallengeValue:  stringPointerFromSQL(row.ChallengeValue),
		ChallengeSeed:   stringPointerFromSQL(row.ChallengeSeed),
		IssuedAt:        timestampPointerFromSQL(row.IssuedAt),
		ExpiresAt:       timestampPointerFromSQL(row.ExpiresAt),
		ConsumedAt:      timestampPointerFromSQL(row.ConsumedAt),
		CommitTokenMode: commitTokenModeFromSQL(row.CommitTokenMode),
	}
}

func usedNonceFromSQL(row sqlcgen.UsedNonce) UsedNonce {
	return UsedNonce{
		ChannelID: row.ChannelID,
		Nonce:     row.Nonce,
		UsedAt:    row.UsedAt.Time.UTC(),
		ExpiresAt: row.ExpiresAt.Time.UTC(),
	}
}

func terminalTombstoneFromSQL(row sqlcgen.TerminalTombstone) TerminalTombstone {
	return TerminalTombstone{
		ChannelID:   row.ChannelID,
		Reason:      TerminalReason(row.Reason),
		FinalizedAt: row.FinalizedAt.Time.UTC(),
	}
}

func requiredTimestamp(value time.Time) pgtype.Timestamptz {
	return pgtype.Timestamptz{
		Time:  value.UTC(),
		Valid: true,
	}
}

func optionalTimestamp(value *time.Time) pgtype.Timestamptz {
	if value == nil {
		return pgtype.Timestamptz{}
	}
	return requiredTimestamp(*value)
}

func timestampPointerFromSQL(value pgtype.Timestamptz) *time.Time {
	if !value.Valid {
		return nil
	}
	timestamp := value.Time.UTC()
	return &timestamp
}

func stringPointerFromSQL(value *string) *string {
	if value == nil {
		return nil
	}
	copyValue := *value
	return &copyValue
}

func adminModeFromSQL(value *string) *AdminMode {
	if value == nil {
		return nil
	}
	adminMode := AdminMode(*value)
	return &adminMode
}

func adminModeToSQL(value *AdminMode) *string {
	if value == nil {
		return nil
	}
	stringValue := string(*value)
	return &stringValue
}

func commitTokenModeFromSQL(value *string) *CommitTokenMode {
	if value == nil {
		return nil
	}
	commitTokenMode := CommitTokenMode(*value)
	return &commitTokenMode
}

func commitTokenModeToSQL(value *CommitTokenMode) *string {
	if value == nil {
		return nil
	}
	stringValue := string(*value)
	return &stringValue
}

func stringPointer(value *string) *string {
	if value == nil {
		return nil
	}
	copyValue := *value
	return &copyValue
}

func timePointerUTC(value *time.Time) *time.Time {
	if value == nil {
		return nil
	}
	timestamp := value.UTC()
	return &timestamp
}

func cloneJSON(value json.RawMessage) []byte {
	if len(value) == 0 {
		return nil
	}
	cloned := make([]byte, len(value))
	copy(cloned, value)
	return cloned
}
