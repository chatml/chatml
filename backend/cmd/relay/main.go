// Package main provides the ChatML cloud relay server.
//
// The relay accepts WebSocket connections from both a "node" (desktop ChatML)
// and a "mobile" client, paired via a one-time token. Once paired, all
// messages are forwarded bidirectionally.
//
// Configuration is via environment variables:
//
//	RELAY_ENV          - "dev" or "production" (default: "dev")
//	PORT               - Listen port (default: 8787)
//	ALLOWED_ORIGINS    - Comma-separated origins for CORS/WebSocket (required in production)
//	MAX_REGISTRATIONS  - Max pending token registrations (default: 1000)
//	MAX_ACTIVE_PAIRS   - Max concurrent active pairs, 0=unlimited (default: 0)
//	PAIRING_TTL        - Token expiry duration (default: 5m)
//	MAX_BODY_SIZE      - Max request body bytes (default: 1024)
//	SHUTDOWN_TIMEOUT   - Graceful shutdown deadline (default: 15s)
//	TRUST_PROXY        - Trust X-Forwarded-For header (default: false)
//	INSTANCE_ID        - Instance identifier for health endpoint (default: hostname)
//
// Horizontal Scaling:
//
// The relay is stateful: pending/active WebSocket pairs are pinned to the
// instance that upgraded them. For multi-instance deployments:
//   - Use a shared TokenStore (Redis) for the registration phase
//   - Configure token-based sticky sessions at the load balancer
//     for WebSocket paths (/ws/node, /ws/mobile)
//
// Usage:
//
//	RELAY_ENV=dev go run ./cmd/relay/
//	RELAY_ENV=production ALLOWED_ORIGINS=https://app.chatml.com go run ./cmd/relay/
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"time"

	"github.com/gorilla/websocket"
)

// ---------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------

const (
	defaultPort             = 8787
	defaultMaxRegistrations = 1000
	defaultPairingTTL       = 5 * time.Minute
	defaultMaxBodySize      = 1024 // bytes
	defaultShutdownTimeout  = 15 * time.Second
	defaultMaxTokenLength   = 128

	cleanupInterval  = 30 * time.Second
	pingInterval     = 30 * time.Second
	pongWait         = 60 * time.Second
	writeWait        = 10 * time.Second
	maxMessageSize   = 1 * 1024 * 1024 // 1MB — relay only forwards, no need for large messages
	closeCodeRestart = 4000            // custom WebSocket close code: server restarting
)

// Config holds all runtime configuration, loaded from environment variables.
type Config struct {
	Env              string
	Port             int
	AllowedOrigins   []string
	MaxRegistrations int
	MaxActivePairs   int // 0 = unlimited
	PairingTTL       time.Duration
	MaxBodySize      int64
	ShutdownTimeout  time.Duration
	TrustProxy       bool   // trust X-Forwarded-For for client IP extraction
	InstanceID       string // identifies this instance in health/metrics
	StoreBackend     string // "memory" (default) or "redis"
	RedisURL         string // Redis connection string (required when StoreBackend=redis)
}

func loadConfig() *Config {
	hostname, _ := os.Hostname()
	cfg := &Config{
		Env:              envOr("RELAY_ENV", "dev"),
		Port:             envInt("PORT", defaultPort),
		MaxRegistrations: envInt("MAX_REGISTRATIONS", defaultMaxRegistrations),
		MaxActivePairs:   envInt("MAX_ACTIVE_PAIRS", 0),
		PairingTTL:       envDuration("PAIRING_TTL", defaultPairingTTL),
		MaxBodySize:      int64(envInt("MAX_BODY_SIZE", defaultMaxBodySize)),
		ShutdownTimeout:  envDuration("SHUTDOWN_TIMEOUT", defaultShutdownTimeout),
		TrustProxy:       os.Getenv("TRUST_PROXY") == "true",
		InstanceID:       envOr("INSTANCE_ID", hostname),
		StoreBackend:     envOr("STORE_BACKEND", "memory"),
		RedisURL:         os.Getenv("REDIS_URL"),
	}

	if origins := os.Getenv("ALLOWED_ORIGINS"); origins != "" {
		for _, o := range strings.Split(origins, ",") {
			if trimmed := strings.TrimSpace(o); trimmed != "" {
				cfg.AllowedOrigins = append(cfg.AllowedOrigins, trimmed)
			}
		}
	}

	if cfg.Env == "production" && len(cfg.AllowedOrigins) == 0 {
		fmt.Fprintln(os.Stderr, "FATAL: ALLOWED_ORIGINS is required when RELAY_ENV=production")
		os.Exit(1)
	}

	return cfg
}

