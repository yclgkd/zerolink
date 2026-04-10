package httpapi

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"sync"
	"time"

	"github.com/yclgkd/ZeroLink/services/selfhost-api/internal/store/filestore"
)

const (
	proxyUploadTargetTTL   = 15 * time.Minute
	proxyDownloadTargetTTL = 5 * time.Minute
	uploadSessionTokenV1   = "1"
	uploadSessionDomain    = "zerolink:selfhost:file-upload:"
)

type proxyUploadTarget struct {
	uploadID  string
	index     int
	expiresAt time.Time
}

type uploadSession struct {
	channelUUID          string
	chunkCount           int
	totalCiphertextBytes int64
	issuedAt             time.Time
	expiresAt            time.Time
	nonce                string
}

type uploadSessionToken struct {
	V                    string `json:"v"`
	ChannelUUID          string `json:"channelUuid"`
	ChunkCount           int    `json:"chunkCount"`
	TotalCiphertextBytes int64  `json:"totalCiphertextBytes"`
	IssuedAt             int64  `json:"issuedAt"`
	ExpiresAt            int64  `json:"expiresAt"`
	Nonce                string `json:"nonce"`
}

type proxyDownloadTarget struct {
	storageKey string
	expiresAt  time.Time
}

type proxyTargetAuthorizer struct {
	mu        sync.Mutex
	now       func() time.Time
	secret    []byte
	uploads   map[string]proxyUploadTarget
	downloads map[string]proxyDownloadTarget
}

func newProxyTargetAuthorizer(secret string) *proxyTargetAuthorizer {
	return &proxyTargetAuthorizer{
		now:       time.Now,
		secret:    []byte(secret),
		uploads:   make(map[string]proxyUploadTarget),
		downloads: make(map[string]proxyDownloadTarget),
	}
}

func (a *proxyTargetAuthorizer) IssueUploadSession(
	channelUUID string,
	chunkCount int,
	totalCiphertextBytes int64,
	ttl time.Duration,
) (string, error) {
	nonce, err := filestore.NewUploadID()
	if err != nil {
		return "", err
	}

	session := uploadSession{
		channelUUID:          channelUUID,
		chunkCount:           chunkCount,
		totalCiphertextBytes: totalCiphertextBytes,
		issuedAt:             a.now().UTC(),
		expiresAt:            a.expiresAt(ttl, proxyUploadTargetTTL),
		nonce:                nonce,
	}
	return a.signUploadSession(session)
}

func (a *proxyTargetAuthorizer) IssueUploadTarget(uploadID string, index int, ttl time.Duration) (string, error) {
	target := proxyUploadTarget{
		uploadID:  uploadID,
		index:     index,
		expiresAt: a.expiresAt(ttl, proxyUploadTargetTTL),
	}
	return a.storeUploadTarget(target)
}

func (a *proxyTargetAuthorizer) IssueDownloadTarget(storageKey string, ttl time.Duration) (string, error) {
	target := proxyDownloadTarget{
		storageKey: storageKey,
		expiresAt:  a.expiresAt(ttl, proxyDownloadTargetTTL),
	}
	return a.storeDownloadTarget(target)
}

func (a *proxyTargetAuthorizer) UploadSession(uploadID string) (uploadSession, bool) {
	a.mu.Lock()
	defer a.mu.Unlock()
	now := a.now()
	a.pruneExpiredLocked(now)
	session, ok := a.parseUploadSession(uploadID)
	if !ok || !session.expiresAt.After(now) {
		return uploadSession{}, false
	}
	return session, true
}

func (a *proxyTargetAuthorizer) UploadTarget(token string) (proxyUploadTarget, bool) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.pruneExpiredLocked(a.now())
	target, ok := a.uploads[token]
	return target, ok
}

func (a *proxyTargetAuthorizer) ConsumeDownloadTarget(token string) (proxyDownloadTarget, bool) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.pruneExpiredLocked(a.now())
	target, ok := a.downloads[token]
	if ok {
		delete(a.downloads, token)
	}
	return target, ok
}

func (a *proxyTargetAuthorizer) RevokeUpload(uploadID string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	for token, target := range a.uploads {
		if target.uploadID == uploadID {
			delete(a.uploads, token)
		}
	}
}

func (a *proxyTargetAuthorizer) expiresAt(ttl time.Duration, fallback time.Duration) time.Time {
	if ttl <= 0 {
		ttl = fallback
	}
	return a.now().Add(ttl)
}

