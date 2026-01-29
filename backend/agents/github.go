package agents

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// GitHubAdapter polls GitHub for issues and pull requests
type GitHubAdapter struct {
	token      string
	httpClient *http.Client
	cache      *PollingCache
	apiURL     string
}

// GitHubIssue represents a GitHub issue or PR
type GitHubIssue struct {
	Number    int           `json:"number"`
	Title     string        `json:"title"`
	Body      string        `json:"body"`
	State     string        `json:"state"`
	HTMLURL   string        `json:"html_url"`
	Labels    []GitHubLabel `json:"labels"`
	User      GitHubUser    `json:"user"`
	Assignees []GitHubUser  `json:"assignees"`
	CreatedAt time.Time     `json:"created_at"`
	UpdatedAt time.Time     `json:"updated_at"`
	ClosedAt  *time.Time    `json:"closed_at"`

	// PR-specific fields (only present for PRs)
	PullRequest *GitHubPRRef `json:"pull_request,omitempty"`
}

// GitHubLabel represents a GitHub label
type GitHubLabel struct {
	ID    int64  `json:"id"`
	Name  string `json:"name"`
	Color string `json:"color"`
}

// GitHubUser represents a GitHub user
type GitHubUser struct {
	Login     string `json:"login"`
	AvatarURL string `json:"avatar_url"`
}

// GitHubPRRef indicates this issue is a PR (contains URL)
type GitHubPRRef struct {
	URL string `json:"url"`
}

// GitHubPollResult holds the result of a GitHub poll
type GitHubPollResult struct {
	Issues       []GitHubIssue
	PullRequests []GitHubIssue
	NotModified  bool
	RateLimit    GitHubRateLimit
}

// GitHubRateLimit holds rate limit information
type GitHubRateLimit struct {
	Limit     int
	Remaining int
	Reset     time.Time
}

// NewGitHubAdapter creates a new GitHub polling adapter
func NewGitHubAdapter(token string) *GitHubAdapter {
	return &GitHubAdapter{
		token:      token,
		httpClient: &http.Client{Timeout: 30 * time.Second},
		cache:      NewPollingCache(5 * time.Minute),
		apiURL:     "https://api.github.com",
	}
}

// SetToken updates the GitHub token
func (g *GitHubAdapter) SetToken(token string) {
	g.token = token
}

// Poll fetches issues and PRs from a repository
func (g *GitHubAdapter) Poll(ctx context.Context, owner, repo string, filters map[string]interface{}) (*GitHubPollResult, error) {
	result := &GitHubPollResult{}

	// Determine what resources to fetch
	resources := []string{"issues"}
	if r, ok := filters["resources"].([]string); ok {
		resources = r
	} else if r, ok := filters["resources"].([]interface{}); ok {
		resources = make([]string, len(r))
		for i, v := range r {
			resources[i] = fmt.Sprintf("%v", v)
		}
	}

	for _, resource := range resources {
		switch resource {
		case "issues":
			issues, notModified, rateLimit, err := g.fetchIssues(ctx, owner, repo, filters, false)
			if err != nil {
				return nil, fmt.Errorf("fetch issues: %w", err)
			}
			result.Issues = issues
			result.NotModified = result.NotModified || notModified
			result.RateLimit = rateLimit

		case "pull_requests", "pulls":
			prs, notModified, rateLimit, err := g.fetchIssues(ctx, owner, repo, filters, true)
			if err != nil {
				return nil, fmt.Errorf("fetch pull requests: %w", err)
			}
			result.PullRequests = prs
			result.NotModified = result.NotModified || notModified
			result.RateLimit = rateLimit
		}
	}

	return result, nil
}