func (c *Config) isDev() bool {
	return c.Env != "production"
}

// ---------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------

func setupLogger(env string) *slog.Logger {
	opts := &slog.HandlerOptions{Level: slog.LevelInfo}
	if env != "production" {
		opts.Level = slog.LevelDebug
	}
	var handler slog.Handler
	if env == "production" {
		handler = slog.NewJSONHandler(os.Stderr, opts)
	} else {
		handler = slog.NewTextHandler(os.Stderr, opts)
	}
	return slog.New(handler)
}

// truncToken returns "abcd...wxyz" for safe logging.
func truncToken(token string) string {
	if len(token) < 8 {
		return "***"
	}
	return token[:4] + "..." + token[len(token)-4:]
}

// ---------------------------------------------------------------------
// Token Store
// ---------------------------------------------------------------------

// TokenStore manages pairing token registration and lookup.
//
// The default in-memory implementation is suitable for single-instance
// deployments. For horizontal scaling, swap with a Redis-backed store
// so any instance can accept POST /api/pair and any instance can look up
// the token in HandleNodeWS. The pending and active maps remain in-memory
// since WebSocket connections are inherently pinned to the upgrading instance.
//
// All methods accept context.Context and return errors to support async
// backends (Redis). The in-memory implementation always returns nil errors.
//
// Thread-safety: The Relay's mu lock protects in-memory store calls.
// A Redis-backed store relies on Redis's own atomicity (SET NX, DEL).
type TokenStore interface {
	// Register stores a token. Returns ErrTokenExists if already registered.
	Register(ctx context.Context, token string, ttl time.Duration) error
	// Consume atomically checks and removes a token. Returns true if it existed.
	Consume(ctx context.Context, token string) (bool, error)
	// Exists checks whether a token is registered.
	Exists(ctx context.Context, token string) (bool, error)
	// Count returns the number of registered tokens.
	Count(ctx context.Context) (int, error)
	// Cleanup removes expired tokens. No-op for stores with server-side TTL.
	Cleanup(ctx context.Context) error
	// Ping checks backend connectivity. No-op for in-memory stores.
	Ping(ctx context.Context) error
	// Close releases resources (connection pools, etc.).
	Close() error
}

// ErrTokenExists is returned by Register when the token is already registered.
var ErrTokenExists = fmt.Errorf("token already exists")

// memoryTokenStore is the default single-instance TokenStore.
type memoryTokenStore struct {
	ttl    time.Duration
	tokens map[string]time.Time
}

func newMemoryTokenStore(ttl time.Duration) *memoryTokenStore {
	return &memoryTokenStore{ttl: ttl, tokens: make(map[string]time.Time)}
}

func (s *memoryTokenStore) Register(_ context.Context, token string, _ time.Duration) error {
	if _, ok := s.tokens[token]; ok {
		return ErrTokenExists
	}
	s.tokens[token] = time.Now()
	return nil
}

func (s *memoryTokenStore) Consume(_ context.Context, token string) (bool, error) {
	if _, ok := s.tokens[token]; ok {
		delete(s.tokens, token)
		return true, nil
	}
	return false, nil
}

