// backend/github/client.go
package github

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/chatml/chatml-backend/logger"
)

// User represents a GitHub user
type User struct {
	Login     string `json:"login"`
	Name      string `json:"name"`
	AvatarURL string `json:"avatar_url"`
}

// TokenSet holds the OAuth token data for GitHub Apps with expiring tokens.
type TokenSet struct {
	AccessToken  string    `json:"access_token"`
	RefreshToken string    `json:"refresh_token"`
	TokenType    string    `json:"token_type"`
	Scope        string    `json:"scope"`
	ExpiresAt    time.Time `json:"expires_at"`
}

// Client handles GitHub API interactions
type Client struct {
	clientID         string
	clientSecret     string
	httpClient       *http.Client
	noRedirectClient *http.Client // Client that doesn't follow redirects (for log fetching)
	baseURL          string       // OAuth base URL (github.com)
	apiURL           string       // API base URL (api.github.com)

	// In-memory token storage
	mu             sync.RWMutex
	token          string    // plain token (backward compat for non-expiring tokens)
	tokens         *TokenSet // token set with refresh support
	user           *User
	onTokenRefresh func(*TokenSet) // callback to persist tokens after refresh
}

// NewClient creates a new GitHub client
func NewClient(clientID, clientSecret string) *Client {
	rt := &retryTransport{
		base:       http.DefaultTransport,
		maxRetries: 3,
		baseDelay:  1 * time.Second,
	}
	// Fewer retries for the no-redirect client used in interactive log fetching.
	noRedirectRT := &retryTransport{
		base:       http.DefaultTransport,
		maxRetries: 1,
		baseDelay:  500 * time.Millisecond,
	}
	return &Client{
		clientID:     clientID,
		clientSecret: clientSecret,
		httpClient:   &http.Client{Timeout: 30 * time.Second, Transport: rt},
		noRedirectClient: &http.Client{
			Timeout: 30 * time.Second,
			Transport: noRedirectRT,
			CheckRedirect: func(req *http.Request, via []*http.Request) error {
				return http.ErrUseLastResponse
			},
		},
		baseURL: "https://github.com",
		apiURL:  "https://api.github.com",
	}
}

// ExchangeCode exchanges an OAuth code for an access token and optional refresh token.
// If codeVerifier is provided, it's included for PKCE validation.
// Returns a TokenSet with refresh token and expiry if the GitHub App has expiring tokens enabled,
// otherwise returns a TokenSet with only the access token populated (zero ExpiresAt, empty RefreshToken).
func (c *Client) ExchangeCode(ctx context.Context, code string, codeVerifier string) (*TokenSet, error) {
	// Log the exchange attempt (mask sensitive values)
	hasClientID := c.clientID != ""
	hasClientSecret := c.clientSecret != ""
	hasCodeVerifier := codeVerifier != ""
	logger.GitHub.Debugf("ExchangeCode: clientID=%v, clientSecret=%v, codeVerifier=%v, code_length=%d",
		hasClientID, hasClientSecret, hasCodeVerifier, len(code))

	if !hasClientID {
		return nil, fmt.Errorf("GITHUB_CLIENT_ID not configured")
	}
	if !hasClientSecret {
		return nil, fmt.Errorf("GITHUB_CLIENT_SECRET not configured")
	}

	data := url.Values{}
	data.Set("client_id", c.clientID)
	data.Set("client_secret", c.clientSecret)
	data.Set("code", code)
	if codeVerifier != "" {
		data.Set("code_verifier", codeVerifier)
	}

	req, err := http.NewRequestWithContext(ctx, "POST",
		c.baseURL+"/login/oauth/access_token",
		strings.NewReader(data.Encode()))
	if err != nil {
		return nil, fmt.Errorf("creating request: %w", err)
	}

	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("exchanging code: %w", err)
	}
	defer resp.Body.Close()

	// Read body for logging (GitHub returns 200 even on errors)
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("reading response: %w", err)
	}

	logger.GitHub.Debugf("OAuth response: status=%d, body_length=%d", resp.StatusCode, len(body))

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("GitHub returned %d: %s", resp.StatusCode, body)
	}

	var result struct {
		AccessToken           string `json:"access_token"`
		RefreshToken          string `json:"refresh_token"`
		TokenType             string `json:"token_type"`
		Scope                 string `json:"scope"`
		ExpiresIn             int64  `json:"expires_in"`               // seconds until access token expires
		RefreshTokenExpiresIn int64  `json:"refresh_token_expires_in"` // seconds until refresh token expires
		Error                 string `json:"error"`
		ErrorDesc             string `json:"error_description"`
	}

	if err := json.Unmarshal(body, &result); err != nil {
		return nil, fmt.Errorf("decoding response: %w", err)
	}

	if result.Error != "" {
		return nil, fmt.Errorf("GitHub error: %s - %s", result.Error, result.ErrorDesc)
	}

	tokenSet := &TokenSet{
		AccessToken:  result.AccessToken,
		RefreshToken: result.RefreshToken,
		TokenType:    result.TokenType,
		Scope:        result.Scope,
	}

	// If expires_in is present, compute absolute expiration time
	if result.ExpiresIn > 0 {
		tokenSet.ExpiresAt = time.Now().Add(time.Duration(result.ExpiresIn) * time.Second)
	}

	logger.GitHub.Debugf("Token exchange successful, scope=%s, hasRefreshToken=%v, expiresIn=%ds",
		result.Scope, result.RefreshToken != "", result.ExpiresIn)
	return tokenSet, nil
}

