package github

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
)

// GitHubRepoDTO represents a GitHub repository for API responses.
type GitHubRepoDTO struct {
	FullName      string `json:"fullName"`
	Name          string `json:"name"`
	Owner         string `json:"owner"`
	Description   string `json:"description"`
	Language      string `json:"language"`
	Private       bool   `json:"private"`
	Fork          bool   `json:"fork"`
	Stars         int    `json:"stargazersCount"`
	CloneURL      string `json:"cloneUrl"`
	SSHURL        string `json:"sshUrl"`
	UpdatedAt     string `json:"updatedAt"`
	DefaultBranch string `json:"defaultBranch"`
}

// GitHubOrgDTO represents a GitHub organization for API responses.
type GitHubOrgDTO struct {
	Login     string `json:"login"`
	AvatarURL string `json:"avatarUrl"`
}

// ListGitHubReposResponse is the response for listing repos.
type ListGitHubReposResponse struct {
	Repos      []GitHubRepoDTO `json:"repos"`
	TotalCount int             `json:"totalCount"`
	HasMore    bool            `json:"hasMore"`
}

// githubRepo is the raw GitHub API representation of a repository.
type githubRepo struct {
	FullName      string    `json:"full_name"`
	Name          string    `json:"name"`
	Owner         githubOwner `json:"owner"`
	Description   string    `json:"description"`
	Language      string    `json:"language"`
	Private       bool      `json:"private"`
	Fork          bool      `json:"fork"`
	Stars         int       `json:"stargazers_count"`
	CloneURL      string    `json:"clone_url"`
	SSHURL        string    `json:"ssh_url"`
	UpdatedAt     string    `json:"updated_at"`
	DefaultBranch string    `json:"default_branch"`
}

type githubOwner struct {
	Login string `json:"login"`
}

// githubOrg is the raw GitHub API representation of an organization.
type githubOrg struct {
	Login     string `json:"login"`
	AvatarURL string `json:"avatar_url"`
}

func repoToDTO(r githubRepo) GitHubRepoDTO {
	return GitHubRepoDTO{
		FullName:      r.FullName,
		Name:          r.Name,
		Owner:         r.Owner.Login,
		Description:   r.Description,
		Language:      r.Language,
		Private:       r.Private,
		Fork:          r.Fork,
		Stars:         r.Stars,
		CloneURL:      r.CloneURL,
		SSHURL:        r.SSHURL,
		UpdatedAt:     r.UpdatedAt,
		DefaultBranch: r.DefaultBranch,
	}
}

func orgToDTO(o githubOrg) GitHubOrgDTO {
	return GitHubOrgDTO{
		Login:     o.Login,
		AvatarURL: o.AvatarURL,
	}
}

// ListUserRepos lists repositories for the authenticated user.
func (c *Client) ListUserRepos(ctx context.Context, page, perPage int, sort, repoType string) ([]GitHubRepoDTO, bool, error) {
	token, err := c.getValidToken(ctx)
	if err != nil {
		return nil, false, fmt.Errorf("not authenticated: %w", err)
	}

	if page < 1 {
		page = 1
	}
	if perPage < 1 || perPage > 100 {
		perPage = 30
	}
	if sort == "" {
		sort = "updated"
	}
	if repoType == "" {
		repoType = "all"
	}

	reqURL := fmt.Sprintf("%s/user/repos?page=%d&per_page=%d&sort=%s&type=%s",
		c.apiURL, page, perPage, url.QueryEscape(sort), url.QueryEscape(repoType))

	repos, hasMore, err := c.fetchRepos(ctx, token, reqURL, perPage)
	if err != nil {
		return nil, false, fmt.Errorf("listing user repos: %w", err)
	}

	return repos, hasMore, nil
}

// ListOrgRepos lists repositories for a specific organization.
func (c *Client) ListOrgRepos(ctx context.Context, org string, page, perPage int, sort string) ([]GitHubRepoDTO, bool, error) {
	token, err := c.getValidToken(ctx)
	if err != nil {
		return nil, false, fmt.Errorf("not authenticated: %w", err)
	}

	if page < 1 {
		page = 1
	}
	if perPage < 1 || perPage > 100 {
		perPage = 30
	}
	if sort == "" {
		sort = "updated"
	}

	reqURL := fmt.Sprintf("%s/orgs/%s/repos?page=%d&per_page=%d&sort=%s&type=all",
		c.apiURL, url.PathEscape(org), page, perPage, url.QueryEscape(sort))

	repos, hasMore, err := c.fetchRepos(ctx, token, reqURL, perPage)
	if err != nil {
		return nil, false, fmt.Errorf("listing org repos for %s: %w", org, err)
	}

	return repos, hasMore, nil
}

// ListUserOrgs lists organizations for the authenticated user.
func (c *Client) ListUserOrgs(ctx context.Context) ([]GitHubOrgDTO, error) {
	token, err := c.getValidToken(ctx)
	if err != nil {
		return nil, fmt.Errorf("not authenticated: %w", err)
	}

	reqURL := fmt.Sprintf("%s/user/orgs?per_page=100", c.apiURL)

	req, err := http.NewRequestWithContext(ctx, "GET", reqURL, nil)
	if err != nil {
		return nil, fmt.Errorf("creating request: %w", err)
	}

	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("fetching orgs: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("GitHub returned %d: %s", resp.StatusCode, body)
	}

	var rawOrgs []githubOrg
	if err := json.NewDecoder(resp.Body).Decode(&rawOrgs); err != nil {
		return nil, fmt.Errorf("decoding orgs: %w", err)
	}

	orgs := make([]GitHubOrgDTO, len(rawOrgs))
	for i, o := range rawOrgs {
		orgs[i] = orgToDTO(o)
	}

	return orgs, nil
}