func (s *memoryTokenStore) Exists(_ context.Context, token string) (bool, error) {
	_, ok := s.tokens[token]
	return ok, nil
}

func (s *memoryTokenStore) Count(_ context.Context) (int, error) {
	return len(s.tokens), nil
}

func (s *memoryTokenStore) Cleanup(_ context.Context) error {
	now := time.Now()
	for token, regTime := range s.tokens {
		if now.Sub(regTime) > s.ttl {
			delete(s.tokens, token)
		}
	}
	return nil
}

func (s *memoryTokenStore) Ping(_ context.Context) error {
	return nil
}

func (s *memoryTokenStore) Close() error {
	s.tokens = nil
	return nil
}

// ---------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------

// PendingPair represents a desktop node waiting for a mobile client.
type PendingPair struct {
	NodeConn  *websocket.Conn
	CreatedAt time.Time
	done      chan struct{}   // closed when mobile pairs or pending expires
	exited    chan struct{}   // closed when read pump goroutine exits
	writeMu   sync.Mutex     // protects writes (pings) during pending phase
}

// ActivePair represents a connected desktop-mobile pair.
type ActivePair struct {
	Node   *websocket.Conn
	Mobile *websocket.Conn
	done   chan struct{}
	// Per-connection write mutexes — gorilla/websocket allows one concurrent writer.
	nodeMu   sync.Mutex
	mobileMu sync.Mutex
}

// ---------------------------------------------------------------------
// Relay
// ---------------------------------------------------------------------

// Relay manages pairing state and message forwarding.
type Relay struct {
	cfg      *Config
	logger   *slog.Logger
	upgrader websocket.Upgrader
	limiter  *ipRateLimiter
	draining atomic.Bool // set on SIGTERM; readiness probe returns 503

	mu      sync.RWMutex
	tokens  TokenStore             // registered tokens (swappable for Redis)
	pending map[string]*PendingPair // token → waiting node (instance-local)
	active  map[string]*ActivePair  // token → connected pair (instance-local)
}

// NewRelay creates a relay and starts the background cleanup goroutine.
// The cleanup goroutine stops when ctx is cancelled.
func NewRelay(ctx context.Context, cfg *Config, logger *slog.Logger, tokens TokenStore) *Relay {
	r := &Relay{
		cfg:      cfg,
		logger:   logger,
		upgrader: newUpgrader(cfg),
		limiter:  newIPRateLimiter(ctx),
		tokens:   tokens,
		pending:  make(map[string]*PendingPair),
		active:   make(map[string]*ActivePair),
	}
	go r.cleanupLoop(ctx)
	return r
}

func newUpgrader(cfg *Config) websocket.Upgrader {
	return websocket.Upgrader{
		CheckOrigin: func(r *http.Request) bool {
			if cfg.isDev() {
				return true
			}
			origin := r.Header.Get("Origin")
			for _, allowed := range cfg.AllowedOrigins {
				if origin == allowed {
					return true
				}
			}
			return false
		},
	}
}

// Shutdown closes all active and pending WebSocket connections.
// Called during graceful shutdown to unblock hijacked connections that
// http.Server.Shutdown does not close.
func (r *Relay) Shutdown() {
	r.mu.Lock()
	defer r.mu.Unlock()

	closeMsg := websocket.FormatCloseMessage(closeCodeRestart, "server restarting")

	for token, pair := range r.active {
		// Send structured close frame so clients can detect server restart
		// and reconnect automatically instead of treating it as a fatal error.
		pair.nodeMu.Lock()
		pair.Node.WriteControl(websocket.CloseMessage, closeMsg, time.Now().Add(writeWait))
		pair.nodeMu.Unlock()
		pair.mobileMu.Lock()
		pair.Mobile.WriteControl(websocket.CloseMessage, closeMsg, time.Now().Add(writeWait))
		pair.mobileMu.Unlock()

		select {
		case <-pair.done:
		default:
			close(pair.done)
		}
		pair.Node.Close()
		pair.Mobile.Close()
		delete(r.active, token)
	}

	for token, p := range r.pending {
		p.writeMu.Lock()
		p.NodeConn.WriteControl(websocket.CloseMessage, closeMsg, time.Now().Add(writeWait))
		p.writeMu.Unlock()

		select {
		case <-p.done:
		default:
			close(p.done)
		}
		p.NodeConn.Close()
		delete(r.pending, token)
	}

	if err := r.tokens.Close(); err != nil {
		r.logger.Error("error closing token store", "err", err)
	}
	r.logger.Info("all relay connections closed")
}

