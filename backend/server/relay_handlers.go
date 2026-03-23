package server

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/chatml/chatml-backend/logger"
	"github.com/chatml/chatml-backend/relay"
)

// hubAdapter wraps *Hub to satisfy relay.HubRegistrar, bridging the
// concrete server types to the relay package's interfaces.
type hubAdapter struct {
	hub *Hub
}

func (a *hubAdapter) RegisterProgrammaticClient() relay.HubClient {
	return a.hub.RegisterProgrammaticClient()
}

func (a *hubAdapter) UnregisterProgrammaticClient(c relay.HubClient) {
	if client, ok := c.(*Client); ok {
		a.hub.UnregisterProgrammaticClient(client)
	}
}

// RelayHandlers manages the relay client lifecycle and exposes HTTP endpoints
// for the desktop frontend to initiate/cancel pairing and check status.
type RelayHandlers struct {
	hubAdapt    *hubAdapter
	router      http.Handler // Set after NewRouter returns via SetRouter()
	authToken   string
	client      *relay.Client
	mu          sync.RWMutex
	pairingData *PairingData
}

// PairingData holds the current pairing state.
type PairingData struct {
	Token    string `json:"token"`
	RelayURL string `json:"relayUrl"`
	QRData   string `json:"qrData"`
}

// NewRelayHandlers creates relay endpoint handlers.
// Call SetRouter() after NewRouter returns to set the HTTP router reference.
func NewRelayHandlers(hub *Hub, authToken string) *RelayHandlers {
	return &RelayHandlers{
		hubAdapt:  &hubAdapter{hub: hub},
		authToken: authToken,
	}
}

// SetRouter sets the HTTP handler used by the relay client's HTTP-over-WebSocket
// proxy. Must be called after NewRouter returns since the router includes the
// relay's own routes.
func (rh *RelayHandlers) SetRouter(router http.Handler) {
	rh.mu.Lock()
	rh.router = router
	rh.mu.Unlock()
}

