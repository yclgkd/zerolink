package service

import (
	"fmt"
	"sync"
	"time"
)

type protocolRateLimitedEndpoint string

const (
	protocolRateLimitLockBegin      protocolRateLimitedEndpoint = "lock_begin"
	protocolRateLimitLockCommit     protocolRateLimitedEndpoint = "lock_commit"
	protocolRateLimitCompoundBegin  protocolRateLimitedEndpoint = "compound_begin"
	protocolRateLimitCompoundCommit protocolRateLimitedEndpoint = "compound_commit"
	protocolRateLimitSweepInterval                              = time.Minute
)

type protocolRateLimitConfig struct {
	maxRequests int
	window      time.Duration
}

type protocolRateLimitBucket struct {
	count       int
	windowStart time.Time
	expiresAt   time.Time
}

type protocolRateLimiter struct {
	mu        sync.Mutex
	buckets   map[string]protocolRateLimitBucket
	lastSweep time.Time
}

var protocolRateLimits = map[protocolRateLimitedEndpoint]protocolRateLimitConfig{
	protocolRateLimitLockBegin:      {maxRequests: 3, window: time.Minute},
	protocolRateLimitLockCommit:     {maxRequests: 5, window: time.Minute},
	protocolRateLimitCompoundBegin:  {maxRequests: 3, window: time.Minute},
	protocolRateLimitCompoundCommit: {maxRequests: 10, window: time.Minute},
}

func newProtocolRateLimiter() *protocolRateLimiter {
	return &protocolRateLimiter{
		buckets: make(map[string]protocolRateLimitBucket),
	}
}

func (s *ProtocolService) enforceRateLimit(
	endpoint protocolRateLimitedEndpoint,
	subject string,
	now time.Time,
) error {
	if s == nil || s.rateLimiter == nil {
		return nil
	}
	return s.rateLimiter.Enforce(endpoint, subject, now.UTC())
}

func (l *protocolRateLimiter) Enforce(
	endpoint protocolRateLimitedEndpoint,
	subject string,
	now time.Time,
) error {
	if l == nil {
		return nil
	}

	config, ok := protocolRateLimits[endpoint]
	if !ok {
		return nil
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

	bucketKey := fmt.Sprintf("%s:%s", endpoint, subject)
	bucket, ok := l.buckets[bucketKey]
	if !ok || !bucket.expiresAt.After(now) {
		l.buckets[bucketKey] = protocolRateLimitBucket{
			count:       1,
			windowStart: now,
			expiresAt:   now.Add(config.window),
		}
		return nil
	}

	if bucket.count >= config.maxRequests {
		retryAfterSeconds := ceilDurationSeconds(bucket.expiresAt.Sub(now))
		return rateLimited(fmt.Sprintf("%s rate limit exceeded", endpoint), retryAfterSeconds)
	}

	bucket.count++
	l.buckets[bucketKey] = bucket
	return nil
}

func (l *protocolRateLimiter) shouldSweep(now time.Time) bool {
	if l.lastSweep.IsZero() {
		return true
	}
	return now.Sub(l.lastSweep) >= protocolRateLimitSweepInterval
}

func (l *protocolRateLimiter) sweepExpired(now time.Time) {
	for key, bucket := range l.buckets {
		if !bucket.expiresAt.After(now) {
			delete(l.buckets, key)
		}
	}
}

func ceilDurationSeconds(value time.Duration) int {
	if value <= 0 {
		return 1
	}
	return int((value + time.Second - 1) / time.Second)
}
