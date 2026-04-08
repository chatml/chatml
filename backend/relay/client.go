package relay

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"runtime/debug"
	"strings"
	"sync"
	"time"

	"github.com/chatml/chatml-backend/logger"
	"github.com/gorilla/websocket"
)

const (
	relayPingInterval     = 30 * time.Second
	relayPongWait         = 60 * time.Second
	relayWriteWait        = 10 * time.Second
	relaySendBuffer       = 256
	relayMaxMessageSize   = 10 * 1024 * 1024 // 10MB — generous limit for proxied responses
	maxConcurrentDispatch = 50               // max concurrent HTTP dispatches from mobile

	// Reconnection parameters
	reconnectMaxAttempts = 5
	reconnectBaseDelay   = 1 * time.Second
	reconnectMaxDelay    = 30 * time.Second
	reconnectHTTPTimeout = 10 * time.Second
	closeCodeRestart     = 4000 // server restarting — reconnect is warranted
)

// HubRegistrar abstracts the WebSocket hub's programmatic client registration.
// This avoids an import cycle between relay and server packages.
type HubRegistrar interface {
	RegisterProgrammaticClient() HubClient
	UnregisterProgrammaticClient(client HubClient)
}

// HubClient abstracts a registered hub client's send channel.
type HubClient interface {
	SendChan() <-chan []byte
}

// outMessage is a message queued for the single writer goroutine.
type outMessage struct {
	msgType int
	data    []byte
}

// Client manages the outbound WebSocket connection to the cloud relay,
// registers as a Hub client to receive broadcast events, and proxies
// JSON-RPC requests through the existing HTTP router.
type Client struct {
	hub       HubRegistrar
	router    http.Handler
	authToken string

	relayConn    *websocket.Conn
	hubClient    HubClient
	mu           sync.Mutex // protects connected, paired, relayConn, hubClient, done, wantClose
	sendCh       chan outMessage
	dispatchSema chan struct{} // semaphore limiting concurrent HTTP dispatches
	done         chan struct{}
	connected    bool
	paired       bool   // true once mobile has paired via relay
	wantClose    bool   // true when user explicitly calls Disconnect — suppresses reconnection
	relayURL     string // stored for reconnection (re-resolved on each attempt)
	pairingToken string // stored for reconnection (re-registered with relay)
}

// NewClient creates a relay client. Call Connect() to establish the connection.
func NewClient(hub HubRegistrar, router http.Handler, authToken string) *Client {
	return &Client{
		hub:       hub,
		router:    router,
		authToken: authToken,
	}
}

// Connect establishes a WebSocket connection to the relay server and starts
// message pumps. The token should be the pairing token registered with the relay.
// pinnedIPs, if non-nil, restricts the dial to pre-validated IP addresses to
// prevent DNS rebinding attacks between URL validation and connection.
func (c *Client) Connect(relayURL, token string, pinnedIPs []net.IP) error {
	c.mu.Lock()
	if c.connected {
		c.mu.Unlock()
		return nil
	}
	c.mu.Unlock()

	// Connect to relay as a "node", sending the token via header and query param.
	// The query param enables token-based consistent-hash routing at the LB.
	// Dial happens outside the lock to avoid blocking Disconnect/IsConnected.
	wsURL := relayURL + "/ws/node?token=" + url.QueryEscape(token)
	logger.Relay.Infof("Connecting to relay: %s", wsURL)

	header := http.Header{}
	header.Set("Authorization", "Bearer "+token)

	dialer := *websocket.DefaultDialer
	if len(pinnedIPs) > 0 {
		dialer.NetDialContext = func(ctx context.Context, network, addr string) (net.Conn, error) {
			_, port, err := net.SplitHostPort(addr)
			if err != nil {
				return nil, fmt.Errorf("invalid address %q: %w", addr, err)
			}
			var lastErr error
			for _, ip := range pinnedIPs {
				pinnedAddr := net.JoinHostPort(ip.String(), port)
				conn, err := (&net.Dialer{Timeout: 5 * time.Second}).Dial(network, pinnedAddr)
				if err != nil {
					lastErr = err
					continue
				}
				return conn, nil
			}
			return nil, fmt.Errorf("all pinned IPs failed: %w", lastErr)
		}
	}

	conn, _, err := dialer.Dial(wsURL, header)
	if err != nil {
		return err
	}

	// Re-acquire lock and double-check: another goroutine may have connected
	// (or Disconnect may have been called) while we were dialing.
	c.mu.Lock()
	if c.connected {
		c.mu.Unlock()
		conn.Close()
		return nil
	}
	c.connected = true
	c.paired = false
	c.wantClose = false
	c.relayURL = relayURL
	c.pairingToken = token
	c.relayConn = conn
	c.done = make(chan struct{})
	c.sendCh = make(chan outMessage, relaySendBuffer)
	c.dispatchSema = make(chan struct{}, maxConcurrentDispatch)

	// Register as a programmatic Hub client to receive broadcast events
	c.hubClient = c.hub.RegisterProgrammaticClient()

	// Capture references under the lock for goroutines to use safely.
	// This avoids races with Disconnect() which nils these fields.
	conn = c.relayConn
	hc := c.hubClient
	c.mu.Unlock()

	logger.Relay.Info("Connected to relay, starting pumps")

	// Start goroutines — writePump owns all writes to relayConn.
	go c.writePump(conn)
	go c.readPump(conn)
	go c.eventPump(hc)

	return nil
}