// cleanupLoop removes expired pending pairings and stale registrations.
func (r *Relay) cleanupLoop(ctx context.Context) {
	ticker := time.NewTicker(cleanupInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			r.cleanup()
		}
	}
}

func (r *Relay) cleanup() {
	r.mu.Lock()
	defer r.mu.Unlock()

	for token, p := range r.pending {
		if time.Since(p.CreatedAt) > r.cfg.PairingTTL {
			r.logger.Info("expired pending pairing", "token", truncToken(token))
			select {
			case <-p.done:
			default:
				close(p.done)
			}
			p.NodeConn.Close()
			delete(r.pending, token)
		}
	}
	if err := r.tokens.Cleanup(context.Background()); err != nil {
		r.logger.Error("token cleanup error", "err", err)
	}
}

// ---------------------------------------------------------------------
// HTTP Handlers
// ---------------------------------------------------------------------

// HandlePairRegister handles POST /api/pair — registers a pairing token.
func (r *Relay) HandlePairRegister(w http.ResponseWriter, req *http.Request) {
	// Per-IP rate limiting to prevent token pool exhaustion
	ip := extractClientIP(req, r.cfg.TrustProxy)
	if !r.limiter.allow(ip) {
		writeJSONError(w, "rate limit exceeded", http.StatusTooManyRequests)
		return
	}

	req.Body = http.MaxBytesReader(w, req.Body, r.cfg.MaxBodySize)

	var body struct {
		Token string `json:"token"`
	}
	if err := json.NewDecoder(req.Body).Decode(&body); err != nil || body.Token == "" {
		writeJSONError(w, "token required", http.StatusBadRequest)
		return
	}

	if len(body.Token) > defaultMaxTokenLength {
		writeJSONError(w, "token too long", http.StatusBadRequest)
		return
	}

	ctx := req.Context()
	r.mu.Lock()

	// Capacity check: registered + pending must not exceed max.
	// NOTE: With multiple instances, this is per-instance for pending,
	// but shared via Redis for tokens.
	tokenCount, err := r.tokens.Count(ctx)
	if err != nil {
		r.mu.Unlock()
		r.logger.Error("token count error", "err", err)
		writeJSONError(w, "internal error", http.StatusInternalServerError)
		return
	}
	if tokenCount+len(r.pending) >= r.cfg.MaxRegistrations {
		r.mu.Unlock()
		writeJSONError(w, "too many pending registrations", http.StatusTooManyRequests)
		return
	}

	_, pendingExists := r.pending[body.Token]
	_, activeExists := r.active[body.Token]
	if pendingExists || activeExists {
		r.mu.Unlock()
		writeJSONError(w, "token already in use", http.StatusConflict)
		return
	}

	if err := r.tokens.Register(ctx, body.Token, r.cfg.PairingTTL); err != nil {
		r.mu.Unlock()
		if err == ErrTokenExists {
			writeJSONError(w, "token already in use", http.StatusConflict)
			return
		}
		r.logger.Error("token register error", "err", err)
		writeJSONError(w, "internal error", http.StatusInternalServerError)
		return
	}
	r.mu.Unlock()

	r.logger.Info("token registered", "token", truncToken(body.Token))
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]bool{"ok": true})
}

