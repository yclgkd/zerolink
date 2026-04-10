package service

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/yclgkd/ZeroLink/services/selfhost-api/internal/store"
)

type CommitCookieKind string

const (
	CommitCookieKindLock     CommitCookieKind = "lock"
	CommitCookieKindCompound CommitCookieKind = "compound"
)

type CommitCookieSignal struct {
	Action string
	Kind   CommitCookieKind
	Token  string
	Exp    int64
}

type commitTokenPayload struct {
	Version     string           `json:"v"`
	Kind        CommitCookieKind `json:"kind"`
	UUID        string           `json:"uuid"`
	ChallengeID string           `json:"challengeId"`
	CallerKey   string           `json:"callerKey"`
	SessionID   string           `json:"sid"`
	IssuedAt    int64            `json:"iat"`
	ExpiresAt   int64            `json:"exp"`
}

const (
	lockCommitCookieName        = "zl-lock-commit"
	compoundCommitCookieName    = "zl-compound-commit"
	protocolCallerKeyDomain     = "zl-selfhost-caller-key-v1\x00"
	protocolCommitTokenDomain   = "zl-selfhost-commit-token-v1\x00"
	protocolCommitTokenVersion  = "1"
	protocolCommitTokenSidBytes = 16
)

func withCommitCookieSignal(err error, signal *CommitCookieSignal) error {
	if signal == nil {
		return err
	}

	var protocolErr *ProtocolError
	if !errors.As(err, &protocolErr) {
		return err
	}

	clone := *protocolErr
	clone.CommitCookieSignal = signal
	return &clone
}

func getCommitCookieName(kind CommitCookieKind) string {
	if kind == CommitCookieKindLock {
		return lockCommitCookieName
	}
	return compoundCommitCookieName
}

func getCommitCookiePaths(kind CommitCookieKind, uuid string) []string {
	if kind == CommitCookieKindLock {
		return []string{fmt.Sprintf("/api/lock_commit/%s", uuid)}
	}
	return []string{
		fmt.Sprintf("/api/manage/compound_commit/%s", uuid),
		fmt.Sprintf("/api/delete_commit/%s", uuid),
	}
}

func BuildCommitCookies(signal *CommitCookieSignal, uuid string, secure bool) []*http.Cookie {
	if signal == nil {
		return nil
	}

	cookies := make([]*http.Cookie, 0, len(getCommitCookiePaths(signal.Kind, uuid)))
	for _, path := range getCommitCookiePaths(signal.Kind, uuid) {
		cookie := &http.Cookie{
			Name:     getCommitCookieName(signal.Kind),
			Path:     path,
			HttpOnly: true,
			SameSite: http.SameSiteStrictMode,
			Secure:   secure,
		}

		if signal.Action == "clear" {
			cookie.Value = ""
			cookie.Expires = time.Unix(0, 0).UTC()
			cookie.MaxAge = -1
		} else if signal.Action == "set" && signal.Token != "" && signal.Exp > 0 {
			cookie.Value = signal.Token
			cookie.Expires = time.UnixMilli(signal.Exp).UTC()
		}

		cookies = append(cookies, cookie)
	}

	return cookies
}

func ReadCommitToken(r *http.Request, kind CommitCookieKind) string {
	if r == nil {
		return ""
	}

	cookie, err := r.Cookie(getCommitCookieName(kind))
	if err != nil {
		return ""
	}
	return cookie.Value
}

func signCommitTokenSecret(secret string, payload string) string {
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(payload))
	return encodeBase64URL(mac.Sum(nil))
}

func createCommitToken(secret string, payload commitTokenPayload) (string, error) {
	encodedPayload, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}

	payloadB64u := encodeBase64URL(encodedPayload)
	signature := signCommitTokenSecret(secret, protocolCommitTokenDomain+payloadB64u)
	return payloadB64u + "." + signature, nil
}

func verifyCommitToken(secret string, token string) (*commitTokenPayload, error) {
	separator := strings.Index(token, ".")
	if separator <= 0 || separator >= len(token)-1 || strings.Contains(token[separator+1:], ".") {
		return nil, nil
	}

	payloadB64u := token[:separator]
	signatureB64u := token[separator+1:]
	expected := signCommitTokenSecret(secret, protocolCommitTokenDomain+payloadB64u)
	if !constantTimeEqualString(signatureB64u, expected) {
		return nil, nil
	}

	payloadJSON, err := base64.RawURLEncoding.DecodeString(payloadB64u)
	if err != nil {
		return nil, nil
	}

	var payload commitTokenPayload
	if err := json.Unmarshal(payloadJSON, &payload); err != nil {
		return nil, nil
	}
	if payload.Version != protocolCommitTokenVersion ||
		(payload.Kind != CommitCookieKindLock && payload.Kind != CommitCookieKindCompound) ||
		payload.UUID == "" ||
		!isBase64URL(payload.ChallengeID) ||
		!isBase64URL(payload.CallerKey) ||
		!isBase64URL(payload.SessionID) ||
		payload.IssuedAt < 0 ||
		payload.ExpiresAt < 0 {
		return nil, nil
	}

	return &payload, nil
}

func hashCommitToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

func (s *ProtocolService) deriveCallerKey(callerSubject string) (string, error) {
	normalized := strings.TrimSpace(callerSubject)
	if normalized == "" {
		normalized = "anonymous"
	}
	if s.commitTokenSecret == "" {
		return normalized, nil
	}

	return signCommitTokenSecret(s.commitTokenSecret, protocolCallerKeyDomain+normalized), nil
}

func (s *ProtocolService) shouldEnableCommitCookieBinding(callerSubject string) bool {
	return s.commitTokenSecret != "" && strings.TrimSpace(callerSubject) != ""
}

func (s *ProtocolService) buildCommitCookieSignal(
	kind CommitCookieKind,
	uuid string,
	challenge *store.ActiveChallenge,
	callerSubject string,
) (*CommitCookieSignal, error) {
	if challenge == nil ||
		challenge.CommitTokenMode == nil ||
		*challenge.CommitTokenMode != store.CommitTokenModeCallerCookieV1 ||
		challenge.IssuedAt == nil ||
		challenge.ExpiresAt == nil {
		return nil, nil
	}

	callerKey, err := s.deriveCallerKey(callerSubject)
	if err != nil {
		return nil, err
	}
	sessionID, err := s.randomBase64URL(protocolCommitTokenSidBytes)
	if err != nil {
		return nil, err
	}

	token, err := createCommitToken(s.commitTokenSecret, commitTokenPayload{
		Version:     protocolCommitTokenVersion,
		Kind:        kind,
		UUID:        uuid,
		ChallengeID: *challenge.ChallengeID,
		CallerKey:   callerKey,
		SessionID:   sessionID,
		IssuedAt:    challenge.IssuedAt.UTC().UnixMilli(),
		ExpiresAt:   challenge.ExpiresAt.UTC().UnixMilli(),
	})
	if err != nil {
		return nil, err
	}

	return &CommitCookieSignal{
		Action: "set",
		Kind:   kind,
		Token:  token,
		Exp:    challenge.ExpiresAt.UTC().UnixMilli(),
	}, nil
}

func (s *ProtocolService) authorizedRateLimitSubject(
	kind CommitCookieKind,
	uuid string,
	challenge *store.ActiveChallenge,
	callerSubject string,
	commitToken string,
	now time.Time,
) (string, error) {
	callerKey, err := s.deriveCallerKey(callerSubject)
	if err != nil {
		return "", err
	}

	if challenge == nil ||
		challenge.CommitTokenMode == nil ||
		*challenge.CommitTokenMode != store.CommitTokenModeCallerCookieV1 {
		return buildProtocolRateLimitSubject(uuid, callerKey, protocolRateLimitScopeAuthorized), nil
	}
	if challenge.IssuedAt == nil || challenge.ExpiresAt == nil || challenge.ChallengeID == nil {
		return "", internalError(errors.New("active challenge missing commit token metadata"))
	}

	if s.commitTokenSecret == "" {
		return "", internalError(errors.New("commit token secret missing"))
	}

	payload, err := verifyCommitToken(s.commitTokenSecret, strings.TrimSpace(commitToken))
	if err != nil {
		return "", internalError(err)
	}
	if payload == nil {
		return "", withCommitCookieSignal(challengeInvalid("commit token invalid"), &CommitCookieSignal{
			Action: "clear",
			Kind:   kind,
		})
	}

	expectedIssuedAt := challenge.IssuedAt.UTC().UnixMilli()
	expectedExpiresAt := challenge.ExpiresAt.UTC().UnixMilli()
	if payload.Kind != kind ||
		payload.UUID != uuid ||
		payload.ChallengeID != stringValue(challenge.ChallengeID) ||
		payload.CallerKey != callerKey ||
		payload.IssuedAt != expectedIssuedAt ||
		payload.IssuedAt > payload.ExpiresAt ||
		payload.ExpiresAt > expectedExpiresAt ||
		payload.ExpiresAt <= now.UTC().UnixMilli() {
		return "", withCommitCookieSignal(challengeInvalid("commit token does not match active challenge"), &CommitCookieSignal{
			Action: "clear",
			Kind:   kind,
		})
	}

	return buildProtocolRateLimitSubject(
		uuid,
		hashCommitToken(commitToken),
		protocolRateLimitScopeAuthorized,
	), nil
}
