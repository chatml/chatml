package server

import (
	"crypto/subtle"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gorilla/websocket"
)

const (
	// Per-client send buffer size
	clientSendBufferSize = 256

	// Time allowed to write a message to the client
	writeWait = 10 * time.Second

	// Time allowed to read the next pong message from the client
	pongWait = 60 * time.Second

	// Send pings to client with this period (must be less than pongWait)
	pingPeriod = (pongWait * 9) / 10

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
	send      chan []byte // Buffered channel for outgoing messages
	closeOnce sync.Once   // Ensures send channel is closed only once
	evicting  atomic.Bool // Prevents multiple eviction goroutines
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
	clients    map[*Client]bool
	broadcast  chan []byte // Pre-serialized JSON bytes
	register   chan *Client
	unregister chan *Client
	mu         sync.RWMutex
	metrics    *HubMetrics
}

func NewHub() *Hub {
	return &Hub{
		clients:   make(map[*Client]bool),
		broadcast: make(chan []byte, 1024),
		register:  make(chan *Client),
		// Buffered to prevent eviction goroutines from blocking during
		// high-churn scenarios or if the Hub is slow to process unregisters
		unregister: make(chan *Client, 64),
		metrics:    &HubMetrics{},
	}
}

func (h *Hub) Run() {
	for {
		select {
		case client := <-h.register:
			h.mu.Lock()
			h.clients[client] = true
			count := len(h.clients)
			h.metrics.recordClientConnect(count)
			h.mu.Unlock()
			log.Printf("Client connected, total: %d", count)

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
			log.Printf("Client disconnected, total: %d", count)

		case message := <-h.broadcast:
			h.mu.RLock()
			for client := range h.clients {
				select {
				case client.send <- message:
					// Message queued successfully
				default:
					// Client buffer full - they can't keep up, schedule for removal
					// Use CompareAndSwap to ensure only one eviction goroutine is spawned
					if client.evicting.CompareAndSwap(false, true) {
						h.metrics.recordClientDropped()
						log.Printf("Client send buffer full, evicting slow client")
						go func(c *Client) {
							h.unregister <- c
						}(client)
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
		log.Printf("Error marshaling event: %v", err)
		return BroadcastResult{Delivered: false}
	}

	// Check buffer utilization for backpressure signal
	bufferUsage := len(h.broadcast)
	bufferCapacity := cap(h.broadcast)

	if bufferUsage > (bufferCapacity * 3 / 4) {
		result.Backpressure = true
		h.metrics.recordBackpressure()
		log.Printf("Broadcast channel high utilization: %d/%d", bufferUsage, bufferCapacity)
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
		log.Printf("WARN: Broadcast channel full after %v timeout, event dropped: type=%s", broadcastTimeout, event.Type)
	}

	return result
}

// BroadcastJSON sends any JSON-serializable data to all clients
// Used for orchestrator events and other generic messages
func (h *Hub) BroadcastJSON(data interface{}) {
	// Wrap the data in an Event structure for consistency
	h.Broadcast(Event{
		Type:    "orchestrator",
		Payload: data,
	})
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
		log.Printf("WebSocket upgrade error: %v", err)
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
		ticker.Stop()
		// Close connection to unblock readPump's ReadMessage call.
		// This ensures readPump exits promptly when writePump fails,
		// rather than waiting for the pongWait timeout.
		c.conn.Close()
	}()

	for {
		select {
		case message, ok := <-c.send:
			c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if !ok {
				// Hub closed the channel - client was unregistered
				if err := c.conn.WriteMessage(websocket.CloseMessage, []byte{}); err != nil {
					log.Printf("Error sending close message: %v", err)
				}
				return
			}

			if err := c.conn.WriteMessage(websocket.TextMessage, message); err != nil {
				log.Printf("Error writing message to client: %v", err)
				return
			}
			c.hub.metrics.recordDelivered()

		case <-ticker.C:
			c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				log.Printf("Error sending ping to client: %v", err)
				return
			}
		}
	}
}

// readPump pumps messages from the websocket connection to the hub.
// Handles pong responses and detects client disconnection.
func (c *Client) readPump() {
	defer func() {
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
				log.Printf("Error reading from client: %v", err)
			}
			break
		}
	}
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
