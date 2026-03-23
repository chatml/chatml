package relay

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"runtime/debug"
	"sync"
	"time"

	"github.com/chatml/chatml-backend/logger"
	"github.com/gorilla/websocket"
)

const (
	relayPingInterval = 30 * time.Second
	relayPongWait     = 60 * time.Second
	relayWriteWait    = 10 * time.Second
	relaySendBuffer   = 256
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

	relayConn *websocket.Conn
	hubClient HubClient
	mu        sync.Mutex // protects connected, relayConn, hubClient, done
	sendCh    chan outMessage
	done      chan struct{}
	connected bool
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

	// Connect to relay as a "node", sending the token via header.
	// Dial happens outside the lock to avoid blocking Disconnect/IsConnected.
	wsURL := relayURL + "/ws/node"
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
	c.relayConn = conn
	c.done = make(chan struct{})
	c.sendCh = make(chan outMessage, relaySendBuffer)

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

// Disconnect cleanly shuts down the relay connection.
func (c *Client) Disconnect() {
	c.mu.Lock()
	if !c.connected {
		c.mu.Unlock()
		return
	}
	c.connected = false

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

// readPump reads JSON-RPC requests from the relay WebSocket and dispatches
// them through the HTTP proxy. Responses are sent back through the relay.
// The conn parameter is captured at startup to avoid races with Disconnect().
func (c *Client) readPump(conn *websocket.Conn) {
	defer c.Disconnect()

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
			if websocket.IsUnexpectedCloseError(err, websocket.CloseNormalClosure, websocket.CloseGoingAway) {
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

		// Skip notifications (no ID) — e.g., the "paired" notification from relay
		if req.ID == nil {
			continue
		}

		// Dispatch HTTP request and send response
		go func() {
			resp := dispatchHTTPRequest(c.router, c.authToken, &req)
			data, err := json.Marshal(resp)
			if err != nil {
				logger.Relay.Errorf("Failed to marshal response: %v", err)
				return
			}
			c.enqueue(websocket.TextMessage, data)
		}()
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

// enqueue sends a message to the write pump. Non-blocking: drops if buffer is full.
func (c *Client) enqueue(msgType int, data []byte) {
	select {
	case c.sendCh <- outMessage{msgType: msgType, data: data}:
	case <-c.done:
	default:
		logger.Relay.Warnf("Relay send buffer full, dropping message")
	}
}
