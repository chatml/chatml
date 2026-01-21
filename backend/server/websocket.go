package server

import (
	"encoding/json"
	"log"
	"net/http"
	"sync"

	"github.com/gorilla/websocket"
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
	ConversationID string      `json:"conversationId,omitempty"`
	Payload        interface{} `json:"payload,omitempty"`
}

type Hub struct {
	clients    map[*websocket.Conn]bool
	broadcast  chan Event
	register   chan *websocket.Conn
	unregister chan *websocket.Conn
	mu         sync.RWMutex
}

func NewHub() *Hub {
	return &Hub{
		clients:    make(map[*websocket.Conn]bool),
		broadcast:  make(chan Event, 256),
		register:   make(chan *websocket.Conn),
		unregister: make(chan *websocket.Conn),
	}
}

func (h *Hub) Run() {
	for {
		select {
		case client := <-h.register:
			h.mu.Lock()
			h.clients[client] = true
			h.mu.Unlock()
			log.Printf("Client connected, total: %d", len(h.clients))

		case client := <-h.unregister:
			h.mu.Lock()
			if _, ok := h.clients[client]; ok {
				delete(h.clients, client)
				client.Close()
			}
			h.mu.Unlock()
			log.Printf("Client disconnected, total: %d", len(h.clients))

		case event := <-h.broadcast:
			data, err := json.Marshal(event)
			if err != nil {
				log.Printf("Error marshaling event: %v", err)
				continue
			}

			// Collect failed clients to remove after iteration
			var failedClients []*websocket.Conn

			h.mu.RLock()
			for client := range h.clients {
				if err := client.WriteMessage(websocket.TextMessage, data); err != nil {
					log.Printf("Error sending to client: %v", err)
					failedClients = append(failedClients, client)
				}
			}
			h.mu.RUnlock()

			// Remove failed clients
			for _, client := range failedClients {
				h.unregister <- client
			}
		}
	}
}

func (h *Hub) Broadcast(event Event) {
	select {
	case h.broadcast <- event:
	default:
		log.Println("Broadcast channel full, dropping event")
	}
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

	h.register <- conn

	// Keep connection alive, handle client messages if needed
	go func() {
		defer func() {
			h.unregister <- conn
		}()
		for {
			_, _, err := conn.ReadMessage()
			if err != nil {
				break
			}
		}
	}()
}
