package main

import (
	"context"
	"log/slog"
	"os"
	"testing"
	"time"
)

func newTestRedisStore(t *testing.T) *redisTokenStore {
	t.Helper()
	url := os.Getenv("TEST_REDIS_URL")
	if url == "" {
		t.Skip("TEST_REDIS_URL not set, skipping Redis integration test")
	}
	ctx := context.Background()
	logger := slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelError}))
	store, err := newRedisTokenStore(ctx, url, logger)
	if err != nil {
		t.Fatalf("newRedisTokenStore: %v", err)
	}
	t.Cleanup(func() { store.Close() })
	return store
}

func TestRedis_RegisterConsume(t *testing.T) {
	s := newTestRedisStore(t)
	ctx := context.Background()
	token := "test-redis-" + time.Now().Format("150405.000")

	// Register
	if err := s.Register(ctx, token, 30*time.Second); err != nil {
		t.Fatalf("Register: %v", err)
	}

	// Exists
	ok, err := s.Exists(ctx, token)
	if err != nil || !ok {
		t.Fatal("Exists should return true after Register")
	}

	// Consume
	consumed, err := s.Consume(ctx, token)
	if err != nil || !consumed {
		t.Fatal("Consume should return true")
	}

	// Exists after consume
	ok, _ = s.Exists(ctx, token)
	if ok {
		t.Fatal("Exists should return false after Consume")
	}
}

func TestRedis_RegisterNX(t *testing.T) {
	s := newTestRedisStore(t)
	ctx := context.Background()
	token := "test-redis-nx-" + time.Now().Format("150405.000")

	if err := s.Register(ctx, token, 30*time.Second); err != nil {
		t.Fatalf("first Register: %v", err)
	}
	// Cleanup
	defer s.Consume(ctx, token)

	if err := s.Register(ctx, token, 30*time.Second); err != ErrTokenExists {
		t.Fatalf("second Register: got %v, want ErrTokenExists", err)
	}
}

func TestRedis_TTLExpiry(t *testing.T) {
	s := newTestRedisStore(t)
	ctx := context.Background()
	token := "test-redis-ttl-" + time.Now().Format("150405.000")

	if err := s.Register(ctx, token, 1*time.Second); err != nil {
		t.Fatalf("Register: %v", err)
	}

	time.Sleep(2 * time.Second)

	ok, err := s.Exists(ctx, token)
	if err != nil {
		t.Fatalf("Exists: %v", err)
	}
	if ok {
		t.Fatal("token should have expired after TTL")
	}
}

func TestRedis_ConsumeNonExistent(t *testing.T) {
	s := newTestRedisStore(t)
	ctx := context.Background()

	consumed, err := s.Consume(ctx, "nonexistent-token-xyz")
	if err != nil {
		t.Fatalf("Consume: %v", err)
	}
	if consumed {
		t.Fatal("Consume should return false for non-existent token")
	}
}

func TestRedis_Count(t *testing.T) {
	s := newTestRedisStore(t)
	ctx := context.Background()
	prefix := "test-redis-count-" + time.Now().Format("150405.000") + "-"

	for i := 0; i < 3; i++ {
		token := prefix + string(rune('a'+i))
		if err := s.Register(ctx, token, 30*time.Second); err != nil {
			t.Fatalf("Register %d: %v", i, err)
		}
		defer s.Consume(ctx, token)
	}

	n, err := s.Count(ctx)
	if err != nil {
		t.Fatalf("Count: %v", err)
	}
	// Count may include tokens from other tests, so just check >= 3
	if n < 3 {
		t.Fatalf("Count: got %d, want >= 3", n)
	}
}

func TestRedis_Ping(t *testing.T) {
	s := newTestRedisStore(t)
	if err := s.Ping(context.Background()); err != nil {
		t.Fatalf("Ping: %v", err)
	}
}
