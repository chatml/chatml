package server

import (
	"encoding/json"
	"log"
	"net/http"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gorilla/websocket"
)

const (
	// Per-client buffer size
	clientBufferSize = 64

	// Write deadline for slow client detection
	writeWait = 10 * time.Second
)

// Client represents a connected WebSocket client with its own send buffer
type Client struct {
	conn *websocket.Conn
	send chan []byte // Per-client send buffer
	hub  *Hub
}

// HubMetrics tracks WebSocket hub statistics
type HubMetrics struct {
	messagesDelivered     atomic.Uint64
	messagesDropped       atomic.Uint64
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

type Hub struct {
	clients    map[*Client]bool
	broadcast  chan Event
	register   chan *Client
	unregister chan *Client
	mu         sync.RWMutex
	metrics    *HubMetrics
}

func NewHub() *Hub {
	return &Hub{
		clients:    make(map[*Client]bool),
		broadcast:  make(chan Event, 256),
		register:   make(chan *Client),
		unregister: make(chan *Client, 64), // Buffered to avoid blocking broadcast loop
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
				close(client.send) // Signal writePump to exit
			}
			count := len(h.clients)
			h.metrics.recordClientDisconnect(count)
			h.mu.Unlock()
			log.Printf("Client disconnected, total: %d", count)

		case event := <-h.broadcast:
			data, err := json.Marshal(event)
			if err != nil {
				log.Printf("Error marshaling event: %v", err)
				continue
			}

			// Collect slow clients to unregister after releasing lock
			var slowClients []*Client

			h.mu.RLock()
			for client := range h.clients {
				select {
				case client.send <- data:
					// Delivered to client buffer
				default:
					// Client buffer full - mark for disconnection
					slowClients = append(slowClients, client)
				}
			}
			h.mu.RUnlock()

			// Unregister slow clients outside of lock
			for _, client := range slowClients {
				h.metrics.recordClientDropped()
				log.Printf("Client buffer full, disconnecting slow client")
				h.unregister <- client
			}
		}
	}
}

// writePump pumps messages from the hub to the websocket connection
func (c *Client) writePump() {
	defer func() {
		c.conn.Close()
	}()

	for message := range c.send {
		c.conn.SetWriteDeadline(time.Now().Add(writeWait))
		if err := c.conn.WriteMessage(websocket.TextMessage, message); err != nil {
			log.Printf("Error writing to client: %v", err)
			return
		}
		c.hub.metrics.recordDelivered()

		// Drain any queued messages to batch writes
		n := len(c.send)
		for i := 0; i < n; i++ {
			msg, ok := <-c.send
			if !ok {
				return
			}
			c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.conn.WriteMessage(websocket.TextMessage, msg); err != nil {
				log.Printf("Error writing batched message: %v", err)
				return
			}
			c.hub.metrics.recordDelivered()
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

	// Check buffer utilization for backpressure signal
	bufferUsage := len(h.broadcast)
	bufferCapacity := cap(h.broadcast)

	if bufferUsage > (bufferCapacity * 3 / 4) {
		result.Backpressure = true
		h.metrics.recordBackpressure()
		log.Printf("Broadcast channel high utilization: %d/%d", bufferUsage, bufferCapacity)
	}

	select {
	case h.broadcast <- event:
		// Successfully queued
	default:
		// Channel full - this should now be rare with per-client buffers
		result.Delivered = false
		h.metrics.recordDropped()
		log.Printf("WARN: Broadcast channel full, event dropped: type=%s", event.Type)
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
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("WebSocket upgrade error: %v", err)
		return
	}

	client := &Client{
		conn: conn,
		send: make(chan []byte, clientBufferSize),
		hub:  h,
	}

	h.register <- client

	// Start write pump in separate goroutine
	go client.writePump()

	// Read pump (keep connection alive, handle client messages)
	go func() {
		defer func() {
			h.unregister <- client
		}()
		for {
			_, _, err := conn.ReadMessage()
			if err != nil {
				break
			}
		}
	}()
}

// GetStats returns current hub statistics
func (h *Hub) GetStats() map[string]interface{} {
	return map[string]interface{}{
		"messagesDelivered":       h.metrics.messagesDelivered.Load(),
		"messagesDropped":         h.metrics.messagesDropped.Load(),
		"clientsDropped":          h.metrics.clientsDropped.Load(),
		"backpressureEvents":      h.metrics.broadcastBackpressure.Load(),
		"currentClients":          h.metrics.currentClients.Load(),
		"peakClients":             h.metrics.peakClients.Load(),
		"broadcastBufferUsage":    len(h.broadcast),
		"broadcastBufferCapacity": cap(h.broadcast),
	}
}