// Disconnect cleanly shuts down the relay connection and suppresses reconnection.
func (c *Client) Disconnect() {
	c.mu.Lock()
	c.wantClose = true
	c.mu.Unlock()
	c.teardown()
}

// teardown tears down the current connection state without affecting wantClose.
// Called by Disconnect() (user-facing) and readPump defer (internal).
func (c *Client) teardown() {
	c.mu.Lock()
	if !c.connected {
		c.mu.Unlock()
		return
	}
	c.connected = false
	c.paired = false

	// Signal all goroutines to stop
	select {
	case <-c.done:
	default:
		close(c.done)
	}

	// Unregister from Hub
	if c.hubClient != nil {
		c.hub.UnregisterProgrammaticClient(c.hubClient)
		c.hubClient = nil
	}

	// Close relay connection — writePump will exit when it sees done.
	if c.relayConn != nil {
		c.relayConn.Close()
		c.relayConn = nil
	}
	c.mu.Unlock()

	logger.Relay.Info("Disconnected from relay")
}

// IsConnected returns whether the relay client is currently connected.
func (c *Client) IsConnected() bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.connected
}

// IsPaired returns whether a mobile device has paired via the relay.
func (c *Client) IsPaired() bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.paired
}

// readPump reads JSON-RPC requests from the relay WebSocket and dispatches
// them through the HTTP proxy. Responses are sent back through the relay.
// The conn parameter is captured at startup to avoid races with Disconnect().
func (c *Client) readPump(conn *websocket.Conn) {
	defer func() {
		// Clean up current connection without setting wantClose — teardown()
		// preserves wantClose so user's Disconnect() intent is never overridden.
		c.teardown()

		// Determine if reconnection is warranted after cleanup.
		c.mu.Lock()
		shouldReconnect := !c.wantClose && c.relayURL != ""
		c.mu.Unlock()

		if shouldReconnect {
			go c.reconnectWithBackoff()
		}
	}()

	conn.SetReadLimit(relayMaxMessageSize)
	conn.SetReadDeadline(time.Now().Add(relayPongWait))
	conn.SetPongHandler(func(string) error {
		conn.SetReadDeadline(time.Now().Add(relayPongWait))
		return nil
	})

	for {
		// Shutdown is driven by Disconnect() closing the connection, which
		// unblocks ReadMessage. No need for a select on c.done here.
		_, msg, err := conn.ReadMessage()
		if err != nil {
			if websocket.IsCloseError(err, closeCodeRestart) {
				logger.Relay.Info("Relay server restarting, will reconnect")
			} else if websocket.IsUnexpectedCloseError(err, websocket.CloseNormalClosure, websocket.CloseGoingAway) {
				logger.Relay.Errorf("Relay read error: %v", err)
			}
			return
		}

		// Try to parse as JSON-RPC request
		var req JSONRPCRequest
		if err := json.Unmarshal(msg, &req); err != nil {
			logger.Relay.Warnf("Invalid JSON-RPC message: %v", err)
			continue
		}

		// Handle notifications (no ID) — e.g., the "paired" notification from relay
		if req.ID == nil {
			if req.Method == "paired" {
				c.mu.Lock()
				c.paired = true
				c.mu.Unlock()
				logger.Relay.Info("Mobile device paired via relay")
			}
			continue
		}

		// Dispatch HTTP request and send response, bounded by semaphore.
		// A short timeout avoids rejecting requests that arrive milliseconds
		// before a slot frees up during burst traffic.
		timer := time.NewTimer(200 * time.Millisecond)
		select {
		case c.dispatchSema <- struct{}{}:
			timer.Stop()
			go func() {
				defer func() { <-c.dispatchSema }()
				resp := dispatchHTTPRequest(c.router, c.authToken, &req)
				data, err := json.Marshal(resp)
				if err != nil {
					logger.Relay.Errorf("Failed to marshal response: %v", err)
					return
				}
				c.enqueue(websocket.TextMessage, data)
			}()
		case <-timer.C:
			// At concurrency limit — reject request
			errResp := &JSONRPCResponse{
				JSONRPC: "2.0",
				ID:      req.ID,
				Error:   &JSONRPCError{Code: -32603, Message: "server busy, too many concurrent requests"},
			}
			data, _ := json.Marshal(errResp)
			c.enqueue(websocket.TextMessage, data)
		case <-c.done:
			timer.Stop()
			return
		}
	}
}