// HandleNodeWS handles GET /ws/node — desktop ChatML connects here.
func (r *Relay) HandleNodeWS(w http.ResponseWriter, req *http.Request) {
	token := extractBearerToken(req)
	if token == "" {
		token = req.URL.Query().Get("token")
	}
	if token == "" || len(token) > defaultMaxTokenLength {
		http.Error(w, "invalid token", http.StatusBadRequest)
		return
	}

	ctx := req.Context()
	r.mu.Lock()
	if _, pend := r.pending[token]; pend {
		r.mu.Unlock()
		http.Error(w, "token already connected", http.StatusConflict)
		return
	}
	if _, act := r.active[token]; act {
		r.mu.Unlock()
		http.Error(w, "token already paired", http.StatusConflict)
		return
	}
	// Atomically consume the token — this is the single source of truth.
	// With Redis, Consume uses DEL which returns 1 only for the first caller,
	// preventing two instances from both claiming the same token.
	consumed, err := r.tokens.Consume(ctx, token)
	if err != nil {
		r.mu.Unlock()
		r.logger.Error("token consume failed", "err", err)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	if !consumed {
		r.mu.Unlock()
		http.Error(w, "token not registered", http.StatusForbidden)
		return
	}
	r.mu.Unlock()

	conn, err := r.upgrader.Upgrade(w, req, nil)
	if err != nil {
		r.logger.Error("node WebSocket upgrade failed", "err", err)
		return
	}

	conn.SetReadLimit(maxMessageSize)

	pending := &PendingPair{
		NodeConn:  conn,
		CreatedAt: time.Now(),
		done:      make(chan struct{}),
		exited:    make(chan struct{}),
	}

	r.mu.Lock()
	r.pending[token] = pending
	r.mu.Unlock()

	r.logger.Info("node connected, waiting for mobile", "token", truncToken(token))

	conn.SetPongHandler(func(string) error {
		conn.SetReadDeadline(time.Now().Add(pongWait))
		return nil
	})
	conn.SetReadDeadline(time.Now().Add(pongWait))

	// Ping ticker — keeps the pending node alive until mobile pairs.
	// Without this, the read deadline (60s) would silently kill the
	// connection even though PairingTTL may be much longer.
	go func() {
		ticker := time.NewTicker(pingInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				pending.writeMu.Lock()
				conn.SetWriteDeadline(time.Now().Add(writeWait))
				err := conn.WriteMessage(websocket.PingMessage, nil)
				pending.writeMu.Unlock()
				if err != nil {
					return
				}
			case <-pending.done:
				return
			}
		}
	}()

	// Read pump — keeps connection alive and detects disconnect.
	// Exits when done is closed (mobile paired) or on read error.
	go func() {
		defer close(pending.exited)
		defer func() {
			r.mu.Lock()
			if p, ok := r.pending[token]; ok && p.NodeConn == conn {
				delete(r.pending, token)
				r.logger.Info("node disconnected while pending", "token", truncToken(token))
			}
			r.mu.Unlock()
		}()
		for {
			select {
			case <-pending.done:
				return
			default:
			}
			if _, _, err := conn.ReadMessage(); err != nil {
				return
			}
		}
	}()
}

