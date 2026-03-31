package store

import (
	"encoding/json"
	"errors"
	"time"
)

type ChannelState string

const (
	ChannelStateWaiting   ChannelState = "waiting"
	ChannelStateLocked    ChannelState = "locked"
	ChannelStateDelivered ChannelState = "delivered"
)

type SecurityProfile string

const (
	SecurityProfileQuick  SecurityProfile = "quick"
	SecurityProfileSecure SecurityProfile = "secure"
)

type AdminMode string

const (
	AdminModeWebAuthn AdminMode = "webauthn"
	AdminModePassword AdminMode = "password"
	AdminModeSoftkey  AdminMode = "softkey"
)

type ChallengeKind string

const (
	ChallengeKindCreate   ChallengeKind = "create"
	ChallengeKindLock     ChallengeKind = "lock"
	ChallengeKindCompound ChallengeKind = "compound"
)

type CommitTokenMode string

const CommitTokenModeCallerCookieV1 CommitTokenMode = "caller-cookie-v1"

type TerminalReason string

const (
	TerminalReasonDeleted TerminalReason = "deleted"
	TerminalReasonExpired TerminalReason = "expired"
)

var (
	ErrChannelNotFound = errors.New("channel not found")
	ErrNonceReplay     = errors.New("nonce already consumed")
)

type Channel struct {
	UUID                string
	State               ChannelState
	CreatedAt           time.Time
	ExpiresAt           time.Time
	TTLMS               int64
	SecurityProfile     SecurityProfile
	AdminMode           *AdminMode
	AdminCredential     json.RawMessage
	LockKey             *string
	ReceiverPubJWK      json.RawMessage
	ReceiverPubFpr      *string
	LockedAt            *time.Time
	CipherBundle        json.RawMessage
	UpdateDeliveryProof json.RawMessage
	DeliveredAt         *time.Time
	Version             int64
}

type ActiveChallenge struct {
	ChannelID       string
	Kind            ChallengeKind
	ChallengeID     *string
	ChallengeValue  *string
	ChallengeSeed   *string
	IssuedAt        *time.Time
	ExpiresAt       *time.Time
	ConsumedAt      *time.Time
	CommitTokenMode *CommitTokenMode
}

type UsedNonce struct {
	ChannelID string
	Nonce     string
	UsedAt    time.Time
	ExpiresAt time.Time
}

type TerminalTombstone struct {
	ChannelID   string
	Reason      TerminalReason
	FinalizedAt time.Time
}

func (c Channel) Expired(now time.Time) bool {
	return !c.ExpiresAt.After(now)
}