// eventPump drains the Hub client's send channel and forwards events
// as JSON-RPC notifications through the relay.
// The hc parameter is captured at startup to avoid races with Disconnect().
func (c *Client) eventPump(hc HubClient) {
	// Ensure unregistration on panic so the Hub broadcast loop isn't blocked.
	defer func() {
		if r := recover(); r != nil {
			logger.Relay.Errorf("eventPump panic: %v\n%s", r, debug.Stack())
			c.Disconnect()
		}
	}()

	sendCh := hc.SendChan()
	for {
		select {
		case msg, ok := <-sendCh:
			if !ok {
				return // Hub unregistered us
			}
			// Wrap Hub event as JSON-RPC notification
			notification := JSONRPCNotification{
				JSONRPC: "2.0",
				Method:  "event",
				Params:  json.RawMessage(msg),
			}
			data, err := json.Marshal(notification)
			if err != nil {
				logger.Relay.Errorf("Failed to marshal event notification: %v", err)
				continue
			}
			c.enqueue(websocket.TextMessage, data)

		case <-c.done:
			return
		}
	}
}

// writePump is the single goroutine that owns all writes to the relay
// WebSocket connection. This avoids concurrent write violations.
// The conn parameter is captured at startup to avoid races with Disconnect().
func (c *Client) writePump(conn *websocket.Conn) {
	ticker := time.NewTicker(relayPingInterval)
	defer func() {
		ticker.Stop()
		// Send close message best-effort
		conn.SetWriteDeadline(time.Now().Add(relayWriteWait))
		conn.WriteMessage(websocket.CloseMessage,
			websocket.FormatCloseMessage(websocket.CloseNormalClosure, ""))
	}()

	for {
		select {
		case msg, ok := <-c.sendCh:
			if !ok {
				return
			}
			conn.SetWriteDeadline(time.Now().Add(relayWriteWait))
			if err := conn.WriteMessage(msg.msgType, msg.data); err != nil {
				logger.Relay.Errorf("Relay write error: %v", err)
				return
			}

		case <-ticker.C:
			conn.SetWriteDeadline(time.Now().Add(relayWriteWait))
			if err := conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				logger.Relay.Errorf("Relay ping failed: %v", err)
				return
			}

		case <-c.done:
			return
		}
	}
}