// HandleMobileWS handles GET /ws/mobile?token=X — mobile app connects here.
func (r *Relay) HandleMobileWS(w http.ResponseWriter, req *http.Request) {
	token := req.URL.Query().Get("token")
	if token == "" || len(token) > defaultMaxTokenLength {
		http.Error(w, "invalid token", http.StatusBadRequest)
		return
	}

	// Check that the token is pending and we have capacity (short lock, released before upgrade).
	r.mu.Lock()
	_, exists := r.pending[token]
	if !exists {
		r.mu.Unlock()
		http.Error(w, "invalid or expired token", http.StatusNotFound)
		return
	}
	if r.cfg.MaxActivePairs > 0 && len(r.active) >= r.cfg.MaxActivePairs {
		r.mu.Unlock()
		writeJSONError(w, "relay at capacity", http.StatusServiceUnavailable)
		return
	}
	r.mu.Unlock()

	// Upgrade outside the lock — this involves HTTP I/O and can block.
	conn, err := r.upgrader.Upgrade(w, req, nil)
	if err != nil {
		r.logger.Error("mobile WebSocket upgrade failed", "err", err)
		return
	}
	conn.SetReadLimit(maxMessageSize)

	// Re-acquire lock and re-check: the node may have disconnected during upgrade.
	r.mu.Lock()
	pending, stillExists := r.pending[token]
	if !stillExists {
		r.mu.Unlock()
		conn.Close()
		return
	}
	delete(r.pending, token)

	// Stop the pending read pump and ping ticker BEFORE forward() starts
	// reading from the same connection. gorilla/websocket only supports one
	// concurrent reader — without this, two goroutines would race on ReadMessage.
	close(pending.done)
	// Force the read pump's blocking ReadMessage to return immediately by
	// expiring the read deadline so we can wait for the goroutine to exit.
	pending.NodeConn.SetReadDeadline(time.Now())
	r.mu.Unlock()
	<-pending.exited
	// Clear the deadline for the forwarding phase.
	pending.NodeConn.SetReadDeadline(time.Time{})
	r.mu.Lock()

	pair := &ActivePair{
		Node:   pending.NodeConn,
		Mobile: conn,
		done:   make(chan struct{}),
	}
	r.active[token] = pair
	r.mu.Unlock()

	r.logger.Info("paired", "token", truncToken(token))

	// Notify both sides — hold write mutexes to avoid racing with forward() pings.
	pairedMsg, _ := json.Marshal(map[string]interface{}{
		"jsonrpc": "2.0",
		"method":  "paired",
		"params":  map[string]string{"status": "paired"},
	})
	pair.nodeMu.Lock()
	pair.Node.WriteMessage(websocket.TextMessage, pairedMsg)
	pair.nodeMu.Unlock()

	pair.mobileMu.Lock()
	pair.Mobile.WriteMessage(websocket.TextMessage, pairedMsg)
	pair.mobileMu.Unlock()

	// Bidirectional forwarding
	go r.forward("mobile→node", pair.Mobile, pair.Node, &pair.mobileMu, &pair.nodeMu, pair, token)
	go r.forward("node→mobile", pair.Node, pair.Mobile, &pair.nodeMu, &pair.mobileMu, pair, token)
}

// HandleHealth handles GET /health (liveness probe).
func (r *Relay) HandleHealth(w http.ResponseWriter, _ *http.Request) {
	r.mu.RLock()
	tokenCount, err := r.tokens.Count(context.Background())
	if err != nil {
		r.logger.Warn("health: token count unavailable", "err", err)
		tokenCount = -1
	}
	stats := map[string]interface{}{
		"status":     "ok",
		"instance":   r.cfg.InstanceID,
		"registered": tokenCount,
		"pending":    len(r.pending),
		"active":     len(r.active),
	}
	r.mu.RUnlock()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(stats)
}

// HandleReady handles GET /ready (readiness probe).
// Returns 503 when draining, Redis is unreachable, or at capacity.
func (r *Relay) HandleReady(w http.ResponseWriter, _ *http.Request) {
	if r.draining.Load() {
		writeJSONError(w, "draining", http.StatusServiceUnavailable)
		return
	}
	// Check token store connectivity (no-op for in-memory, pings Redis, etc.)
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if err := r.tokens.Ping(ctx); err != nil {
		writeJSONError(w, "store unavailable", http.StatusServiceUnavailable)
		return
	}
	// Check capacity
	if r.cfg.MaxActivePairs > 0 {
		r.mu.RLock()
		active := len(r.active)
		r.mu.RUnlock()
		if active >= r.cfg.MaxActivePairs {
			writeJSONError(w, "at capacity", http.StatusServiceUnavailable)
			return
		}
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "ready"})
}

