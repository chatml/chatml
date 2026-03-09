package server

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"github.com/chatml/chatml-backend/crypto"
	"github.com/chatml/chatml-backend/linear"
	"github.com/chatml/chatml-backend/logger"
	"github.com/chatml/chatml-backend/store"
)

// Settings keys for encrypted Linear tokens
const (
	settingLinearAccessToken  = "linear-access-token"
	settingLinearRefreshToken = "linear-refresh-token"
	settingLinearTokenExpiry  = "linear-token-expiry"
	settingLinearUser         = "linear-user"
)

// LinearAuthHandlers handles Linear OAuth endpoints.
type LinearAuthHandlers struct {
	linearClient *linear.Client
	store        *store.SQLiteStore
}

// NewLinearAuthHandlers creates new Linear auth handlers.
func NewLinearAuthHandlers(lc *linear.Client, s *store.SQLiteStore) *LinearAuthHandlers {
	return &LinearAuthHandlers{linearClient: lc, store: s}
}

// LinearCallbackRequest is the request body for the OAuth callback.
type LinearCallbackRequest struct {
	Code         string `json:"code"`
	CodeVerifier string `json:"code_verifier"`
	RedirectURI  string `json:"redirect_uri"`
}

// LinearCallbackResponse is the response for the OAuth callback.
type LinearCallbackResponse struct {
	User *linear.User `json:"user"`
}

// LinearAuthStatusResponse is the response for auth status.
type LinearAuthStatusResponse struct {
	Authenticated bool         `json:"authenticated"`
	User          *linear.User `json:"user,omitempty"`
}

// Callback handles POST /api/auth/linear/callback
func (h *LinearAuthHandlers) Callback(w http.ResponseWriter, r *http.Request) {
	var req LinearCallbackRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeValidationError(w, "invalid request body")
		return
	}

	if req.Code == "" {
		writeValidationError(w, "code is required")
		return
	}

	redirectURI := req.RedirectURI
	if redirectURI == "" {
		redirectURI = "chatml://oauth/callback"
	}

	// Exchange code for tokens
	tokens, err := h.linearClient.ExchangeCode(r.Context(), req.Code, req.CodeVerifier, redirectURI)
	if err != nil {
		writeBadGateway(w, "failed to exchange code with Linear", err)
		return
	}

	// Store tokens in client memory
	h.linearClient.SetTokens(tokens)

	// Fetch user info
	user, err := h.linearClient.GetViewer(r.Context())
	if err != nil {
		writeBadGateway(w, "failed to fetch Linear user", err)
		return
	}

	h.linearClient.SetUser(user)

	// Persist encrypted tokens to settings
	if err := h.persistTokens(r.Context(), tokens, user); err != nil {
		logger.Linear.Errorf("Failed to persist Linear tokens: %v", err)
		// Non-fatal — user is still authenticated in memory
	}

	writeJSON(w, LinearCallbackResponse{User: user})
}

// GetStatus handles GET /api/auth/linear/status
func (h *LinearAuthHandlers) GetStatus(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, LinearAuthStatusResponse{
		Authenticated: h.linearClient.IsAuthenticated(),
		User:          h.linearClient.GetStoredUser(),
	})
}

// Logout handles POST /api/auth/linear/logout
func (h *LinearAuthHandlers) Logout(w http.ResponseWriter, r *http.Request) {
	h.linearClient.ClearAuth()

	// Clear persisted tokens
	ctx := r.Context()
	h.store.DeleteSetting(ctx, settingLinearAccessToken)
	h.store.DeleteSetting(ctx, settingLinearRefreshToken)
	h.store.DeleteSetting(ctx, settingLinearTokenExpiry)
	h.store.DeleteSetting(ctx, settingLinearUser)

	logger.Linear.Info("Linear auth cleared")
	writeJSON(w, map[string]bool{"ok": true})
}

