// backend/server/auth_handlers.go
package server

import (
	"encoding/json"
	"net/http"

	"github.com/chatml/chatml-backend/github"
)

// AuthHandlers handles authentication endpoints
type AuthHandlers struct {
	ghClient *github.Client
}

// NewAuthHandlers creates new auth handlers
func NewAuthHandlers(ghClient *github.Client) *AuthHandlers {
	return &AuthHandlers{ghClient: ghClient}
}

// GitHubCallbackRequest is the request body for OAuth callback
type GitHubCallbackRequest struct {
	Code string `json:"code"`
}

// GitHubCallbackResponse is the response for OAuth callback
type GitHubCallbackResponse struct {
	Token string       `json:"token"`
	User  *github.User `json:"user"`
}

// SetTokenRequest is the request body for setting a token
type SetTokenRequest struct {
	Token string `json:"token"`
}

// AuthStatusResponse is the response for auth status
type AuthStatusResponse struct {
	Authenticated bool         `json:"authenticated"`
	User          *github.User `json:"user,omitempty"`
}

// GitHubCallback handles POST /api/auth/github/callback
// Exchanges OAuth code for token and fetches user info
func (h *AuthHandlers) GitHubCallback(w http.ResponseWriter, r *http.Request) {
	var req GitHubCallbackRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeValidationError(w, "invalid request body")
		return
	}

	if req.Code == "" {
		writeValidationError(w, "code is required")
		return
	}

	// Exchange code for token
	token, err := h.ghClient.ExchangeCode(r.Context(), req.Code)
	if err != nil {
		writeBadGateway(w, "failed to exchange code", err)
		return
	}

	// Fetch user info
	user, err := h.ghClient.GetUser(r.Context(), token)
	if err != nil {
		writeBadGateway(w, "failed to fetch user", err)
		return
	}

	// Store in memory (frontend will also store in keychain)
	h.ghClient.SetToken(token)
	h.ghClient.SetUser(user)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(GitHubCallbackResponse{
		Token: token,
		User:  user,
	})
}

// SetToken handles POST /api/auth/token
// Called by frontend on startup to provide stored token
func (h *AuthHandlers) SetToken(w http.ResponseWriter, r *http.Request) {
	var req SetTokenRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeValidationError(w, "invalid request body")
		return
	}

	if req.Token == "" {
		writeValidationError(w, "token is required")
		return
	}

	// Validate token by fetching user
	user, err := h.ghClient.GetUser(r.Context(), req.Token)
	if err != nil {
		writeError(w, http.StatusUnauthorized, ErrCodeUnauthorized, "invalid token", err)
		return
	}

	h.ghClient.SetToken(req.Token)
	h.ghClient.SetUser(user)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"ok":   true,
		"user": user,
	})
}

// GetStatus handles GET /api/auth/status
func (h *AuthHandlers) GetStatus(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(AuthStatusResponse{
		Authenticated: h.ghClient.IsAuthenticated(),
		User:          h.ghClient.GetStoredUser(),
	})
}

// Logout handles POST /api/auth/logout
func (h *AuthHandlers) Logout(w http.ResponseWriter, r *http.Request) {
	h.ghClient.ClearAuth()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]bool{"ok": true})
}
