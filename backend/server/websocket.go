package server

import (
	"crypto/subtle"
	"encoding/json"
	"net/http"
	"os"
	"runtime/debug"
	"sync"
	"sync/atomic"
	"time"

	"github.com/chatml/chatml-backend/logger"
	"github.com/gorilla/websocket"
)

const (
	// Per-client send buffer size. Set high because this is a local desktop app
	// where memory is cheap and the browser may briefly lag during fast streaming.
	clientSendBufferSize = 2048

	// clientSendTimeout is how long to wait for space in a client's send buffer
	// before evicting. Gives the browser time to catch up during fast streaming.
	clientSendTimeout = 100 * time.Millisecond

	// Time allowed to write a message to the client
	writeWait = 10 * time.Second

	// Time allowed to read the next pong message from the client
	pongWait = 60 * time.Second

	// Send pings to client with this period (must be less than pongWait)
	pingPeriod = (pongWait * 9) / 10

	// evictionWarningDeadline is the write deadline for the best-effort
	// warning message sent to a client just before eviction.
	evictionWarningDeadline = 500 * time.Millisecond

	// broadcastTimeout is how long to wait for buffer space before dropping
	// a broadcast message. This gives Hub.Run() time to catch up.
	broadcastTimeout = 2 * time.Second
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		origin := r.Header.Get("Origin")
		return AllowedOriginsMap[origin]
	},
}

type Event struct {
	Type           string      `json:"type"`
	AgentID        string      `json:"agentId,omitempty"`
	SessionID      string      `json:"sessionId,omitempty"`
	ConversationID string      `json:"conversationId,omitempty"`
	Payload        interface{} `json:"payload,omitempty"`
}

// Client represents a connected WebSocket client with its own send buffer
type Client struct {
	hub       *Hub
	conn      *websocket.Conn
	send      chan []byte  // Buffered channel for outgoing messages
	closeOnce sync.Once   // Ensures send channel is closed only once
	evicting  atomic.Bool // Prevents multiple eviction goroutines
	writeMu   sync.Mutex  // Protects concurrent writes to conn
}

// HubMetrics tracks WebSocket hub statistics
type HubMetrics struct {
	messagesDelivered     atomic.Uint64
	messagesDropped       atomic.Uint64
	messagesTimedOut      atomic.Uint64 // Messages dropped after timeout waiting for buffer space
	clientsDropped        atomic.Uint64 // Clients disconnected due to slow consumption
	broadcastBackpressure atomic.Uint64 // Times broadcast channel was near full
	peakClients           atomic.Int64
	currentClients        atomic.Int64
}

func (m *HubMetrics) recordDelivered() {
	m.messagesDelivered.Add(1)
}

func (m *HubMetrics) recordDropped() {
	m.messagesDropped.Add(1)
}

func (m *HubMetrics) recordTimedOut() {
	m.messagesTimedOut.Add(1)
}

func (m *HubMetrics) recordClientDropped() {
	m.clientsDropped.Add(1)
}

func (m *HubMetrics) recordBackpressure() {
	m.broadcastBackpressure.Add(1)
}

func (m *HubMetrics) recordClientConnect(count int) {
	m.currentClients.Store(int64(count))
	for {
		peak := m.peakClients.Load()
		if int64(count) <= peak {
			break
		}
		if m.peakClients.CompareAndSwap(peak, int64(count)) {
			break
		}
	}
}

func (m *HubMetrics) recordClientDisconnect(count int) {
	m.currentClients.Store(int64(count))
}

type Hub struct {
	clients         map[*Client]bool
	broadcast       chan []byte // Pre-serialized JSON bytes
	register        chan *Client
	unregister      chan *Client
	mu              sync.RWMutex
	metrics         *HubMetrics
	lastWarningTime atomic.Int64 // Rate-limit warning emissions (unix millis)
}

func NewHub() *Hub {
	return &Hub{
		clients:   make(map[*Client]bool),
		broadcast: make(chan []byte, 4096),
		register:  make(chan *Client),
		// Buffered to prevent eviction goroutines from blocking during
		// high-churn scenarios or if the Hub is slow to process unregisters
		unregister: make(chan *Client, 64),
		metrics:    &HubMetrics{},
	}
}

func (h *Hub) Run() {
	for {
		h.runLoop()
	}
}

