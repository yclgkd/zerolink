package httpapi

import (
	"sync"
	"time"

	"github.com/yclgkd/ZeroLink/services/selfhost-api/internal/store/filestore"
)

const (
	proxyUploadTargetTTL   = 15 * time.Minute
	proxyDownloadTargetTTL = 5 * time.Minute
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
	expiresAt            time.Time
}

type proxyDownloadTarget struct {
	storageKey string
	expiresAt  time.Time
}

type proxyTargetAuthorizer struct {
	mu        sync.Mutex
	now       func() time.Time
	sessions  map[string]uploadSession
	uploads   map[string]proxyUploadTarget
	downloads map[string]proxyDownloadTarget
}

func newProxyTargetAuthorizer() *proxyTargetAuthorizer {
	return &proxyTargetAuthorizer{
		now:       time.Now,
		sessions:  make(map[string]uploadSession),
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
	uploadID, err := filestore.NewUploadID()
	if err != nil {
		return "", err
	}

	session := uploadSession{
		channelUUID:          channelUUID,
		chunkCount:           chunkCount,
		totalCiphertextBytes: totalCiphertextBytes,
		expiresAt:            a.expiresAt(ttl, proxyUploadTargetTTL),
	}

	a.mu.Lock()
	defer a.mu.Unlock()
	a.pruneExpiredLocked(a.now())
	a.sessions[uploadID] = session
	return uploadID, nil
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
	a.pruneExpiredLocked(a.now())
	session, ok := a.sessions[uploadID]
	return session, ok
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
	delete(a.sessions, uploadID)
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
	for uploadID, session := range a.sessions {
		if !session.expiresAt.After(now) {
			delete(a.sessions, uploadID)
		}
	}
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

func buildProxyUploadURL(token string) string {
	return "file/chunk/" + token
}

func buildProxyDownloadURL(token string) string {
	return "file/download/" + token
}