// StartPairing generates a pairing token, registers it with the relay server,
// connects to the relay, and returns the QR code data.
// POST /api/relay/pair/start
// Request body: {"relayUrl": "ws://localhost:8787"} (or wss://relay.chatml.com)
func (rh *RelayHandlers) StartPairing(w http.ResponseWriter, r *http.Request) {
	rh.mu.RLock()
	router := rh.router
	rh.mu.RUnlock()
	if router == nil {
		http.Error(w, `{"error":"relay not ready, try again shortly"}`, http.StatusServiceUnavailable)
		return
	}

	var req struct {
		RelayURL string `json:"relayUrl"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.RelayURL == "" {
		http.Error(w, `{"error":"relayUrl is required"}`, http.StatusBadRequest)
		return
	}

	// Validate the relay URL to prevent SSRF
	resolvedIPs, err := validateRelayURL(req.RelayURL)
	if err != nil {
		errResp, _ := json.Marshal(map[string]string{"error": err.Error()})
		http.Error(w, string(errResp), http.StatusBadRequest)
		return
	}

	// Disconnect existing connection under a short lock, then release
	// before doing network I/O to avoid blocking GetStatus/CancelPairing.
	rh.mu.Lock()
	if rh.client != nil {
		rh.client.Disconnect()
		rh.client = nil
		rh.pairingData = nil
	}
	rh.mu.Unlock()

	// Generate pairing token (crypto/rand, no lock needed)
	token, err := relay.GeneratePairingToken()
	if err != nil {
		logger.Relay.Errorf("Failed to generate pairing token: %v", err)
		http.Error(w, `{"error":"failed to generate token"}`, http.StatusInternalServerError)
		return
	}

	// Register token with relay server using IP-pinned transport to prevent
	// DNS rebinding attacks (the hostname was already validated + resolved).
	registerURL := httpToHTTP(req.RelayURL) + "/api/pair"
	body, _ := json.Marshal(map[string]string{"token": token})

	httpClient := &http.Client{Timeout: 10 * time.Second}
	if len(resolvedIPs) > 0 {
		httpClient.Transport = newPinnedTransport(resolvedIPs)
	}
	httpReq, err := http.NewRequest("POST", registerURL, bytes.NewReader(body))
	if err != nil {
		logger.Relay.Errorf("Failed to build registration request: %v", err)
		http.Error(w, `{"error":"failed to contact relay server"}`, http.StatusBadGateway)
		return
	}
	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := httpClient.Do(httpReq)
	if err != nil {
		logger.Relay.Errorf("Failed to register token with relay: %v", err)
		http.Error(w, `{"error":"failed to contact relay server"}`, http.StatusBadGateway)
		return
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		http.Error(w, `{"error":"relay rejected token"}`, http.StatusBadGateway)
		return
	}

	// Create relay client and connect (Connect does its own double-check locking)
	client := relay.NewClient(rh.hubAdapt, router, rh.authToken)
	if err := client.Connect(req.RelayURL, token, resolvedIPs); err != nil {
		logger.Relay.Errorf("Failed to connect to relay: %v", err)
		http.Error(w, `{"error":"failed to connect to relay"}`, http.StatusBadGateway)
		return
	}

	// Store the new client under a short lock
	rh.mu.Lock()
	rh.client = client
	rh.pairingData = &PairingData{
		Token:    token,
		RelayURL: req.RelayURL,
		QRData:   relay.BuildQRCodeData(token, req.RelayURL),
	}
	qrData := rh.pairingData.QRData
	rh.mu.Unlock()

	logger.Relay.Infof("Pairing started, waiting for mobile: token=%s...%s", token[:4], token[len(token)-4:])

	writeJSON(w, map[string]interface{}{
		"token":  token,
		"qrData": qrData,
	})
}

// CancelPairing disconnects from the relay and cancels any pending pairing.
// POST /api/relay/pair/cancel
func (rh *RelayHandlers) CancelPairing(w http.ResponseWriter, _ *http.Request) {
	rh.mu.Lock()
	defer rh.mu.Unlock()

	if rh.client != nil {
		rh.client.Disconnect()
		rh.client = nil
		rh.pairingData = nil
		logger.Relay.Info("Pairing cancelled")
	}

	writeJSON(w, map[string]bool{"ok": true})
}

// GetStatus returns the current relay connection status.
// GET /api/relay/status
func (rh *RelayHandlers) GetStatus(w http.ResponseWriter, _ *http.Request) {
	rh.mu.RLock()
	defer rh.mu.RUnlock()

	status := map[string]interface{}{
		"connected": false,
	}

	if rh.client != nil && rh.client.IsConnected() {
		status["connected"] = true
		if rh.pairingData != nil {
			status["relayUrl"] = rh.pairingData.RelayURL
			status["qrData"] = rh.pairingData.QRData
		}
	}

	writeJSON(w, status)
}

// Disconnect disconnects from the relay.
// POST /api/relay/disconnect
func (rh *RelayHandlers) Disconnect(w http.ResponseWriter, _ *http.Request) {
	rh.mu.Lock()
	defer rh.mu.Unlock()

	if rh.client != nil {
		rh.client.Disconnect()
		rh.client = nil
		rh.pairingData = nil
		logger.Relay.Info("Relay disconnected")
	}

	writeJSON(w, map[string]bool{"ok": true})
}

// validateRelayURL checks that the relay URL is safe to connect to and returns
// the resolved IP addresses (for IP-pinning in subsequent requests).
// In development mode (CHATML_DEV=1), localhost/private IPs are allowed.
// In production, only wss:// with non-private hosts are permitted.
func validateRelayURL(rawURL string) ([]net.IP, error) {
	// Must start with ws:// or wss://
	if !strings.HasPrefix(rawURL, "ws://") && !strings.HasPrefix(rawURL, "wss://") {
		return nil, &relayURLError{"relay URL must use ws:// or wss:// scheme"}
	}

	// Parse the URL (convert to http:// for url.Parse compatibility)
	httpURL := httpToHTTP(rawURL)
	parsed, err := url.Parse(httpURL)
	if err != nil {
		return nil, &relayURLError{"invalid relay URL"}
	}

	host := parsed.Hostname()
	if host == "" {
		return nil, &relayURLError{"relay URL must include a hostname"}
	}

	// In dev mode, allow localhost and private IPs (skip IP resolution)
	isDev := os.Getenv("CHATML_DEV") == "1"
	if isDev {
		return nil, nil
	}

	// Production: require wss://
	if !strings.HasPrefix(rawURL, "wss://") {
		return nil, &relayURLError{"relay URL must use wss:// in production"}
	}

	// Resolve and validate IPs — reject private/loopback addresses.
	// Returns the resolved IPs so callers can pin subsequent connections
	// to the same addresses (preventing DNS rebinding attacks).
	resolvedIPs, err := resolveAndValidateHost(host)
	if err != nil {
		return nil, err
	}

	return resolvedIPs, nil
}

// resolveAndValidateHost resolves a hostname and validates that none of the
// resolved addresses are private, loopback, or link-local. Returns the
// validated IP list for connection pinning. Fails closed on DNS errors.
func resolveAndValidateHost(host string) ([]net.IP, error) {
	// Check common private hostnames first
	lower := strings.ToLower(host)
	if lower == "localhost" || lower == "127.0.0.1" || lower == "::1" || lower == "0.0.0.0" {
		return nil, &relayURLError{"relay URL must not point to private/loopback addresses"}
	}

	// If host is already an IP literal, validate directly
	if ip := net.ParseIP(host); ip != nil {
		if ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() {
			return nil, &relayURLError{"relay URL must not point to private/loopback addresses"}
		}
		return []net.IP{ip}, nil
	}

	// Resolve hostname — fail closed if DNS resolution fails
	ipStrs, err := net.LookupHost(host)
	if err != nil {
		return nil, &relayURLError{"relay URL hostname could not be resolved"}
	}

	var resolved []net.IP
	for _, ipStr := range ipStrs {
		ip := net.ParseIP(ipStr)
		if ip == nil {
			continue
		}
		if ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() {
			return nil, &relayURLError{"relay URL must not point to private/loopback addresses"}
		}
		resolved = append(resolved, ip)
	}

	if len(resolved) == 0 {
		return nil, &relayURLError{"relay URL hostname resolved to no usable addresses"}
	}

	return resolved, nil
}

// newPinnedTransport creates an http.Transport that dials only to the provided
// pre-validated IP addresses, preventing DNS rebinding between validation and use.
func newPinnedTransport(pinnedIPs []net.IP) *http.Transport {
	return &http.Transport{
		DialContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
			_, port, err := net.SplitHostPort(addr)
			if err != nil {
				return nil, fmt.Errorf("invalid address %q: %w", addr, err)
			}
			// Try each pre-resolved IP
			var lastErr error
			for _, ip := range pinnedIPs {
				pinnedAddr := net.JoinHostPort(ip.String(), port)
				conn, err := (&net.Dialer{Timeout: 5 * time.Second}).DialContext(ctx, network, pinnedAddr)
				if err != nil {
					lastErr = err
					continue
				}
				return conn, nil
			}
			return nil, fmt.Errorf("all pinned IPs failed: %w", lastErr)
		},
	}
}

type relayURLError struct {
	msg string
}

func (e *relayURLError) Error() string {
	return e.msg
}

// httpToHTTP converts a WebSocket URL to an HTTP URL for the registration endpoint.
// ws://host → http://host, wss://host → https://host
func httpToHTTP(wsURL string) string {
	if len(wsURL) >= 6 && wsURL[:6] == "wss://" {
		return "https://" + wsURL[6:]
	}
	if len(wsURL) >= 5 && wsURL[:5] == "ws://" {
		return "http://" + wsURL[5:]
	}
	return wsURL
}