// runLoop is the inner event loop, separated to allow panic recovery
func (h *Hub) runLoop() {
	defer func() {
		if r := recover(); r != nil {
			logger.WebSocket.Errorf("Hub PANIC recovered: %v\n%s", r, debug.Stack())
			// Log but continue - the outer loop will restart runLoop
		}
	}()

	for {
		select {
		case client := <-h.register:
			h.mu.Lock()
			h.clients[client] = true
			count := len(h.clients)
			h.metrics.recordClientConnect(count)
			h.mu.Unlock()
			logger.WebSocket.Infof("Client connected, total: %d", count)

		case client := <-h.unregister:
			h.mu.Lock()
			if _, ok := h.clients[client]; ok {
				delete(h.clients, client)
				// Use closeOnce to safely close the channel exactly once,
				// even if multiple unregister attempts occur
				client.closeOnce.Do(func() {
					close(client.send)
				})
			}
			count := len(h.clients)
			h.metrics.recordClientDisconnect(count)
			h.mu.Unlock()
			logger.WebSocket.Infof("Client disconnected, total: %d", count)

		case message := <-h.broadcast:
			h.mu.RLock()
			for client := range h.clients {
				select {
				case client.send <- message:
					// Message queued successfully (fast path)
				default:
					// Buffer full - spawn goroutine for timed retry instead of instant eviction.
					// CAS ensures only one retry goroutine runs per client at a time.
					if client.evicting.CompareAndSwap(false, true) {
						go func(c *Client, msg []byte) {
							defer func() {
								if r := recover(); r != nil {
									logger.WebSocket.Errorf("Hub PANIC in eviction goroutine: %v", r)
								}
							}()

							select {
							case c.send <- msg:
								// Client caught up - reset flag, continue normally
								c.evicting.Store(false)
							case <-time.After(clientSendTimeout):
								// Still full after timeout - evict
								h.metrics.recordClientDropped()
								logger.WebSocket.Warnf("Client send buffer full after %v, evicting", clientSendTimeout)
								c.sendEvictionWarning()
								h.unregister <- c
							}
						}(client, message)
					} else {
					// Another retry goroutine is already handling this client.
					// Drop this message and record the metric.
					h.metrics.recordDropped()
				}
				}
			}
			h.mu.RUnlock()
		}
	}
}

// BroadcastResult indicates the outcome of a broadcast attempt
type BroadcastResult struct {
	Delivered    bool
	Backpressure bool // True if buffer is getting full (>75% capacity)
}

func (h *Hub) Broadcast(event Event) BroadcastResult {
	result := BroadcastResult{Delivered: true}

	data, err := json.Marshal(event)
	if err != nil {
		logger.WebSocket.Errorf("Error marshaling event: %v", err)
		return BroadcastResult{Delivered: false}
	}

	// Check buffer utilization for backpressure signal
	bufferUsage := len(h.broadcast)
	bufferCapacity := cap(h.broadcast)

	if bufferUsage > (bufferCapacity * 3 / 4) {
		result.Backpressure = true
		h.metrics.recordBackpressure()
		logger.WebSocket.Warnf("Broadcast channel high utilization: %d/%d", bufferUsage, bufferCapacity)
	}

	// Try to send with timeout to allow Hub.Run() to catch up
	// This handles transient slowdowns gracefully instead of dropping immediately
	select {
	case h.broadcast <- data:
		// Successfully queued
	case <-time.After(broadcastTimeout):
		// Channel still full after timeout - reader is persistently slow
		result.Delivered = false
		h.metrics.recordTimedOut()
		logger.WebSocket.Warnf("Broadcast channel full after %v timeout, event dropped: type=%s", broadcastTimeout, event.Type)

		// Emit rate-limited warning to frontend (max one per 5 seconds).
		// This is best-effort: the warning is sent to the same channel that just
		// timed out, so it will likely fail (hit the default case) unless the
		// channel drains between the timeout and this send. This is intentional -
		// we don't want warning delivery to block or delay further processing.
		// The frontend also debounces warnings (10s) as a second layer of protection.
		now := time.Now().UnixMilli()
		lastWarning := h.lastWarningTime.Load()
		if now-lastWarning > 5000 && h.lastWarningTime.CompareAndSwap(lastWarning, now) {
			warningEvent := Event{
				Type: "streaming_warning",
				Payload: map[string]interface{}{
					"source":  "hub",
					"reason":  "broadcast_timeout",
					"message": "Some streaming events were dropped due to network congestion",
				},
			}
			if warningData, err := json.Marshal(warningEvent); err == nil {
				select {
				case h.broadcast <- warningData:
					// Warning sent (channel had space)
				default:
					// Channel still full - warning not sent, which is acceptable
				}
			}
		}
	}

	return result
}

func (h *Hub) HandleWebSocket(w http.ResponseWriter, r *http.Request) {
	// Validate token from query parameter.
	// Note: WebSocket connections cannot use custom HTTP headers, so we pass the token
	// as a query parameter. This is a known trade-off - the token may appear in server
	// access logs. In production, ensure logging does not capture query parameters,
	// or configure log scrubbing for sensitive data.
	expectedToken := os.Getenv("CHATML_AUTH_TOKEN")
	if expectedToken != "" {
		token := r.URL.Query().Get("token")
		if subtle.ConstantTimeCompare([]byte(token), []byte(expectedToken)) != 1 {
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}
	}

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		logger.WebSocket.Errorf("WebSocket upgrade error: %v", err)
		return
	}

	client := &Client{
		hub:  h,
		conn: conn,
		send: make(chan []byte, clientSendBufferSize),
	}

	h.register <- client

	// Start write pump in separate goroutine
	go client.writePump()

	// Start read pump (handles pongs and detects disconnects)
	go client.readPump()
}