// GetUser fetches the authenticated user's profile
func (c *Client) GetUser(ctx context.Context, token string) (*User, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", c.apiURL+"/user", nil)
	if err != nil {
		return nil, fmt.Errorf("creating request: %w", err)
	}

	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("fetching user: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, readErr := io.ReadAll(resp.Body)
		if readErr != nil {
			return nil, fmt.Errorf("GitHub returned %d (body unreadable: %v)", resp.StatusCode, readErr)
		}
		return nil, fmt.Errorf("GitHub returned %d: %s", resp.StatusCode, body)
	}

	var user User
	if err := json.NewDecoder(resp.Body).Decode(&user); err != nil {
		return nil, fmt.Errorf("decoding user: %w", err)
	}

	return &user, nil
}

// SetToken stores the token in memory
func (c *Client) SetToken(token string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.token = token
}

// GetToken returns the stored token
func (c *Client) GetToken() string {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.token
}

// SetUser stores a copy of the user in memory
func (c *Client) SetUser(user *User) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if user == nil {
		c.user = nil
		return
	}
	// Store a copy to avoid external mutations
	c.user = &User{
		Login:     user.Login,
		Name:      user.Name,
		AvatarURL: user.AvatarURL,
	}
}

// GetStoredUser returns a copy of the stored user
func (c *Client) GetStoredUser() *User {
	c.mu.RLock()
	defer c.mu.RUnlock()
	if c.user == nil {
		return nil
	}
	// Return a copy to avoid external mutations
	return &User{
		Login:     c.user.Login,
		Name:      c.user.Name,
		AvatarURL: c.user.AvatarURL,
	}
}

// ClearAuth clears the stored token and user
func (c *Client) ClearAuth() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.token = ""
	c.tokens = nil
	c.user = nil
}

// IsAuthenticated returns whether a token is stored
func (c *Client) IsAuthenticated() bool {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.token != "" || (c.tokens != nil && c.tokens.AccessToken != "")
}

// SetOnTokenRefresh sets a callback invoked after a successful token refresh.
func (c *Client) SetOnTokenRefresh(fn func(*TokenSet)) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.onTokenRefresh = fn
}

// SetTokens stores a TokenSet in memory (for expiring tokens with refresh support).
func (c *Client) SetTokens(tokens *TokenSet) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if tokens == nil {
		c.tokens = nil
		c.token = ""
		return
	}
	cp := *tokens
	c.tokens = &cp
	c.token = tokens.AccessToken // keep plain token in sync for backward compat
}

// GetTokens returns a copy of the stored TokenSet.
func (c *Client) GetTokens() *TokenSet {
	c.mu.RLock()
	defer c.mu.RUnlock()
	if c.tokens == nil {
		return nil
	}
	cp := *c.tokens
	return &cp
}