func (a *proxyTargetAuthorizer) storeUploadTarget(target proxyUploadTarget) (string, error) {
	token, err := filestore.NewUploadID()
	if err != nil {
		return "", err
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	a.pruneExpiredLocked(a.now())
	a.uploads[token] = target
	return token, nil
}

func (a *proxyTargetAuthorizer) storeDownloadTarget(target proxyDownloadTarget) (string, error) {
	token, err := filestore.NewUploadID()
	if err != nil {
		return "", err
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	a.pruneExpiredLocked(a.now())
	a.downloads[token] = target
	return token, nil
}

func (a *proxyTargetAuthorizer) pruneExpiredLocked(now time.Time) {
	for token, target := range a.uploads {
		if !target.expiresAt.After(now) {
			delete(a.uploads, token)
		}
	}
	for token, target := range a.downloads {
		if !target.expiresAt.After(now) {
			delete(a.downloads, token)
		}
	}
}

func (a *proxyTargetAuthorizer) signUploadSession(session uploadSession) (string, error) {
	if len(a.secret) == 0 {
		return "", errors.New("upload token secret is required")
	}
	tokenPayload, err := json.Marshal(uploadSessionToken{
		V:                    uploadSessionTokenV1,
		ChannelUUID:          session.channelUUID,
		ChunkCount:           session.chunkCount,
		TotalCiphertextBytes: session.totalCiphertextBytes,
		IssuedAt:             session.issuedAt.UnixMilli(),
		ExpiresAt:            session.expiresAt.UnixMilli(),
		Nonce:                session.nonce,
	})
	if err != nil {
		return "", err
	}

	mac := hmac.New(sha256.New, a.secret)
	_, _ = mac.Write([]byte(uploadSessionDomain))
	_, _ = mac.Write(tokenPayload)
	signature := mac.Sum(nil)

	tokenBytes := make([]byte, len(tokenPayload)+1+len(signature))
	copy(tokenBytes, tokenPayload)
	tokenBytes[len(tokenPayload)] = 0
	copy(tokenBytes[len(tokenPayload)+1:], signature)
	return base64.RawURLEncoding.EncodeToString(tokenBytes), nil
}

func (a *proxyTargetAuthorizer) parseUploadSession(uploadID string) (uploadSession, bool) {
	if len(a.secret) == 0 {
		return uploadSession{}, false
	}

	tokenBytes, err := base64.RawURLEncoding.DecodeString(uploadID)
	if err != nil {
		return uploadSession{}, false
	}

	separatorIndex := -1
	for index, value := range tokenBytes {
		if value == 0 {
			separatorIndex = index
			break
		}
	}
	if separatorIndex <= 0 || separatorIndex >= len(tokenBytes)-1 {
		return uploadSession{}, false
	}

	payload := tokenBytes[:separatorIndex]
	signature := tokenBytes[separatorIndex+1:]
	mac := hmac.New(sha256.New, a.secret)
	_, _ = mac.Write([]byte(uploadSessionDomain))
	_, _ = mac.Write(payload)
	if !hmac.Equal(signature, mac.Sum(nil)) {
		return uploadSession{}, false
	}

	var token uploadSessionToken
	if err := json.Unmarshal(payload, &token); err != nil {
		return uploadSession{}, false
	}
	if token.V != uploadSessionTokenV1 ||
		!isChannelUUIDToken(token.ChannelUUID) ||
		token.ChunkCount <= 0 ||
		token.TotalCiphertextBytes <= 0 ||
		token.ExpiresAt <= token.IssuedAt ||
		!isBase64URLToken(token.Nonce) {
		return uploadSession{}, false
	}

	return uploadSession{
		channelUUID:          token.ChannelUUID,
		chunkCount:           token.ChunkCount,
		totalCiphertextBytes: token.TotalCiphertextBytes,
		issuedAt:             time.UnixMilli(token.IssuedAt).UTC(),
		expiresAt:            time.UnixMilli(token.ExpiresAt).UTC(),
		nonce:                token.Nonce,
	}, true
}

func isBase64URLToken(value string) bool {
	if value == "" {
		return false
	}
	_, err := base64.RawURLEncoding.DecodeString(value)
	return err == nil
}

func isChannelUUIDToken(value string) bool {
	if len(value) != 21 {
		return false
	}
	for _, r := range value {
		switch {
		case r >= 'A' && r <= 'Z':
		case r >= 'a' && r <= 'z':
		case r >= '0' && r <= '9':
		case r == '-' || r == '_':
		default:
			return false
		}
	}
	return true
}

func buildProxyUploadURL(token string) string {
	return "file/chunk/" + token
}

func buildProxyDownloadURL(token string) string {
	return "file/download/" + token
}