// writePump pumps messages from the hub to the websocket connection.
// A goroutine running writePump is started for each connection.
func (c *Client) writePump() {
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		if r := recover(); r != nil {
			logger.WebSocket.Errorf("Client PANIC in writePump: %v\n%s", r, debug.Stack())
		}
		ticker.Stop()
		// Close connection to unblock readPump's ReadMessage call.
		// This ensures readPump exits promptly when writePump fails,
		// rather than waiting for the pongWait timeout.
		c.conn.Close()
	}()

	for {
		select {
		case message, ok := <-c.send:
			if !c.handleSendMessage(message, ok) {
				return
			}
		case <-ticker.C:
			if !c.handlePing() {
				return
			}
		}
	}
}

// handleSendMessage writes a queued message to the WebSocket connection.
// Returns false if the pump should exit (channel closed or write error).
func (c *Client) handleSendMessage(message []byte, ok bool) bool {
	c.writeMu.Lock()
	defer c.writeMu.Unlock()

	c.conn.SetWriteDeadline(time.Now().Add(writeWait))
	if !ok {
		// Hub closed the channel - client was unregistered
		if err := c.conn.WriteMessage(websocket.CloseMessage, []byte{}); err != nil {
			logger.WebSocket.Errorf("Error sending close message: %v", err)
		}
		return false
	}

	if err := c.conn.WriteMessage(websocket.TextMessage, message); err != nil {
		logger.WebSocket.Errorf("Error writing message to client: %v", err)
		return false
	}
	c.hub.metrics.recordDelivered()
	return true
}

// handlePing sends a WebSocket ping to the client.
// Returns false if the pump should exit (write error).
func (c *Client) handlePing() bool {
	c.writeMu.Lock()
	defer c.writeMu.Unlock()

	c.conn.SetWriteDeadline(time.Now().Add(writeWait))
	if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
		logger.WebSocket.Errorf("Error sending ping to client: %v", err)
		return false
	}
	return true
}

// readPump pumps messages from the websocket connection to the hub.
// Handles pong responses and detects client disconnection.
func (c *Client) readPump() {
	defer func() {
		if r := recover(); r != nil {
			logger.WebSocket.Errorf("Client PANIC in readPump: %v\n%s", r, debug.Stack())
		}
		c.hub.unregister <- c
		c.conn.Close()
	}()

	c.conn.SetReadDeadline(time.Now().Add(pongWait))
	c.conn.SetPongHandler(func(string) error {
		c.conn.SetReadDeadline(time.Now().Add(pongWait))
		return nil
	})

	for {
		_, _, err := c.conn.ReadMessage()
		if err != nil {
			// Log unexpected errors for debugging, but not normal disconnections
			if !websocket.IsCloseError(err, websocket.CloseNormalClosure, websocket.CloseGoingAway) &&
				!websocket.IsUnexpectedCloseError(err, websocket.CloseNormalClosure, websocket.CloseGoingAway) {
				logger.WebSocket.Errorf("Error reading from client: %v", err)
			}
			break
		}
	}
}

// sendEvictionWarning attempts to send a warning event to the client before
// eviction. Writes directly to the connection (bypassing the full send channel)
// with a short deadline. Best-effort; errors are ignored.
func (c *Client) sendEvictionWarning() {
	if c.conn == nil {
		return
	}
	warningEvent := Event{
		Type: "streaming_warning",
		Payload: map[string]interface{}{
			"source":  "hub",
			"reason":  "client_eviction",
			"message": "Connection closed due to slow message processing. Reconnecting...",
		},
	}
	data, err := json.Marshal(warningEvent)
	if err != nil {
		return
	}
	c.writeMu.Lock()
	defer c.writeMu.Unlock()
	c.conn.SetWriteDeadline(time.Now().Add(evictionWarningDeadline))
	c.conn.WriteMessage(websocket.TextMessage, data)
}

// GetStats returns current hub statistics
func (h *Hub) GetStats() map[string]interface{} {
	return map[string]interface{}{
		"messagesDelivered":       h.metrics.messagesDelivered.Load(),
		"messagesDropped":         h.metrics.messagesDropped.Load(),
		"messagesTimedOut":        h.metrics.messagesTimedOut.Load(),
		"clientsDropped":          h.metrics.clientsDropped.Load(),
		"backpressureEvents":      h.metrics.broadcastBackpressure.Load(),
		"currentClients":          h.metrics.currentClients.Load(),
		"peakClients":             h.metrics.peakClients.Load(),
		"broadcastBufferUsage":    len(h.broadcast),
		"broadcastBufferCapacity": cap(h.broadcast),
	}
}