// RefreshToken refreshes the access token using the refresh token.
func (c *Client) RefreshToken(ctx context.Context) (*TokenSet, error) {
	c.mu.RLock()
	refreshToken := ""
	if c.tokens != nil {
		refreshToken = c.tokens.RefreshToken
	}
	c.mu.RUnlock()

	if refreshToken == "" {
		return nil, fmt.Errorf("no refresh token available")
	}

	data := url.Values{}
	data.Set("grant_type", "refresh_token")
	data.Set("client_id", c.clientID)
	data.Set("client_secret", c.clientSecret)
	data.Set("refresh_token", refreshToken)

	req, err := http.NewRequestWithContext(ctx, "POST",
		c.baseURL+"/login/oauth/access_token",
		strings.NewReader(data.Encode()))
	if err != nil {
		return nil, fmt.Errorf("creating request: %w", err)
	}

	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("refreshing token: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("reading response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("GitHub returned %d: %s", resp.StatusCode, body)
	}

	var result struct {
		AccessToken           string `json:"access_token"`
		RefreshToken          string `json:"refresh_token"`
		TokenType             string `json:"token_type"`
		Scope                 string `json:"scope"`
		ExpiresIn             int64  `json:"expires_in"`
		RefreshTokenExpiresIn int64  `json:"refresh_token_expires_in"`
		Error                 string `json:"error"`
		ErrorDesc             string `json:"error_description"`
	}

	if err := json.Unmarshal(body, &result); err != nil {
		return nil, fmt.Errorf("decoding response: %w", err)
	}

	if result.Error != "" {
		return nil, fmt.Errorf("GitHub refresh error: %s - %s", result.Error, result.ErrorDesc)
	}

	tokens := &TokenSet{
		AccessToken:  result.AccessToken,
		RefreshToken: result.RefreshToken,
		TokenType:    result.TokenType,
		Scope:        result.Scope,
	}
	if result.ExpiresIn > 0 {
		tokens.ExpiresAt = time.Now().Add(time.Duration(result.ExpiresIn) * time.Second)
	}

	c.mu.Lock()
	c.tokens = tokens
	c.token = tokens.AccessToken
	callback := c.onTokenRefresh
	c.mu.Unlock()

	// Persist refreshed tokens
	if callback != nil {
		callback(tokens)
	}

	logger.GitHub.Debugf("Token refresh successful, expiresIn=%ds", result.ExpiresIn)
	return tokens, nil
}

// getValidToken returns a valid access token, auto-refreshing if within 5 minutes of expiry.
// Falls back to plain token if no TokenSet is available (backward compat with non-expiring tokens).
func (c *Client) getValidToken(ctx context.Context) (string, error) {
	c.mu.RLock()
	tokens := c.tokens
	plainToken := c.token
	c.mu.RUnlock()

	// If we have a TokenSet with refresh support
	if tokens != nil {
		// If ExpiresAt is zero, tokens don't expire (non-expiring OAuth app token)
		if tokens.ExpiresAt.IsZero() {
			return tokens.AccessToken, nil
		}
		// Refresh if within 5 minutes of expiry
		if time.Until(tokens.ExpiresAt) < 5*time.Minute {
			logger.GitHub.Debugf("GitHub token expiring soon, refreshing...")
			refreshed, err := c.RefreshToken(ctx)
			if err != nil {
				return "", fmt.Errorf("auto-refresh failed: %w", err)
			}
			return refreshed.AccessToken, nil
		}
		return tokens.AccessToken, nil
	}

	// Fall back to plain token (backward compat)
	if plainToken != "" {
		return plainToken, nil
	}

	return "", fmt.Errorf("not authenticated")
}

// SetBaseURL sets the OAuth base URL (for testing)
func (c *Client) SetBaseURL(url string) {
	c.baseURL = url
}

// SetAPIURL sets the API base URL (for testing)
func (c *Client) SetAPIURL(url string) {
	c.apiURL = url
}

// SearchUserResult represents a user from the GitHub search API
type SearchUserResult struct {
	Login     string `json:"login"`
	AvatarURL string `json:"avatar_url"`
}

// SearchUsersResponse represents the response from GitHub's user search API
type SearchUsersResponse struct {
	TotalCount int                `json:"total_count"`
	Items      []SearchUserResult `json:"items"`
}

// GetAvatarByEmail searches for a GitHub user by email and returns their avatar URL.
// Returns empty string if no user is found.
// Uses authenticated requests if a token is available (higher rate limits).
func (c *Client) GetAvatarByEmail(ctx context.Context, email string) (string, error) {
	if email == "" {
		return "", nil
	}

	// Build search query: email must be in the user's public email
	query := url.QueryEscape(email + " in:email")
	searchURL := fmt.Sprintf("%s/search/users?q=%s&per_page=1", c.apiURL, query)

	req, err := http.NewRequestWithContext(ctx, "GET", searchURL, nil)
	if err != nil {
		return "", fmt.Errorf("creating request: %w", err)
	}

	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")

	// Use token if available for higher rate limits
	token, _ := c.getValidToken(ctx)
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("searching users: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, readErr := io.ReadAll(resp.Body)
		if readErr != nil {
			return "", fmt.Errorf("GitHub returned %d (body unreadable: %v)", resp.StatusCode, readErr)
		}
		return "", fmt.Errorf("GitHub returned %d: %s", resp.StatusCode, body)
	}

	var result SearchUsersResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", fmt.Errorf("decoding response: %w", err)
	}

	// No users found
	if result.TotalCount == 0 || len(result.Items) == 0 {
		return "", nil
	}

	return result.Items[0].AvatarURL, nil
}