// fetchIssues fetches issues or PRs from GitHub
func (g *GitHubAdapter) fetchIssues(ctx context.Context, owner, repo string, filters map[string]interface{}, pullsOnly bool) ([]GitHubIssue, bool, GitHubRateLimit, error) {
	// Build cache key
	cacheKey := fmt.Sprintf("github:%s/%s:issues:%v", owner, repo, pullsOnly)

	// Build URL with query params
	endpoint := fmt.Sprintf("/repos/%s/%s/issues", owner, repo)
	params := url.Values{}

	// Apply filters
	if state, ok := filters["state"].(string); ok {
		params.Set("state", state)
	} else {
		params.Set("state", "open")
	}

	if labels, ok := filters["labels"].([]string); ok && len(labels) > 0 {
		params.Set("labels", strings.Join(labels, ","))
	} else if labels, ok := filters["labels"].([]interface{}); ok && len(labels) > 0 {
		labelStrs := make([]string, len(labels))
		for i, l := range labels {
			labelStrs[i] = fmt.Sprintf("%v", l)
		}
		params.Set("labels", strings.Join(labelStrs, ","))
	}

	if assignee, ok := filters["assignee"].(string); ok {
		params.Set("assignee", assignee)
	}

	// Sort by updated to catch recent changes
	params.Set("sort", "updated")
	params.Set("direction", "desc")
	params.Set("per_page", "30")

	fullURL := g.apiURL + endpoint + "?" + params.Encode()

	// Create request
	req, err := http.NewRequestWithContext(ctx, "GET", fullURL, nil)
	if err != nil {
		return nil, false, GitHubRateLimit{}, fmt.Errorf("create request: %w", err)
	}

	// Set headers
	req.Header.Set("Accept", "application/vnd.github.v3+json")
	if g.token != "" {
		req.Header.Set("Authorization", "Bearer "+g.token)
	}

	// Add ETag for conditional request
	if etag := g.cache.GetETag(cacheKey); etag != "" {
		req.Header.Set("If-None-Match", etag)
	}

	// Make request
	resp, err := g.httpClient.Do(req)
	if err != nil {
		return nil, false, GitHubRateLimit{}, fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	// Parse rate limit headers
	rateLimit := parseRateLimit(resp.Header)

	// Handle 304 Not Modified
	if resp.StatusCode == http.StatusNotModified {
		// Return cached data
		if entry, ok := g.cache.Get(cacheKey); ok {
			if issues, ok := entry.Data.([]GitHubIssue); ok {
				return filterIssues(issues, pullsOnly), true, rateLimit, nil
			}
		}
		return nil, true, rateLimit, nil
	}

	// Handle errors
	if resp.StatusCode != http.StatusOK {
		body, readErr := io.ReadAll(resp.Body)
		if readErr != nil {
			return nil, false, rateLimit, fmt.Errorf("GitHub API error %d (body unreadable: %v)", resp.StatusCode, readErr)
		}
		return nil, false, rateLimit, fmt.Errorf("GitHub API error %d: %s", resp.StatusCode, body)
	}

	// Parse response
	var issues []GitHubIssue
	if err := json.NewDecoder(resp.Body).Decode(&issues); err != nil {
		return nil, false, rateLimit, fmt.Errorf("decode response: %w", err)
	}

	// Cache the response
	etag := resp.Header.Get("ETag")
	if etag != "" {
		g.cache.Set(cacheKey, etag, issues)
	}

	return filterIssues(issues, pullsOnly), false, rateLimit, nil
}

// filterIssues separates issues from PRs
func filterIssues(issues []GitHubIssue, pullsOnly bool) []GitHubIssue {
	result := make([]GitHubIssue, 0)
	for _, issue := range issues {
		isPR := issue.PullRequest != nil
		if pullsOnly && isPR {
			result = append(result, issue)
		} else if !pullsOnly && !isPR {
			result = append(result, issue)
		}
	}
	return result
}

// parseRateLimit extracts rate limit info from response headers
func parseRateLimit(header http.Header) GitHubRateLimit {
	rl := GitHubRateLimit{}

	if v := header.Get("X-RateLimit-Limit"); v != "" {
		rl.Limit, _ = strconv.Atoi(v)
	}
	if v := header.Get("X-RateLimit-Remaining"); v != "" {
		rl.Remaining, _ = strconv.Atoi(v)
	}
	if v := header.Get("X-RateLimit-Reset"); v != "" {
		if ts, err := strconv.ParseInt(v, 10, 64); err == nil {
			rl.Reset = time.Unix(ts, 0)
		}
	}

	return rl
}

// GetRateLimit fetches current rate limit status
func (g *GitHubAdapter) GetRateLimit(ctx context.Context) (*GitHubRateLimit, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", g.apiURL+"/rate_limit", nil)
	if err != nil {
		return nil, err
	}

	req.Header.Set("Accept", "application/vnd.github.v3+json")
	if g.token != "" {
		req.Header.Set("Authorization", "Bearer "+g.token)
	}

	resp, err := g.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	rl := parseRateLimit(resp.Header)
	return &rl, nil
}

// IsRateLimited checks if we're currently rate limited
func (g *GitHubAdapter) IsRateLimited(rl GitHubRateLimit) bool {
	return rl.Remaining == 0 && time.Now().Before(rl.Reset)
}

// TimeUntilReset returns duration until rate limit resets
func (g *GitHubAdapter) TimeUntilReset(rl GitHubRateLimit) time.Duration {
	if time.Now().After(rl.Reset) {
		return 0
	}
	return time.Until(rl.Reset)
}
