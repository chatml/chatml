// backend/server/auth_handlers.go
package server

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"github.com/chatml/chatml-backend/crypto"
	"github.com/chatml/chatml-backend/github"
	"github.com/chatml/chatml-backend/logger"
	"github.com/chatml/chatml-backend/store"
)

// Settings keys for encrypted GitHub tokens
const (
	settingGitHubAccessToken  = "github-access-token"
	settingGitHubRefreshToken = "github-refresh-token"
	settingGitHubTokenExpiry  = "github-token-expiry"
	settingGitHubUser         = "github-user"
)

// AuthHandlers handles authentication endpoints
type AuthHandlers struct {
	ghClient *github.Client
	store    *store.SQLiteStore
}

// NewAuthHandlers creates new auth handlers
func NewAuthHandlers(ghClient *github.Client, s *store.SQLiteStore) *AuthHandlers {
	return &AuthHandlers{ghClient: ghClient, store: s}
}

// GitHubCallbackRequest is the request body for OAuth callback
type GitHubCallbackRequest struct {
	Code         string `json:"code"`
	CodeVerifier string `json:"code_verifier,omitempty"` // PKCE code verifier
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

	// Exchange code for tokens (with PKCE verifier if provided)
	tokenSet, err := h.ghClient.ExchangeCode(r.Context(), req.Code, req.CodeVerifier)
	if err != nil {
		writeBadGateway(w, "failed to exchange code", err)
		return
	}

	// Store tokens in client memory
	h.ghClient.SetTokens(tokenSet)

	// Fetch user info
	user, err := h.ghClient.GetUser(r.Context(), tokenSet.AccessToken)
	if err != nil {
		writeBadGateway(w, "failed to fetch user", err)
		return
	}

	h.ghClient.SetUser(user)

	// Persist encrypted tokens to settings
	if err := h.persistTokens(r.Context(), tokenSet, user); err != nil {
		logger.GitHub.Errorf("Failed to persist GitHub tokens: %v", err)
		// Non-fatal — user is still authenticated in memory
	}

	// Return access token to frontend (for Stronghold storage as fallback)
	writeJSON(w, GitHubCallbackResponse{
		Token: tokenSet.AccessToken,
		User:  user,
	})
}

// SetToken handles POST /api/auth/token
// Called by frontend on startup to provide stored token from Stronghold.
// If backend already has valid tokens from SQLite restore, this is a no-op migration path.
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

	// If backend already has valid tokens (restored from SQLite), skip
	if h.ghClient.IsAuthenticated() {
		user := h.ghClient.GetStoredUser()
		writeJSON(w, map[string]interface{}{
			"ok":   true,
			"user": user,
		})
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

	writeJSON(w, map[string]interface{}{
		"ok":   true,
		"user": user,
	})
}

// GetStatus handles GET /api/auth/status
func (h *AuthHandlers) GetStatus(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, AuthStatusResponse{
		Authenticated: h.ghClient.IsAuthenticated(),
		User:          h.ghClient.GetStoredUser(),
	})
}

// Logout handles POST /api/auth/logout
func (h *AuthHandlers) Logout(w http.ResponseWriter, r *http.Request) {
	h.ghClient.ClearAuth()

	// Clear persisted tokens (best-effort — in-memory auth is already cleared)
	ctx := r.Context()
	for _, key := range []string{
		settingGitHubAccessToken,
		settingGitHubRefreshToken,
		settingGitHubTokenExpiry,
		settingGitHubUser,
	} {
		if err := h.store.DeleteSetting(ctx, key); err != nil {
			logger.GitHub.Warnf("Failed to delete setting %q during logout: %v", key, err)
		}
	}

	logger.GitHub.Info("GitHub auth cleared")
	writeJSON(w, map[string]bool{"ok": true})
}

// RestoreFromStore restores GitHub auth from persisted encrypted settings.
// Called once at startup.
func (h *AuthHandlers) RestoreFromStore(ctx context.Context) {
	encAccess, found, err := h.store.GetSetting(ctx, settingGitHubAccessToken)
	if err != nil || !found {
		return
	}

	accessToken, err := crypto.Decrypt(encAccess)
	if err != nil {
		logger.GitHub.Warnf("Failed to decrypt GitHub access token: %v", err)
		return
	}

	encRefresh, _, _ := h.store.GetSetting(ctx, settingGitHubRefreshToken)
	refreshToken, _ := crypto.Decrypt(encRefresh)

	expiryStr, _, _ := h.store.GetSetting(ctx, settingGitHubTokenExpiry)
	expiresAt, _ := time.Parse(time.RFC3339, expiryStr)

	tokens := &github.TokenSet{
		AccessToken:  accessToken,
		RefreshToken: refreshToken,
		TokenType:    "Bearer",
		ExpiresAt:    expiresAt,
	}
	h.ghClient.SetTokens(tokens)

	// Restore user info
	encUser, found, _ := h.store.GetSetting(ctx, settingGitHubUser)
	if found {
		userJSON, err := crypto.Decrypt(encUser)
		if err == nil {
			var user github.User
			if err := json.Unmarshal([]byte(userJSON), &user); err == nil {
				h.ghClient.SetUser(&user)
			}
		}
	}

	logger.GitHub.Infof("Restored GitHub auth from store (expires %s)", expiresAt.Format(time.RFC3339))
}

// PersistGitHubTokens encrypts and stores tokens in the settings table.
// Exported for use by the token-refresh callback in main.go.
func PersistGitHubTokens(ctx context.Context, s *store.SQLiteStore, tokens *github.TokenSet) error {
	encAccess, err := crypto.Encrypt(tokens.AccessToken)
	if err != nil {
		return err
	}
	if err := s.SetSetting(ctx, settingGitHubAccessToken, encAccess); err != nil {
		return err
	}
	if tokens.RefreshToken != "" {
		encRefresh, err := crypto.Encrypt(tokens.RefreshToken)
		if err != nil {
			return err
		}
		if err := s.SetSetting(ctx, settingGitHubRefreshToken, encRefresh); err != nil {
			return err
		}
	}
	if !tokens.ExpiresAt.IsZero() {
		return s.SetSetting(ctx, settingGitHubTokenExpiry, tokens.ExpiresAt.Format(time.RFC3339))
	}
	return nil
}

// persistTokens encrypts and stores tokens + user in the settings table.
func (h *AuthHandlers) persistTokens(ctx context.Context, tokens *github.TokenSet, user *github.User) error {
	if err := PersistGitHubTokens(ctx, h.store, tokens); err != nil {
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
		if err := h.store.SetSetting(ctx, settingGitHubUser, encUser); err != nil {
			return err
		}
	}

	return nil
}
