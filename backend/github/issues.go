package github

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// IssueLabel represents a label on a GitHub issue
type IssueLabel struct {
	Name  string `json:"name"`
	Color string `json:"color"`
}

// IssueUser represents a GitHub user on an issue
type IssueUser struct {
	Login     string `json:"login"`
	AvatarURL string `json:"avatarUrl"`
}

// IssueMilestone represents a milestone on an issue
type IssueMilestone struct {
	Number int    `json:"number"`
	Title  string `json:"title"`
	State  string `json:"state"`
}

// IssueListItem represents an issue in a list response
type IssueListItem struct {
	Number    int          `json:"number"`
	Title     string       `json:"title"`
	State     string       `json:"state"`
	HTMLURL   string       `json:"htmlUrl"`
	Labels    []IssueLabel `json:"labels"`
	User      IssueUser    `json:"user"`
	Assignees []IssueUser  `json:"assignees"`
	Comments  int          `json:"comments"`
	CreatedAt time.Time    `json:"createdAt"`
	UpdatedAt time.Time    `json:"updatedAt"`
}

// IssueDetails extends IssueListItem with body and milestone
type IssueDetails struct {
	IssueListItem
	Body      string          `json:"body"`
	Milestone *IssueMilestone `json:"milestone,omitempty"`
}

// ListIssuesResult contains the result of listing issues
type ListIssuesResult struct {
	Issues []IssueListItem
	ETag   string
}

// SearchIssuesResult contains the result of searching issues
type SearchIssuesResult struct {
	TotalCount int             `json:"totalCount"`
	Issues     []IssueListItem `json:"issues"`
}

