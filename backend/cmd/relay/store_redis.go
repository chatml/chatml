package main

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/redis/go-redis/v9"
)

const (
	redisKeyPrefix  = "relay:token:"
	redisCounterKey = "relay:token_count"
)

// redisTokenStore implements TokenStore using Redis for multi-instance deployments.
// Each token is stored as a key with server-side TTL, so cleanup is automatic.
type redisTokenStore struct {
	rdb    *redis.Client
	logger *slog.Logger
}

func newRedisTokenStore(ctx context.Context, url string, logger *slog.Logger) (*redisTokenStore, error) {
	if url == "" {
		return nil, fmt.Errorf("REDIS_URL is required when STORE_BACKEND=redis")
	}
	opts, err := redis.ParseURL(url)
	if err != nil {
		return nil, fmt.Errorf("parse REDIS_URL: %w", err)
	}
	rdb := redis.NewClient(opts)
	if err := rdb.Ping(ctx).Err(); err != nil {
		rdb.Close()
		return nil, fmt.Errorf("redis ping: %w", err)
	}
	return &redisTokenStore{rdb: rdb, logger: logger}, nil
}

func (s *redisTokenStore) Register(ctx context.Context, token string, ttl time.Duration) error {
	// SET NX EX — only set if key doesn't exist, with TTL for automatic expiry.
	ok, err := s.rdb.SetNX(ctx, redisKeyPrefix+token, "1", ttl).Result()
	if err != nil {
		return fmt.Errorf("redis SET NX: %w", err)
	}
	if !ok {
		return ErrTokenExists
	}
	// Maintain atomic counter — best-effort, count may drift slightly if
	// this INCR fails but the SET NX succeeded. Acceptable for capacity checks.
	s.rdb.Incr(ctx, redisCounterKey)
	return nil
}

func (s *redisTokenStore) Consume(ctx context.Context, token string) (bool, error) {
	// DEL returns the number of keys deleted: 1 = consumed, 0 = didn't exist.
	n, err := s.rdb.Del(ctx, redisKeyPrefix+token).Result()
	if err != nil {
		return false, fmt.Errorf("redis DEL: %w", err)
	}
	if n > 0 {
		s.rdb.Decr(ctx, redisCounterKey)
		return true, nil
	}
	return false, nil
}

func (s *redisTokenStore) Exists(ctx context.Context, token string) (bool, error) {
	n, err := s.rdb.Exists(ctx, redisKeyPrefix+token).Result()
	if err != nil {
		return false, fmt.Errorf("redis EXISTS: %w", err)
	}
	return n > 0, nil
}

func (s *redisTokenStore) Count(ctx context.Context) (int, error) {
	// O(1) counter maintained by Register (INCR) and Consume (DECR).
	// May drift slightly if INCR/DECR fail after the primary SET NX/DEL
	// succeeds, but this is acceptable for capacity checks.
	n, err := s.rdb.Get(ctx, redisCounterKey).Int()
	if err == redis.Nil {
		return 0, nil
	}
	if err != nil {
		return 0, fmt.Errorf("redis GET counter: %w", err)
	}
	if n < 0 {
		return 0, nil // clamp negative drift
	}
	return n, nil
}

func (s *redisTokenStore) Cleanup(_ context.Context) error {
	// No-op — Redis TTL handles expiry server-side.
	return nil
}

func (s *redisTokenStore) Close() error {
	return s.rdb.Close()
}

func (s *redisTokenStore) Ping(ctx context.Context) error {
	return s.rdb.Ping(ctx).Err()
}
