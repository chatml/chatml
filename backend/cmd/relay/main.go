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
//	PAIRING_TTL        - Token expiry duration (default: 5m)
//	MAX_BODY_SIZE      - Max request body bytes (default: 1024)
//	SHUTDOWN_TIMEOUT   - Graceful shutdown deadline (default: 15s)
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
	"net/http"
	"os"
	"os/signal"
	"strings"
	"sync"
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

	cleanupInterval = 30 * time.Second
	pingInterval    = 30 * time.Second
	pongWait        = 60 * time.Second
	writeWait       = 10 * time.Second
)

// Config holds all runtime configuration, loaded from environment variables.
type Config struct {
	Env              string
	Port             int
	AllowedOrigins   []string
	MaxRegistrations int
	PairingTTL       time.Duration
	MaxBodySize      int64
	ShutdownTimeout  time.Duration
}

func loadConfig() *Config {
	cfg := &Config{
		Env:              envOr("RELAY_ENV", "dev"),
		Port:             envInt("PORT", defaultPort),
		MaxRegistrations: envInt("MAX_REGISTRATIONS", defaultMaxRegistrations),
		PairingTTL:       envDuration("PAIRING_TTL", defaultPairingTTL),
		MaxBodySize:      int64(envInt("MAX_BODY_SIZE", defaultMaxBodySize)),
		ShutdownTimeout:  envDuration("SHUTDOWN_TIMEOUT", defaultShutdownTimeout),
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
// Types
// ---------------------------------------------------------------------

// PendingPair represents a desktop node waiting for a mobile client.
type PendingPair struct {
	NodeConn  *websocket.Conn
	CreatedAt time.Time
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

	mu         sync.RWMutex
	registered map[string]time.Time   // token → registration time (from /api/pair)
	pending    map[string]*PendingPair // token → waiting node
	active     map[string]*ActivePair  // token → connected pair
}

// NewRelay creates a relay and starts the background cleanup goroutine.
// The cleanup goroutine stops when ctx is cancelled.
func NewRelay(ctx context.Context, cfg *Config, logger *slog.Logger) *Relay {
	r := &Relay{
		cfg:        cfg,
		logger:     logger,
		upgrader:   newUpgrader(cfg),
		registered: make(map[string]time.Time),
		pending:    make(map[string]*PendingPair),
		active:     make(map[string]*ActivePair),
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

	for token, pair := range r.active {
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
		p.NodeConn.Close()
		delete(r.pending, token)
	}

	r.registered = make(map[string]time.Time)
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
			p.NodeConn.Close()
			delete(r.pending, token)
		}
	}
	for token, regTime := range r.registered {
		if time.Since(regTime) > r.cfg.PairingTTL {
			r.logger.Info("expired registration", "token", truncToken(token))
			delete(r.registered, token)
		}
	}
}

// ---------------------------------------------------------------------
// HTTP Handlers
// ---------------------------------------------------------------------

// HandlePairRegister handles POST /api/pair — registers a pairing token.
func (r *Relay) HandlePairRegister(w http.ResponseWriter, req *http.Request) {
	req.Body = http.MaxBytesReader(w, req.Body, r.cfg.MaxBodySize)

	var body struct {
		Token string `json:"token"`
	}
	if err := json.NewDecoder(req.Body).Decode(&body); err != nil || body.Token == "" {
		http.Error(w, `{"error":"token required"}`, http.StatusBadRequest)
		return
	}

	if len(body.Token) > defaultMaxTokenLength {
		http.Error(w, `{"error":"token too long"}`, http.StatusBadRequest)
		return
	}

	r.mu.Lock()

	if len(r.registered)+len(r.pending) >= r.cfg.MaxRegistrations {
		r.mu.Unlock()
		http.Error(w, `{"error":"too many pending registrations"}`, http.StatusTooManyRequests)
		return
	}

	_, registeredExists := r.registered[body.Token]
	_, pendingExists := r.pending[body.Token]
	_, activeExists := r.active[body.Token]

	if registeredExists || pendingExists || activeExists {
		r.mu.Unlock()
		http.Error(w, `{"error":"token already in use"}`, http.StatusConflict)
		return
	}

	r.registered[body.Token] = time.Now()
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

	r.mu.Lock()
	if _, registered := r.registered[token]; !registered {
		r.mu.Unlock()
		http.Error(w, "token not registered", http.StatusForbidden)
		return
	}
	if _, exists := r.pending[token]; exists {
		r.mu.Unlock()
		http.Error(w, "token already connected", http.StatusConflict)
		return
	}
	if _, exists := r.active[token]; exists {
		r.mu.Unlock()
		http.Error(w, "token already paired", http.StatusConflict)
		return
	}
	delete(r.registered, token)
	r.mu.Unlock()

	conn, err := r.upgrader.Upgrade(w, req, nil)
	if err != nil {
		r.logger.Error("node WebSocket upgrade failed", "err", err)
		return
	}

	r.mu.Lock()
	r.pending[token] = &PendingPair{
		NodeConn:  conn,
		CreatedAt: time.Now(),
	}
	r.mu.Unlock()

	r.logger.Info("node connected, waiting for mobile", "token", truncToken(token))

	conn.SetPongHandler(func(string) error {
		conn.SetReadDeadline(time.Now().Add(pongWait))
		return nil
	})
	conn.SetReadDeadline(time.Now().Add(pongWait))

	// Read pump — keeps connection alive and detects disconnect
	go func() {
		defer func() {
			r.mu.Lock()
			if p, ok := r.pending[token]; ok && p.NodeConn == conn {
				delete(r.pending, token)
				r.logger.Info("node disconnected while pending", "token", truncToken(token))
			}
			r.mu.Unlock()
		}()
		for {
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

	// Check that the token is pending (short lock, released before upgrade).
	r.mu.Lock()
	_, exists := r.pending[token]
	if !exists {
		r.mu.Unlock()
		http.Error(w, "invalid or expired token", http.StatusNotFound)
		return
	}
	r.mu.Unlock()

	// Upgrade outside the lock — this involves HTTP I/O and can block.
	conn, err := r.upgrader.Upgrade(w, req, nil)
	if err != nil {
		r.logger.Error("mobile WebSocket upgrade failed", "err", err)
		return
	}

	// Re-acquire lock and re-check: the node may have disconnected during upgrade.
	r.mu.Lock()
	pending, stillExists := r.pending[token]
	if !stillExists {
		r.mu.Unlock()
		conn.Close()
		return
	}
	delete(r.pending, token)
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
		"params":  map[string]string{"token": token},
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

// HandleHealth handles GET /health.
func (r *Relay) HandleHealth(w http.ResponseWriter, _ *http.Request) {
	r.mu.RLock()
	stats := map[string]interface{}{
		"status":     "ok",
		"registered": len(r.registered),
		"pending":    len(r.pending),
		"active":     len(r.active),
	}
	r.mu.RUnlock()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(stats)
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
// Helpers
// ---------------------------------------------------------------------

func extractBearerToken(r *http.Request) string {
	auth := r.Header.Get("Authorization")
	if strings.HasPrefix(auth, "Bearer ") {
		return strings.TrimPrefix(auth, "Bearer ")
	}
	return ""
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

	relay := NewRelay(ctx, cfg, logger)

	mux := http.NewServeMux()
	mux.HandleFunc("POST /api/pair", relay.HandlePairRegister)
	mux.HandleFunc("GET /ws/node", relay.HandleNodeWS)
	mux.HandleFunc("GET /ws/mobile", relay.HandleMobileWS)
	mux.HandleFunc("GET /health", relay.HandleHealth)

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
	logger.Info("shutdown signal received")

	// Close all WebSocket connections first — http.Server.Shutdown does not
	// close hijacked connections, so it would hang until ShutdownTimeout.
	relay.Shutdown()

	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), cfg.ShutdownTimeout)
	defer shutdownCancel()

	if err := srv.Shutdown(shutdownCtx); err != nil {
		logger.Error("shutdown error", "err", err)
	}

	logger.Info("server stopped")
}