// reconnectWithBackoff attempts to re-register the pairing token and reconnect
// to the relay with exponential backoff. DNS is re-resolved on each attempt
// (no IP pinning) so that DNS-based failover works after an instance restart.
func (c *Client) reconnectWithBackoff() {
	delay := reconnectBaseDelay
	for attempt := 1; attempt <= reconnectMaxAttempts; attempt++ {
		logger.Relay.Infof("Relay reconnect attempt %d/%d in %v", attempt, reconnectMaxAttempts, delay)
		time.Sleep(delay)

		// Check if user explicitly disconnected while we were sleeping
		c.mu.Lock()
		if c.wantClose {
			c.mu.Unlock()
			logger.Relay.Info("Reconnect cancelled: user disconnected")
			return
		}
		relayURL := c.relayURL
		token := c.pairingToken
		c.mu.Unlock()

		// Re-register the token — a previous instance may have lost it.
		// 409 Conflict means the token still exists, which is fine.
		if err := reregisterToken(relayURL, token); err != nil {
			if errors.Is(err, errRateLimited) {
				// Rate limited — jump to max delay to let the window expire.
				logger.Relay.Warnf("Reconnect: rate limited (attempt %d), backing off to %v", attempt, reconnectMaxDelay)
				delay = reconnectMaxDelay
			} else {
				logger.Relay.Warnf("Reconnect: re-registration failed (attempt %d): %v", attempt, err)
				delay = minDuration(delay*2, reconnectMaxDelay)
			}
			continue
		}

		// Re-connect without IP pinning — let DNS resolve to a healthy instance.
		if err := c.Connect(relayURL, token, nil); err != nil {
			logger.Relay.Warnf("Reconnect: connection failed (attempt %d): %v", attempt, err)
			delay = minDuration(delay*2, reconnectMaxDelay)
			continue
		}

		logger.Relay.Infof("Reconnected to relay after %d attempt(s)", attempt)
		return
	}

	logger.Relay.Errorf("Failed to reconnect to relay after %d attempts, giving up", reconnectMaxAttempts)
}

// errRateLimited is returned by reregisterToken when the relay returns 429.
var errRateLimited = fmt.Errorf("rate limited")

// reregisterToken sends POST /api/pair to re-register a pairing token with
// the relay server. Returns nil on success or 409 (token already registered).
// Returns errRateLimited on 429 so callers can use a longer backoff.
func reregisterToken(relayURL, token string) error {
	httpURL := wsToHTTP(relayURL) + "/api/pair"
	body, _ := json.Marshal(map[string]string{"token": token})

	req, err := http.NewRequest("POST", httpURL, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: reconnectHTTPTimeout}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("POST %s: %w", httpURL, err)
	}
	resp.Body.Close()

	switch {
	case resp.StatusCode == http.StatusOK || resp.StatusCode == http.StatusConflict:
		return nil // 200 = registered, 409 = already registered — both fine
	case resp.StatusCode == http.StatusTooManyRequests:
		return errRateLimited
	default:
		return fmt.Errorf("POST %s returned %d", httpURL, resp.StatusCode)
	}
}

// wsToHTTP converts a WebSocket URL to an HTTP URL.
func wsToHTTP(wsURL string) string {
	if strings.HasPrefix(wsURL, "wss://") {
		return "https://" + wsURL[6:]
	}
	if strings.HasPrefix(wsURL, "ws://") {
		return "http://" + wsURL[5:]
	}
	return wsURL
}

func minDuration(a, b time.Duration) time.Duration {
	if a < b {
		return a
	}
	return b
}

// enqueue sends a message to the write pump. Non-blocking: drops if buffer is full.
func (c *Client) enqueue(msgType int, data []byte) {
	select {
	case c.sendCh <- outMessage{msgType: msgType, data: data}:
	case <-c.done:
	default:
		logger.Relay.Warnf("Relay send buffer full, dropping message")
	}
}