// githubIssueListItem maps the GitHub API response shape for an issue
type githubIssueListItem struct {
	Number    int       `json:"number"`
	Title     string    `json:"title"`
	State     string    `json:"state"`
	HTMLURL   string    `json:"html_url"`
	Body      string    `json:"body"`
	Comments  int       `json:"comments"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
	Labels    []struct {
		Name  string `json:"name"`
		Color string `json:"color"`
	} `json:"labels"`
	User struct {
		Login     string `json:"login"`
		AvatarURL string `json:"avatar_url"`
	} `json:"user"`
	Assignees []struct {
		Login     string `json:"login"`
		AvatarURL string `json:"avatar_url"`
	} `json:"assignees"`
	Milestone *struct {
		Number int    `json:"number"`
		Title  string `json:"title"`
		State  string `json:"state"`
	} `json:"milestone"`
	PullRequest *struct {
		URL string `json:"url"`
	} `json:"pull_request"`
}

// githubSearchIssuesResponse maps the GitHub search API response
type githubSearchIssuesResponse struct {
	TotalCount int                   `json:"total_count"`
	Items      []githubIssueListItem `json:"items"`
}

// convertToIssueListItem converts a GitHub API issue to our IssueListItem type
func convertToIssueListItem(gh githubIssueListItem) IssueListItem {
	labels := make([]IssueLabel, len(gh.Labels))
	for i, l := range gh.Labels {
		labels[i] = IssueLabel{Name: l.Name, Color: l.Color}
	}

	assignees := make([]IssueUser, len(gh.Assignees))
	for i, a := range gh.Assignees {
		assignees[i] = IssueUser{Login: a.Login, AvatarURL: a.AvatarURL}
	}

	return IssueListItem{
		Number:    gh.Number,
		Title:     gh.Title,
		State:     gh.State,
		HTMLURL:   gh.HTMLURL,
		Labels:    labels,
		User:      IssueUser{Login: gh.User.Login, AvatarURL: gh.User.AvatarURL},
		Assignees: assignees,
		Comments:  gh.Comments,
		CreatedAt: gh.CreatedAt,
		UpdatedAt: gh.UpdatedAt,
	}
}

// ListIssuesWithETag lists issues for a repository with ETag support for conditional requests.
// If etag is non-empty, sends If-None-Match header. Returns ErrNotModified on 304.
// Filters out pull requests (GitHub's issues endpoint returns both).
func (c *Client) ListIssuesWithETag(ctx context.Context, owner, repo, state, labels, etag string) (*ListIssuesResult, error) {
	token, err := c.getValidToken(ctx)
	if err != nil {
		return nil, err
	}

	if state == "" {
		state = "open"
	}

	params := url.Values{}
	params.Set("state", state)
	params.Set("sort", "updated")
	params.Set("direction", "desc")
	params.Set("per_page", "50")
	if labels != "" {
		params.Set("labels", labels)
	}

	issuesURL := fmt.Sprintf("%s/repos/%s/%s/issues?%s", c.apiURL, owner, repo, params.Encode())
	req, err := http.NewRequestWithContext(ctx, "GET", issuesURL, nil)
	if err != nil {
		return nil, fmt.Errorf("creating issues request: %w", err)
	}

	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/vnd.github+json")
	if etag != "" {
		req.Header.Set("If-None-Match", etag)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("fetching issues: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotModified {
		return nil, ErrNotModified
	}

	if resp.StatusCode != http.StatusOK {
		body, readErr := io.ReadAll(resp.Body)
		if readErr != nil {
			return nil, fmt.Errorf("GitHub returned %d (body unreadable: %v)", resp.StatusCode, readErr)
		}
		return nil, fmt.Errorf("GitHub returned %d: %s", resp.StatusCode, body)
	}

	var ghIssues []githubIssueListItem
	if err := json.NewDecoder(resp.Body).Decode(&ghIssues); err != nil {
		return nil, fmt.Errorf("decoding issues: %w", err)
	}

	// Filter out pull requests (GitHub issues endpoint returns both)
	issues := make([]IssueListItem, 0, len(ghIssues))
	for _, gh := range ghIssues {
		if gh.PullRequest != nil {
			continue
		}
		issues = append(issues, convertToIssueListItem(gh))
	}

	return &ListIssuesResult{
		Issues: issues,
		ETag:   resp.Header.Get("ETag"),
	}, nil
}

// SearchIssues searches for issues in a repository using the GitHub search API.
// The query is appended to the repo scope: repo:{owner}/{repo} is:issue {query}
func (c *Client) SearchIssues(ctx context.Context, owner, repo, query string) (*SearchIssuesResult, error) {
	token, err := c.getValidToken(ctx)
	if err != nil {
		return nil, err
	}

	// Build search query: repo:owner/repo is:issue <user query>
	searchQuery := fmt.Sprintf("repo:%s/%s is:issue %s", owner, repo, query)

	params := url.Values{}
	params.Set("q", searchQuery)
	params.Set("per_page", "30")

	searchURL := fmt.Sprintf("%s/search/issues?%s", c.apiURL, params.Encode())
	req, err := http.NewRequestWithContext(ctx, "GET", searchURL, nil)
	if err != nil {
		return nil, fmt.Errorf("creating search request: %w", err)
	}

	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/vnd.github+json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("searching issues: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, readErr := io.ReadAll(resp.Body)
		if readErr != nil {
			return nil, fmt.Errorf("GitHub returned %d (body unreadable: %v)", resp.StatusCode, readErr)
		}
		return nil, fmt.Errorf("GitHub returned %d: %s", resp.StatusCode, body)
	}

	var ghResult githubSearchIssuesResponse
	if err := json.NewDecoder(resp.Body).Decode(&ghResult); err != nil {
		return nil, fmt.Errorf("decoding search results: %w", err)
	}

	// Filter out pull requests (search API also returns PRs)
	issues := make([]IssueListItem, 0, len(ghResult.Items))
	for _, gh := range ghResult.Items {
		if gh.PullRequest != nil {
			continue
		}
		issues = append(issues, convertToIssueListItem(gh))
	}

	return &SearchIssuesResult{
		TotalCount: len(issues),
		Issues:     issues,
	}, nil
}

// GetIssue fetches detailed information about a single issue.
// Returns nil, nil if the issue is not found (404).
func (c *Client) GetIssue(ctx context.Context, owner, repo string, number int) (*IssueDetails, error) {
	token, err := c.getValidToken(ctx)
	if err != nil {
		return nil, err
	}

	issueURL := fmt.Sprintf("%s/repos/%s/%s/issues/%d", c.apiURL, owner, repo, number)
	req, err := http.NewRequestWithContext(ctx, "GET", issueURL, nil)
	if err != nil {
		return nil, fmt.Errorf("creating issue request: %w", err)
	}

	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/vnd.github+json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("fetching issue: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotFound {
		return nil, nil
	}

	if resp.StatusCode != http.StatusOK {
		body, readErr := io.ReadAll(resp.Body)
		if readErr != nil {
			return nil, fmt.Errorf("GitHub returned %d (body unreadable: %v)", resp.StatusCode, readErr)
		}
		return nil, fmt.Errorf("GitHub returned %d: %s", resp.StatusCode, body)
	}

	var gh githubIssueListItem
	if err := json.NewDecoder(resp.Body).Decode(&gh); err != nil {
		return nil, fmt.Errorf("decoding issue: %w", err)
	}

	var milestone *IssueMilestone
	if gh.Milestone != nil {
		milestone = &IssueMilestone{
			Number: gh.Milestone.Number,
			Title:  gh.Milestone.Title,
			State:  gh.Milestone.State,
		}
	}

	// Trim trailing whitespace/newlines from body
	body := strings.TrimSpace(gh.Body)

	return &IssueDetails{
		IssueListItem: convertToIssueListItem(gh),
		Body:          body,
		Milestone:     milestone,
	}, nil
}
