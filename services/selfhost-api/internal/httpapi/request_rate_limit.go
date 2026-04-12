package httpapi

import (
	"sync"
	"time"
)

const requestRateLimitSweepInterval = time.Minute

type requestRateLimitConfig struct {
	maxRequests int
	window      time.Duration
}

type requestRateLimitBucket struct {
	count       int
	windowStart time.Time
	expiresAt   time.Time
}

type requestRateLimiter struct {
	mu        sync.Mutex
	buckets   map[string]requestRateLimitBucket
	lastSweep time.Time
}

var fileInitiateRateLimitConfig = requestRateLimitConfig{
	maxRequests: 10,
	window:      time.Minute,
}

func newRequestRateLimiter() *requestRateLimiter {
	return &requestRateLimiter{
		buckets: make(map[string]requestRateLimitBucket),
	}
}

func (l *requestRateLimiter) Enforce(
	subject string,
	now time.Time,
	config requestRateLimitConfig,
) (retryAfterSeconds int, limited bool) {
	if l == nil {
		return 0, false
	}
	if subject == "" {
		subject = "shared"
	}

	now = now.UTC()

	l.mu.Lock()
	defer l.mu.Unlock()

	if l.shouldSweep(now) {
		l.sweepExpired(now)
		l.lastSweep = now
	}

	bucket, ok := l.buckets[subject]
	if !ok || !bucket.expiresAt.After(now) {
		l.buckets[subject] = requestRateLimitBucket{
			count:       1,
			windowStart: now,
			expiresAt:   now.Add(config.window),
		}
		return 0, false
	}

	if bucket.count >= config.maxRequests {
		return ceilRateLimitRetryAfterSeconds(bucket.expiresAt.Sub(now)), true
	}

	bucket.count++
	l.buckets[subject] = bucket
	return 0, false
}

func (l *requestRateLimiter) shouldSweep(now time.Time) bool {
	if l.lastSweep.IsZero() {
		return true
	}
	return now.Sub(l.lastSweep) >= requestRateLimitSweepInterval
}

func (l *requestRateLimiter) sweepExpired(now time.Time) {
	for key, bucket := range l.buckets {
		if !bucket.expiresAt.After(now) {
			delete(l.buckets, key)
		}
	}
}

func ceilRateLimitRetryAfterSeconds(value time.Duration) int {
	if value <= 0 {
		return 1
	}
	return int((value + time.Second - 1) / time.Second)
}