// CommitStatus represents a commit status to create
type CommitStatus struct {
	State       string `json:"state"`       // error, failure, pending, success
	TargetURL   string `json:"target_url"`  // URL to ChatML session/results
	Description string `json:"description"` // Short description (max 140 chars)
	Context     string `json:"context"`     // Status identifier, e.g., "chatml/ai-review"
}

// CommitStatusResponse represents GitHub's response for a commit status
type CommitStatusResponse struct {
	ID          int64     `json:"id"`
	State       string    `json:"state"`
	Description string    `json:"description"`
	Context     string    `json:"context"`
	TargetURL   string    `json:"target_url"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
	Creator     *User     `json:"creator"`
}

// CombinedStatus represents the combined status for a ref
type CombinedStatus struct {
	State      string                 `json:"state"` // failure, pending, success
	SHA        string                 `json:"sha"`
	TotalCount int                    `json:"total_count"`
	Statuses   []CommitStatusResponse `json:"statuses"`
}

// CreateCommitStatus posts a status to a commit
func (c *Client) CreateCommitStatus(ctx context.Context, owner, repo, sha string, status CommitStatus) (*CommitStatusResponse, error) {
	token, err := c.getValidToken(ctx)
	if err != nil {
		return nil, err
	}

	statusURL := fmt.Sprintf("%s/repos/%s/%s/statuses/%s", c.apiURL, owner, repo, sha)

	body, err := json.Marshal(status)
	if err != nil {
		return nil, fmt.Errorf("marshaling status: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, "POST", statusURL, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("creating request: %w", err)
	}

	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("posting status: %w", err)
	}
	defer resp.Body.Close()

	// GitHub returns 201 Created on success
	if resp.StatusCode != http.StatusCreated {
		respBody, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("GitHub returned %d: %s", resp.StatusCode, respBody)
	}

	var result CommitStatusResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("decoding response: %w", err)
	}

	return &result, nil
}

// CreatePullRequestRequest contains the parameters for creating a GitHub pull request
type CreatePullRequestRequest struct {
	Title string `json:"title"`
	Body  string `json:"body"`
	Head  string `json:"head"`  // Branch name containing the changes
	Base  string `json:"base"`  // Target branch (e.g., "main")
	Draft bool   `json:"draft"` // Whether to create as a draft PR
}

// CreatePullRequestResponse contains the response from creating a pull request
type CreatePullRequestResponse struct {
	Number  int    `json:"number"`
	HTMLURL string `json:"html_url"`
	State   string `json:"state"`
	Title   string `json:"title"`
}

// CreatePullRequest creates a new pull request on GitHub
func (c *Client) CreatePullRequest(ctx context.Context, owner, repo string, pr CreatePullRequestRequest) (*CreatePullRequestResponse, error) {
	token, err := c.getValidToken(ctx)
	if err != nil {
		return nil, err
	}

	prURL := fmt.Sprintf("%s/repos/%s/%s/pulls", c.apiURL, owner, repo)

	body, err := json.Marshal(pr)
	if err != nil {
		return nil, fmt.Errorf("marshaling PR request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, "POST", prURL, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("creating request: %w", err)
	}

	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("creating pull request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusCreated {
		respBody, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("GitHub returned %d: %s", resp.StatusCode, respBody)
	}

	var result CreatePullRequestResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("decoding response: %w", err)
	}

	return &result, nil
}

// GetCombinedStatus gets the combined status for a ref (branch, tag, or SHA)
func (c *Client) GetCombinedStatus(ctx context.Context, owner, repo, ref string) (*CombinedStatus, error) {
	token, err := c.getValidToken(ctx)
	if err != nil {
		return nil, err
	}

	// Request per_page=100 (max). GitHub defaults to 30, which silently
	// truncates legacy /statuses contexts on PRs with many environments
	// (e.g. multi-region Vercel previews).
	statusURL := fmt.Sprintf("%s/repos/%s/%s/commits/%s/status?per_page=100", c.apiURL, owner, repo, ref)

	req, err := http.NewRequestWithContext(ctx, "GET", statusURL, nil)
	if err != nil {
		return nil, fmt.Errorf("creating request: %w", err)
	}

	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/vnd.github+json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("fetching status: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("GitHub returned %d: %s", resp.StatusCode, body)
	}

	var result CombinedStatus
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("decoding response: %w", err)
	}

	return &result, nil
}
