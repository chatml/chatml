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
)

// User represents a GitHub user
type User struct {
	Login     string `json:"login"`
	Name      string `json:"name"`
	AvatarURL string `json:"avatar_url"`
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
	mu    sync.RWMutex
	token string
	user  *User
}

// NewClient creates a new GitHub client
func NewClient(clientID, clientSecret string) *Client {
	return &Client{
		clientID:     clientID,
		clientSecret: clientSecret,
		httpClient:   &http.Client{Timeout: 30 * time.Second},
		noRedirectClient: &http.Client{
			Timeout: 30 * time.Second,
			CheckRedirect: func(req *http.Request, via []*http.Request) error {
				return http.ErrUseLastResponse
			},
		},
		baseURL: "https://github.com",
		apiURL:  "https://api.github.com",
	}
}

// ExchangeCode exchanges an OAuth code for an access token
// If codeVerifier is provided, it's included for PKCE validation
func (c *Client) ExchangeCode(ctx context.Context, code string, codeVerifier string) (string, error) {
	// Log the exchange attempt (mask sensitive values)
	hasClientID := c.clientID != ""
	hasClientSecret := c.clientSecret != ""
	hasCodeVerifier := codeVerifier != ""
	fmt.Printf("[OAuth] ExchangeCode: clientID=%v, clientSecret=%v, codeVerifier=%v, code_length=%d\n",
		hasClientID, hasClientSecret, hasCodeVerifier, len(code))

	if !hasClientID {
		return "", fmt.Errorf("GITHUB_CLIENT_ID not configured")
	}
	if !hasClientSecret {
		return "", fmt.Errorf("GITHUB_CLIENT_SECRET not configured")
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
		return "", fmt.Errorf("creating request: %w", err)
	}

	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("exchanging code: %w", err)
	}
	defer resp.Body.Close()

	// Read body for logging (GitHub returns 200 even on errors)
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("reading response: %w", err)
	}

	fmt.Printf("[OAuth] GitHub response: status=%d, body=%s\n", resp.StatusCode, string(body))

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("GitHub returned %d: %s", resp.StatusCode, body)
	}

	var result struct {
		AccessToken string `json:"access_token"`
		TokenType   string `json:"token_type"`
		Scope       string `json:"scope"`
		Error       string `json:"error"`
		ErrorDesc   string `json:"error_description"`
	}

	if err := json.Unmarshal(body, &result); err != nil {
		return "", fmt.Errorf("decoding response: %w", err)
	}

	if result.Error != "" {
		return "", fmt.Errorf("GitHub error: %s - %s", result.Error, result.ErrorDesc)
	}

	fmt.Printf("[OAuth] Token exchange successful, scope=%s\n", result.Scope)
	return result.AccessToken, nil
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
	c.user = nil
}

// IsAuthenticated returns whether a token is stored
func (c *Client) IsAuthenticated() bool {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.token != ""
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
	token := c.GetToken()
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("searching users: %w", err)
	}
	defer resp.Body.Close()

	// Handle rate limiting
	if resp.StatusCode == http.StatusForbidden || resp.StatusCode == http.StatusTooManyRequests {
		return "", fmt.Errorf("rate limited by GitHub API")
	}

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
	token := c.GetToken()
	if token == "" {
		return nil, fmt.Errorf("not authenticated")
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

// GetCombinedStatus gets the combined status for a ref (branch, tag, or SHA)
func (c *Client) GetCombinedStatus(ctx context.Context, owner, repo, ref string) (*CombinedStatus, error) {
	token := c.GetToken()
	if token == "" {
		return nil, fmt.Errorf("not authenticated")
	}

	statusURL := fmt.Sprintf("%s/repos/%s/%s/commits/%s/status", c.apiURL, owner, repo, ref)

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