// ---------------------------------------------------------------------
// Message Forwarding
// ---------------------------------------------------------------------

// forward reads from src and writes to dst until an error occurs.
func (r *Relay) forward(direction string, src, dst *websocket.Conn, srcWriteMu, dstWriteMu *sync.Mutex, pair *ActivePair, token string) {
	defer func() {
		select {
		case <-pair.done:
		default:
			close(pair.done)
		}

		src.Close()
		dst.Close()

		r.mu.Lock()
		if a, ok := r.active[token]; ok && a == pair {
			delete(r.active, token)
			r.logger.Info("pair disconnected", "direction", direction, "token", truncToken(token))
		}
		r.mu.Unlock()
	}()

	src.SetReadDeadline(time.Now().Add(pongWait))
	src.SetPongHandler(func(string) error {
		src.SetReadDeadline(time.Now().Add(pongWait))
		return nil
	})

	// Ping ticker for src — uses srcWriteMu to avoid racing with
	// the other forward() goroutine that writes to this connection as dst.
	go func() {
		ticker := time.NewTicker(pingInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				srcWriteMu.Lock()
				src.SetWriteDeadline(time.Now().Add(writeWait))
				err := src.WriteMessage(websocket.PingMessage, nil)
				srcWriteMu.Unlock()
				if err != nil {
					return
				}
			case <-pair.done:
				return
			}
		}
	}()

	for {
		msgType, msg, err := src.ReadMessage()
		if err != nil {
			return
		}
		dstWriteMu.Lock()
		dst.SetWriteDeadline(time.Now().Add(writeWait))
		err = dst.WriteMessage(msgType, msg)
		dstWriteMu.Unlock()
		if err != nil {
			return
		}
	}
}

// ---------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------

func corsMiddleware(cfg *Config, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if cfg.isDev() {
			w.Header().Set("Access-Control-Allow-Origin", "*")
		} else {
			origin := r.Header.Get("Origin")
			for _, allowed := range cfg.AllowedOrigins {
				if origin == allowed {
					w.Header().Set("Access-Control-Allow-Origin", origin)
					w.Header().Set("Vary", "Origin")
					break
				}
			}
		}
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// ---------------------------------------------------------------------
// Rate Limiting
// ---------------------------------------------------------------------

const (
	rateLimitWindow   = time.Minute
	rateLimitMaxCalls = 10 // max registrations per IP per minute
	rateLimitCleanup  = 5 * time.Minute
)

// ipRateLimiter tracks per-IP request counts within a fixed window.
// NOTE: This is per-instance. With N relay instances, an IP gets
// N * rateLimitMaxCalls per window. For cluster-wide enforcement,
// replace with a Redis-backed counter (INCR with TTL).
type ipRateLimiter struct {
	mu      sync.Mutex
	entries map[string]*rateLimitEntry
}

type rateLimitEntry struct {
	count    int
	windowAt time.Time
}

func newIPRateLimiter(ctx context.Context) *ipRateLimiter {
	rl := &ipRateLimiter{entries: make(map[string]*rateLimitEntry)}
	go func() {
		ticker := time.NewTicker(rateLimitCleanup)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				rl.mu.Lock()
				now := time.Now()
				for ip, e := range rl.entries {
					if now.Sub(e.windowAt) > rateLimitWindow {
						delete(rl.entries, ip)
					}
				}
				rl.mu.Unlock()
			}
		}
	}()
	return rl
}

func (rl *ipRateLimiter) allow(ip string) bool {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	now := time.Now()
	e, ok := rl.entries[ip]
	if !ok || now.Sub(e.windowAt) > rateLimitWindow {
		rl.entries[ip] = &rateLimitEntry{count: 1, windowAt: now}
		return true
	}
	e.count++
	return e.count <= rateLimitMaxCalls
}

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------

