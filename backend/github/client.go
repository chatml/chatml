// backend/github/client.go
package github

import (
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
	clientID     string
	clientSecret string
	httpClient   *http.Client
	baseURL      string // OAuth base URL (github.com)
	apiURL       string // API base URL (api.github.com)

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
		baseURL:      "https://github.com",
		apiURL:       "https://api.github.com",
	}
}

// ExchangeCode exchanges an OAuth code for an access token
func (c *Client) ExchangeCode(ctx context.Context, code string) (string, error) {
	data := url.Values{}
	data.Set("client_id", c.clientID)
	data.Set("client_secret", c.clientSecret)
	data.Set("code", code)

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

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("GitHub returned %d: %s", resp.StatusCode, body)
	}

	var result struct {
		AccessToken string `json:"access_token"`
		TokenType   string `json:"token_type"`
		Scope       string `json:"scope"`
		Error       string `json:"error"`
		ErrorDesc   string `json:"error_description"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", fmt.Errorf("decoding response: %w", err)
	}

	if result.Error != "" {
		return "", fmt.Errorf("GitHub error: %s - %s", result.Error, result.ErrorDesc)
	}

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
		body, _ := io.ReadAll(resp.Body)
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