// RestoreFromStore restores Linear auth from persisted encrypted settings.
// Called once at startup.
func (h *LinearAuthHandlers) RestoreFromStore(ctx context.Context) {
	encAccess, found, err := h.store.GetSetting(ctx, settingLinearAccessToken)
	if err != nil || !found {
		return
	}

	accessToken, err := crypto.Decrypt(encAccess)
	if err != nil {
		logger.Linear.Warnf("Failed to decrypt Linear access token: %v", err)
		return
	}

	encRefresh, _, err := h.store.GetSetting(ctx, settingLinearRefreshToken)
	var refreshToken string
	if err != nil {
		logger.Linear.Warnf("Failed to load Linear refresh token setting: %v", err)
	} else if encRefresh != "" {
		refreshToken, err = crypto.Decrypt(encRefresh)
		if err != nil {
			logger.Linear.Warnf("Failed to decrypt Linear refresh token: %v", err)
		}
	}

	expiryStr, _, err := h.store.GetSetting(ctx, settingLinearTokenExpiry)
	var expiresAt time.Time
	if err != nil {
		logger.Linear.Warnf("Failed to load Linear token expiry setting: %v", err)
	} else if expiryStr != "" {
		expiresAt, err = time.Parse(time.RFC3339, expiryStr)
		if err != nil {
			logger.Linear.Warnf("Failed to parse Linear token expiry %q: %v", expiryStr, err)
		}
	}
	// If expiry is zero/missing, set to now to force an immediate refresh
	if expiresAt.IsZero() {
		expiresAt = time.Now()
	}

	tokens := &linear.TokenSet{
		AccessToken:  accessToken,
		RefreshToken: refreshToken,
		TokenType:    "Bearer",
		ExpiresAt:    expiresAt,
	}
	h.linearClient.SetTokens(tokens)

	// Restore user info
	encUser, found, err := h.store.GetSetting(ctx, settingLinearUser)
	if err != nil {
		logger.Linear.Warnf("Failed to load Linear user setting: %v", err)
	} else if found {
		userJSON, err := crypto.Decrypt(encUser)
		if err == nil {
			var user linear.User
			if err := json.Unmarshal([]byte(userJSON), &user); err == nil {
				h.linearClient.SetUser(&user)
			}
		}
	}

	logger.Linear.Infof("Restored Linear auth from store (expires %s)", expiresAt.Format(time.RFC3339))
}

// PersistLinearTokens encrypts and stores tokens in the settings table.
// Exported for use by the token-refresh callback in main.go.
func PersistLinearTokens(ctx context.Context, s *store.SQLiteStore, tokens *linear.TokenSet) error {
	encAccess, err := crypto.Encrypt(tokens.AccessToken)
	if err != nil {
		return err
	}
	if err := s.SetSetting(ctx, settingLinearAccessToken, encAccess); err != nil {
		return err
	}
	if tokens.RefreshToken != "" {
		encRefresh, err := crypto.Encrypt(tokens.RefreshToken)
		if err != nil {
			return err
		}
		if err := s.SetSetting(ctx, settingLinearRefreshToken, encRefresh); err != nil {
			return err
		}
	}
	return s.SetSetting(ctx, settingLinearTokenExpiry, tokens.ExpiresAt.Format(time.RFC3339))
}

// persistTokens encrypts and stores tokens + user in the settings table.
func (h *LinearAuthHandlers) persistTokens(ctx context.Context, tokens *linear.TokenSet, user *linear.User) error {
	if err := PersistLinearTokens(ctx, h.store, tokens); err != nil {
		return err
	}

	if user != nil {
		userJSON, err := json.Marshal(user)
		if err != nil {
			return err
		}
		encUser, err := crypto.Encrypt(string(userJSON))
		if err != nil {
			return err
		}
		if err := h.store.SetSetting(ctx, settingLinearUser, encUser); err != nil {
			return err
		}
	}

	return nil
}

// ListMyIssues handles GET /api/auth/linear/issues
func (h *LinearAuthHandlers) ListMyIssues(w http.ResponseWriter, r *http.Request) {
	if !h.linearClient.IsAuthenticated() {
		writeUnauthorized(w, "Linear not authenticated")
		return
	}

	issues, err := h.linearClient.ListMyIssues(r.Context())
	if err != nil {
		writeBadGateway(w, "failed to fetch Linear issues", err)
		return
	}

	writeJSON(w, issues)
}

// SearchLinearIssues handles GET /api/auth/linear/issues/search?q=...
func (h *LinearAuthHandlers) SearchLinearIssues(w http.ResponseWriter, r *http.Request) {
	if !h.linearClient.IsAuthenticated() {
		writeUnauthorized(w, "Linear not authenticated")
		return
	}

	q := r.URL.Query().Get("q")
	if q == "" {
		writeValidationError(w, "query parameter 'q' is required")
		return
	}

	issues, err := h.linearClient.SearchIssues(r.Context(), q)
	if err != nil {
		writeBadGateway(w, "failed to search Linear issues", err)
		return
	}

	writeJSON(w, issues)
}