// writeJSONError writes a JSON error response with the correct Content-Type.
func writeJSONError(w http.ResponseWriter, msg string, code int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(map[string]string{"error": msg})
}

func extractBearerToken(r *http.Request) string {
	auth := r.Header.Get("Authorization")
	if strings.HasPrefix(auth, "Bearer ") {
		return strings.TrimPrefix(auth, "Bearer ")
	}
	return ""
}

func extractClientIP(r *http.Request, trustProxy bool) string {
	// Only trust X-Forwarded-For when TRUST_PROXY=true (i.e., behind a
	// reverse proxy that overwrites the header). Without this, any client
	// can spoof the header to bypass rate limiting.
	if trustProxy {
		if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
			if parts := strings.SplitN(xff, ",", 2); len(parts) > 0 {
				return strings.TrimSpace(parts[0])
			}
		}
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func envInt(key string, fallback int) int {
	v := os.Getenv(key)
	if v == "" {
		return fallback
	}
	var n int
	if _, err := fmt.Sscanf(v, "%d", &n); err != nil {
		return fallback
	}
	return n
}

func envDuration(key string, fallback time.Duration) time.Duration {
	v := os.Getenv(key)
	if v == "" {
		return fallback
	}
	d, err := time.ParseDuration(v)
	if err != nil {
		return fallback
	}
	return d
}

// ---------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------

func main() {
	cfg := loadConfig()
	logger := setupLogger(cfg.Env)
	slog.SetDefault(logger)

	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancel()

	// Select token store backend
	var tokens TokenStore
	switch cfg.StoreBackend {
	case "redis":
		var err error
		tokens, err = newRedisTokenStore(ctx, cfg.RedisURL, logger)
		if err != nil {
			logger.Error("failed to connect to Redis", "err", err, "url", cfg.RedisURL)
			os.Exit(1)
		}
		logger.Info("using Redis token store", "url", cfg.RedisURL)
	default:
		tokens = newMemoryTokenStore(cfg.PairingTTL)
		logger.Info("using in-memory token store")
	}

	relay := NewRelay(ctx, cfg, logger, tokens)

	mux := http.NewServeMux()
	mux.HandleFunc("POST /api/pair", relay.HandlePairRegister)
	mux.HandleFunc("GET /ws/node", relay.HandleNodeWS)
	mux.HandleFunc("GET /ws/mobile", relay.HandleMobileWS)
	mux.HandleFunc("GET /health", relay.HandleHealth)
	mux.HandleFunc("GET /ready", relay.HandleReady)

	handler := corsMiddleware(cfg, mux)

	srv := &http.Server{
		Addr:        fmt.Sprintf(":%d", cfg.Port),
		Handler:     handler,
		ReadTimeout: 15 * time.Second,
		IdleTimeout: 60 * time.Second,
		// No WriteTimeout — would kill long-lived WebSocket connections.
	}

	go func() {
		logger.Info("relay server starting",
			"port", cfg.Port,
			"env", cfg.Env,
			"origins", cfg.AllowedOrigins,
		)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			logger.Error("server error", "err", err)
			os.Exit(1)
		}
	}()

	<-ctx.Done()
	logger.Info("shutdown signal received, entering drain mode")

	// Enter drain mode — /ready returns 503 so the load balancer stops
	// routing new connections to this instance.
	relay.draining.Store(true)

	// Give the load balancer time to detect the readiness change
	// (~2 health check intervals at 5s each).
	time.Sleep(5 * time.Second)

	// Close all WebSocket connections — http.Server.Shutdown does not
	// close hijacked connections, so it would hang until ShutdownTimeout.
	relay.Shutdown()

	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), cfg.ShutdownTimeout)
	defer shutdownCancel()

	if err := srv.Shutdown(shutdownCtx); err != nil {
		logger.Error("shutdown error", "err", err)
	}

	logger.Info("server stopped")
}