// GetRepoInfo fetches metadata for a specific repository.
func (c *Client) GetRepoInfo(ctx context.Context, owner, repo string) (*GitHubRepoDTO, error) {
	token, err := c.getValidToken(ctx)
	if err != nil {
		return nil, fmt.Errorf("not authenticated: %w", err)
	}

	reqURL := fmt.Sprintf("%s/repos/%s/%s", c.apiURL, url.PathEscape(owner), url.PathEscape(repo))

	req, err := http.NewRequestWithContext(ctx, "GET", reqURL, nil)
	if err != nil {
		return nil, fmt.Errorf("creating request: %w", err)
	}

	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("fetching repo: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotFound {
		return nil, fmt.Errorf("repository %s/%s not found", owner, repo)
	}

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("GitHub returned %d: %s", resp.StatusCode, body)
	}

	var raw githubRepo
	if err := json.NewDecoder(resp.Body).Decode(&raw); err != nil {
		return nil, fmt.Errorf("decoding repo: %w", err)
	}

	dto := repoToDTO(raw)
	return &dto, nil
}

// searchResult is the raw GitHub search API response.
type searchResult struct {
	Items []githubRepo `json:"items"`
	Total int          `json:"total_count"`
}

// SearchUserRepos searches repositories accessible to the authenticated user.
// Uses the GitHub search API which searches across all repos, not just the current page.
func (c *Client) SearchUserRepos(ctx context.Context, query string, org string, page, perPage int) ([]GitHubRepoDTO, bool, error) {
	token, err := c.getValidToken(ctx)
	if err != nil {
		return nil, false, fmt.Errorf("not authenticated: %w", err)
	}

	if page < 1 {
		page = 1
	}
	if perPage < 1 || perPage > 100 {
		perPage = 30
	}

	// Build the search query: "query in:name,description" scoped to user or org
	q := url.QueryEscape(query)
	if org != "" {
		q += "+org:" + url.QueryEscape(org)
	} else {
		q += "+user:@me+fork:true"
	}

	reqURL := fmt.Sprintf("%s/search/repositories?q=%s&page=%d&per_page=%d&sort=updated&order=desc",
		c.apiURL, q, page, perPage)

	req, err := http.NewRequestWithContext(ctx, "GET", reqURL, nil)
	if err != nil {
		return nil, false, fmt.Errorf("creating request: %w", err)
	}

	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, false, fmt.Errorf("searching repos: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, false, fmt.Errorf("GitHub returned %d: %s", resp.StatusCode, body)
	}

	var result searchResult
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, false, fmt.Errorf("decoding search results: %w", err)
	}

	repos := make([]GitHubRepoDTO, len(result.Items))
	for i, r := range result.Items {
		repos[i] = repoToDTO(r)
	}

	hasMore := page*perPage < result.Total

	return repos, hasMore, nil
}

// fetchRepos is a shared helper to fetch and parse a list of repos from the GitHub API.
// Returns the parsed repos and whether there are more pages available.
func (c *Client) fetchRepos(ctx context.Context, token, reqURL string, perPage int) ([]GitHubRepoDTO, bool, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", reqURL, nil)
	if err != nil {
		return nil, false, fmt.Errorf("creating request: %w", err)
	}

	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, false, fmt.Errorf("fetching repos: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotFound {
		return nil, false, fmt.Errorf("not found")
	}

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, false, fmt.Errorf("GitHub returned %d: %s", resp.StatusCode, body)
	}

	var rawRepos []githubRepo
	if err := json.NewDecoder(resp.Body).Decode(&rawRepos); err != nil {
		return nil, false, fmt.Errorf("decoding repos: %w", err)
	}

	repos := make([]GitHubRepoDTO, len(rawRepos))
	for i, r := range rawRepos {
		repos[i] = repoToDTO(r)
	}

	// Determine if there are more pages by checking the count returned
	hasMore := len(rawRepos) >= perPage

	// Also check Link header for next page
	if link := resp.Header.Get("Link"); link != "" {
		// If Link header contains rel="next", there are more pages
		if containsNextLink(link) {
			hasMore = true
		}
	}

	return repos, hasMore, nil
}

// containsNextLink checks if a Link header contains a rel="next" link.
func containsNextLink(link string) bool {
	// Simple check — GitHub Link headers look like:
	// <https://api.github.com/user/repos?page=2>; rel="next", <...>; rel="last"
	return strings.Contains(link, `rel="next"`) || strings.Contains(link, `rel='next'`)
}

// ParsePageParam parses an integer query parameter with a default value.
func ParsePageParam(s string, defaultVal int) int {
	if s == "" {
		return defaultVal
	}
	v, err := strconv.Atoi(s)
	if err != nil || v < 1 {
		return defaultVal
	}
	return v
}
