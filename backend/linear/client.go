// Package linear provides an OAuth 2.0 client for the Linear API.
package linear

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sync"
	"time"

	"github.com/chatml/chatml-backend/logger"
)

// User represents a Linear user (viewer).
type User struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Email       string `json:"email"`
	DisplayName string `json:"displayName"`
	AvatarURL   string `json:"avatarUrl"`
}

// TokenSet holds the OAuth token data.
type TokenSet struct {
	AccessToken  string    `json:"access_token"`
	RefreshToken string    `json:"refresh_token"`
	TokenType    string    `json:"token_type"`
	Scope        string    `json:"scope"`
	ExpiresAt    time.Time `json:"expires_at"`
}

// Client handles Linear OAuth and API interactions.
type Client struct {
	clientID   string
	httpClient *http.Client
	oauthURL   string // https://api.linear.app/oauth
	apiURL     string // https://api.linear.app/graphql

	mu             sync.RWMutex
	tokens         *TokenSet
	user           *User
	onTokenRefresh func(*TokenSet) // callback to persist tokens after refresh
}

// NewClient creates a new Linear client.
func NewClient(clientID string) *Client {
	return &Client{
		clientID:   clientID,
		httpClient: &http.Client{Timeout: 30 * time.Second},
		oauthURL:   "https://api.linear.app/oauth",
		apiURL:     "https://api.linear.app/graphql",
	}
}

// SetOnTokenRefresh sets a callback invoked after a successful token refresh.
func (c *Client) SetOnTokenRefresh(fn func(*TokenSet)) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.onTokenRefresh = fn
}

// ExchangeCode exchanges an authorization code for tokens (PKCE flow).
func (c *Client) ExchangeCode(ctx context.Context, code, codeVerifier, redirectURI string) (*TokenSet, error) {
	logger.Linear.Debugf("ExchangeCode: clientID=%v, codeVerifier=%v", c.clientID != "", codeVerifier != "")

	if c.clientID == "" {
		return nil, fmt.Errorf("LINEAR_CLIENT_ID not configured")
	}

	body := map[string]string{
		"grant_type":    "authorization_code",
		"client_id":     c.clientID,
		"code":          code,
		"code_verifier": codeVerifier,
		"redirect_uri":  redirectURI,
	}

	jsonBody, err := json.Marshal(body)
	if err != nil {
		return nil, fmt.Errorf("marshaling request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, "POST", c.oauthURL+"/token", bytes.NewReader(jsonBody))
	if err != nil {
		return nil, fmt.Errorf("creating request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("exchanging code: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("reading response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("Linear returned %d: %s", resp.StatusCode, respBody)
	}

	var result struct {
		AccessToken  string `json:"access_token"`
		RefreshToken string `json:"refresh_token"`
		TokenType    string `json:"token_type"`
		Scope        string `json:"scope"`
		ExpiresIn    int64  `json:"expires_in"` // seconds
		Error        string `json:"error"`
		ErrorDesc    string `json:"error_description"`
	}

	if err := json.Unmarshal(respBody, &result); err != nil {
		return nil, fmt.Errorf("decoding response: %w", err)
	}

	if result.Error != "" {
		return nil, fmt.Errorf("Linear error: %s - %s", result.Error, result.ErrorDesc)
	}

	tokens := &TokenSet{
		AccessToken:  result.AccessToken,
		RefreshToken: result.RefreshToken,
		TokenType:    result.TokenType,
		Scope:        result.Scope,
		ExpiresAt:    time.Now().Add(time.Duration(result.ExpiresIn) * time.Second),
	}

	logger.Linear.Debugf("Token exchange successful, scope=%s, expiresIn=%ds", result.Scope, result.ExpiresIn)
	return tokens, nil
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

	body := map[string]string{
		"grant_type":    "refresh_token",
		"client_id":     c.clientID,
		"refresh_token": refreshToken,
	}

	jsonBody, err := json.Marshal(body)
	if err != nil {
		return nil, fmt.Errorf("marshaling request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, "POST", c.oauthURL+"/token", bytes.NewReader(jsonBody))
	if err != nil {
		return nil, fmt.Errorf("creating request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("refreshing token: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("reading response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("Linear returned %d: %s", resp.StatusCode, respBody)
	}

	var result struct {
		AccessToken  string `json:"access_token"`
		RefreshToken string `json:"refresh_token"`
		TokenType    string `json:"token_type"`
		Scope        string `json:"scope"`
		ExpiresIn    int64  `json:"expires_in"`
		Error        string `json:"error"`
		ErrorDesc    string `json:"error_description"`
	}

	if err := json.Unmarshal(respBody, &result); err != nil {
		return nil, fmt.Errorf("decoding response: %w", err)
	}

	if result.Error != "" {
		return nil, fmt.Errorf("Linear refresh error: %s - %s", result.Error, result.ErrorDesc)
	}

	tokens := &TokenSet{
		AccessToken:  result.AccessToken,
		RefreshToken: result.RefreshToken,
		TokenType:    result.TokenType,
		Scope:        result.Scope,
		ExpiresAt:    time.Now().Add(time.Duration(result.ExpiresIn) * time.Second),
	}

	c.mu.Lock()
	c.tokens = tokens
	callback := c.onTokenRefresh
	c.mu.Unlock()

	// Persist refreshed tokens
	if callback != nil {
		callback(tokens)
	}

	logger.Linear.Debugf("Token refresh successful, expiresIn=%ds", result.ExpiresIn)
	return tokens, nil
}

// getValidToken returns a valid access token, auto-refreshing if within 5 minutes of expiry.
func (c *Client) getValidToken(ctx context.Context) (string, error) {
	c.mu.RLock()
	tokens := c.tokens
	c.mu.RUnlock()

	if tokens == nil {
		return "", fmt.Errorf("not authenticated")
	}

	// Refresh if within 5 minutes of expiry
	if time.Until(tokens.ExpiresAt) < 5*time.Minute {
		logger.Linear.Debugf("Token expiring soon, refreshing...")
		refreshed, err := c.RefreshToken(ctx)
		if err != nil {
			return "", fmt.Errorf("auto-refresh failed: %w", err)
		}
		return refreshed.AccessToken, nil
	}

	return tokens.AccessToken, nil
}

// GetViewer fetches the authenticated user via Linear's GraphQL API.
func (c *Client) GetViewer(ctx context.Context) (*User, error) {
	token, err := c.getValidToken(ctx)
	if err != nil {
		return nil, err
	}

	query := `{ viewer { id name email displayName avatarUrl } }`
	body := map[string]string{"query": query}

	jsonBody, err := json.Marshal(body)
	if err != nil {
		return nil, fmt.Errorf("marshaling request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, "POST", c.apiURL, bytes.NewReader(jsonBody))
	if err != nil {
		return nil, fmt.Errorf("creating request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("fetching viewer: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("Linear returned %d: %s", resp.StatusCode, respBody)
	}

	var result struct {
		Data struct {
			Viewer struct {
				ID          string `json:"id"`
				Name        string `json:"name"`
				Email       string `json:"email"`
				DisplayName string `json:"displayName"`
				AvatarURL   string `json:"avatarUrl"`
			} `json:"viewer"`
		} `json:"data"`
		Errors []struct {
			Message string `json:"message"`
		} `json:"errors"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("decoding response: %w", err)
	}

	if len(result.Errors) > 0 {
		return nil, fmt.Errorf("Linear GraphQL error: %s", result.Errors[0].Message)
	}

	return &User{
		ID:          result.Data.Viewer.ID,
		Name:        result.Data.Viewer.Name,
		Email:       result.Data.Viewer.Email,
		DisplayName: result.Data.Viewer.DisplayName,
		AvatarURL:   result.Data.Viewer.AvatarURL,
	}, nil
}

// Issue represents a Linear issue.
type Issue struct {
	ID          string   `json:"id"`
	Identifier  string   `json:"identifier"`
	Title       string   `json:"title"`
	Description string   `json:"description,omitempty"`
	StateName   string   `json:"stateName"`
	Labels      []string `json:"labels"`
	Assignee    string   `json:"assignee,omitempty"`
	Project     string   `json:"project,omitempty"`
}

// issueFields is the shared set of GraphQL fields for issue queries.
const issueFields = `id identifier title description state { name } labels { nodes { name } } assignee { name } project { name }`

// issueNode is the GraphQL response shape for a single issue node.
type issueNode struct {
	ID          string `json:"id"`
	Identifier  string `json:"identifier"`
	Title       string `json:"title"`
	Description string `json:"description"`
	State       struct {
		Name string `json:"name"`
	} `json:"state"`
	Labels struct {
		Nodes []struct {
			Name string `json:"name"`
		} `json:"nodes"`
	} `json:"labels"`
	Assignee *struct {
		Name string `json:"name"`
	} `json:"assignee"`
	Project *struct {
		Name string `json:"name"`
	} `json:"project"`
}

// parseIssueNodes converts GraphQL issue nodes into Issue structs.
func parseIssueNodes(nodes []issueNode) []Issue {
	issues := make([]Issue, 0, len(nodes))
	for _, n := range nodes {
		labels := make([]string, 0, len(n.Labels.Nodes))
		for _, l := range n.Labels.Nodes {
			labels = append(labels, l.Name)
		}
		issue := Issue{
			ID:          n.ID,
			Identifier:  n.Identifier,
			Title:       n.Title,
			Description: n.Description,
			StateName:   n.State.Name,
			Labels:      labels,
		}
		if n.Assignee != nil {
			issue.Assignee = n.Assignee.Name
		}
		if n.Project != nil {
			issue.Project = n.Project.Name
		}
		issues = append(issues, issue)
	}
	return issues
}

// ListMyIssues fetches active issues assigned to the authenticated user.
func (c *Client) ListMyIssues(ctx context.Context) ([]Issue, error) {
	token, err := c.getValidToken(ctx)
	if err != nil {
		return nil, err
	}

	query := fmt.Sprintf(`{
		viewer {
			assignedIssues(
				first: 30
				orderBy: updatedAt
				filter: { state: { type: { nin: ["completed", "canceled"] } } }
			) {
				nodes { %s }
			}
		}
	}`, issueFields)

	body := map[string]string{"query": query}
	jsonBody, err := json.Marshal(body)
	if err != nil {
		return nil, fmt.Errorf("marshaling request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, "POST", c.apiURL, bytes.NewReader(jsonBody))
	if err != nil {
		return nil, fmt.Errorf("creating request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("fetching issues: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("Linear returned %d: %s", resp.StatusCode, respBody)
	}

	var result struct {
		Data struct {
			Viewer struct {
				AssignedIssues struct {
					Nodes []issueNode `json:"nodes"`
				} `json:"assignedIssues"`
			} `json:"viewer"`
		} `json:"data"`
		Errors []struct {
			Message string `json:"message"`
		} `json:"errors"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("decoding response: %w", err)
	}

	if len(result.Errors) > 0 {
		return nil, fmt.Errorf("Linear GraphQL error: %s", result.Errors[0].Message)
	}

	return parseIssueNodes(result.Data.Viewer.AssignedIssues.Nodes), nil
}

// SearchIssues searches Linear issues by query text.
func (c *Client) SearchIssues(ctx context.Context, query string) ([]Issue, error) {
	token, err := c.getValidToken(ctx)
	if err != nil {
		return nil, err
	}

	gql := fmt.Sprintf(`{
		issueSearch(query: %q, first: 20) {
			nodes { %s }
		}
	}`, query, issueFields)

	body := map[string]string{"query": gql}
	jsonBody, err := json.Marshal(body)
	if err != nil {
		return nil, fmt.Errorf("marshaling request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, "POST", c.apiURL, bytes.NewReader(jsonBody))
	if err != nil {
		return nil, fmt.Errorf("creating request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("searching issues: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("Linear returned %d: %s", resp.StatusCode, respBody)
	}

	var result struct {
		Data struct {
			IssueSearch struct {
				Nodes []issueNode `json:"nodes"`
			} `json:"issueSearch"`
		} `json:"data"`
		Errors []struct {
			Message string `json:"message"`
		} `json:"errors"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("decoding response: %w", err)
	}

	if len(result.Errors) > 0 {
		return nil, fmt.Errorf("Linear GraphQL error: %s", result.Errors[0].Message)
	}

	return parseIssueNodes(result.Data.IssueSearch.Nodes), nil
}

// SetTokens stores tokens in memory.
func (c *Client) SetTokens(tokens *TokenSet) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if tokens == nil {
		c.tokens = nil
		return
	}
	cp := *tokens
	c.tokens = &cp
}

// GetTokens returns a copy of the stored tokens.
func (c *Client) GetTokens() *TokenSet {
	c.mu.RLock()
	defer c.mu.RUnlock()
	if c.tokens == nil {
		return nil
	}
	cp := *c.tokens
	return &cp
}

// SetUser stores a copy of the user in memory.
func (c *Client) SetUser(user *User) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if user == nil {
		c.user = nil
		return
	}
	cp := *user
	c.user = &cp
}

// GetStoredUser returns a copy of the stored user.
func (c *Client) GetStoredUser() *User {
	c.mu.RLock()
	defer c.mu.RUnlock()
	if c.user == nil {
		return nil
	}
	cp := *c.user
	return &cp
}

// ClearAuth clears stored tokens and user.
func (c *Client) ClearAuth() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.tokens = nil
	c.user = nil
}

// IsAuthenticated returns whether tokens are stored.
func (c *Client) IsAuthenticated() bool {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.tokens != nil && c.tokens.AccessToken != ""
}

// SetOAuthURL sets the OAuth base URL (for testing).
func (c *Client) SetOAuthURL(url string) {
	c.oauthURL = url
}

// SetAPIURL sets the GraphQL API URL (for testing).
func (c *Client) SetAPIURL(url string) {
	c.apiURL = url
}
