package github

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sync"
	"time"

	"github.com/chatml/chatml-backend/logger"
)

// CheckStatus represents the aggregated status of CI checks
type CheckStatus string

const (
	CheckStatusPending CheckStatus = "pending"
	CheckStatusSuccess CheckStatus = "success"
	CheckStatusFailure CheckStatus = "failure"
	CheckStatusNone    CheckStatus = "none"
)

// CheckDetail represents a single CI check run
type CheckDetail struct {
	Name            string `json:"name"`
	Status          string `json:"status"`                    // "queued", "in_progress", "completed"
	Conclusion      string `json:"conclusion"`                // "success", "failure", "neutral", "cancelled", "skipped", "timed_out", "action_required"
	DurationSeconds *int   `json:"durationSeconds,omitempty"` // Duration in seconds (only for completed checks)
}

// PRDetails contains detailed information about a pull request
type PRDetails struct {
	Number         int           `json:"number"`
	State          string        `json:"state"`         // "open", "closed"
	Title          string        `json:"title"`
	HTMLURL        string        `json:"htmlUrl"`
	Mergeable      *bool         `json:"mergeable"`      // Can be null while GitHub computes it
	MergeableState string        `json:"mergeableState"` // "clean", "dirty", "blocked", "unknown", "unstable"
	CheckStatus    CheckStatus   `json:"checkStatus"`
	CheckDetails   []CheckDetail `json:"checkDetails"`
}

// githubPR represents the GitHub API response for a pull request
type githubPR struct {
	Number         int    `json:"number"`
	State          string `json:"state"`
	Title          string `json:"title"`
	HTMLURL        string `json:"html_url"`
	Mergeable      *bool  `json:"mergeable"`
	MergeableState string `json:"mergeable_state"`
	Head           struct {
		SHA string `json:"sha"`
	} `json:"head"`
}

// githubCheckRuns represents the GitHub API response for check runs
type githubCheckRuns struct {
	TotalCount int `json:"total_count"`
	CheckRuns  []struct {
		Name        string  `json:"name"`
		Status      string  `json:"status"`
		Conclusion  *string `json:"conclusion"`
		StartedAt   *string `json:"started_at"`
		CompletedAt *string `json:"completed_at"`
	} `json:"check_runs"`
}

// GetPRDetails fetches detailed information about a pull request including CI status
func (c *Client) GetPRDetails(ctx context.Context, owner, repo string, prNumber int) (*PRDetails, error) {
	token := c.GetToken()
	if token == "" {
		return nil, fmt.Errorf("not authenticated")
	}

	// Fetch PR details
	prURL := fmt.Sprintf("%s/repos/%s/%s/pulls/%d", c.apiURL, owner, repo, prNumber)
	req, err := http.NewRequestWithContext(ctx, "GET", prURL, nil)
	if err != nil {
		return nil, fmt.Errorf("creating PR request: %w", err)
	}

	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/vnd.github+json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("fetching PR: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotFound {
		return nil, nil // PR not found
	}

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("GitHub returned %d: %s", resp.StatusCode, body)
	}

	var pr githubPR
	if err := json.NewDecoder(resp.Body).Decode(&pr); err != nil {
		return nil, fmt.Errorf("decoding PR: %w", err)
	}

	details := &PRDetails{
		Number:         pr.Number,
		State:          pr.State,
		Title:          pr.Title,
		HTMLURL:        pr.HTMLURL,
		Mergeable:      pr.Mergeable,
		MergeableState: pr.MergeableState,
		CheckStatus:    CheckStatusNone,
		CheckDetails:   []CheckDetail{},
	}

	// Fetch check runs for the PR's head commit
	checksURL := fmt.Sprintf("%s/repos/%s/%s/commits/%s/check-runs", c.apiURL, owner, repo, pr.Head.SHA)
	checksReq, err := http.NewRequestWithContext(ctx, "GET", checksURL, nil)
	if err != nil {
		// Don't fail completely if we can't get checks
		return details, nil
	}

	checksReq.Header.Set("Authorization", "Bearer "+token)
	checksReq.Header.Set("Accept", "application/vnd.github+json")

	checksResp, err := c.httpClient.Do(checksReq)
	if err != nil {
		return details, nil
	}
	defer checksResp.Body.Close()

	if checksResp.StatusCode == http.StatusOK {
		var checkRuns githubCheckRuns
		if err := json.NewDecoder(checksResp.Body).Decode(&checkRuns); err == nil {
			details.CheckDetails = make([]CheckDetail, 0, len(checkRuns.CheckRuns))
			hasFailure := false
			hasPending := false

			for _, run := range checkRuns.CheckRuns {
				conclusion := ""
				if run.Conclusion != nil {
					conclusion = *run.Conclusion
				}

				// Calculate duration for completed checks
				var durationSeconds *int
				if run.Status == "completed" && run.StartedAt != nil && run.CompletedAt != nil {
					startTime, err1 := time.Parse(time.RFC3339, *run.StartedAt)
					endTime, err2 := time.Parse(time.RFC3339, *run.CompletedAt)
					if err1 == nil && err2 == nil {
						duration := int(endTime.Sub(startTime).Seconds())
						durationSeconds = &duration
					}
				}

				details.CheckDetails = append(details.CheckDetails, CheckDetail{
					Name:            run.Name,
					Status:          run.Status,
					Conclusion:      conclusion,
					DurationSeconds: durationSeconds,
				})

				// Determine overall check status
				if run.Status != "completed" {
					hasPending = true
				} else if conclusion == "failure" || conclusion == "timed_out" || conclusion == "action_required" {
					hasFailure = true
				}
			}

			// Set aggregated status
			if len(checkRuns.CheckRuns) == 0 {
				details.CheckStatus = CheckStatusNone
			} else if hasFailure {
				details.CheckStatus = CheckStatusFailure
			} else if hasPending {
				details.CheckStatus = CheckStatusPending
			} else {
				details.CheckStatus = CheckStatusSuccess
			}
		}
	}

	return details, nil
}

// GetPRDetailsBatch fetches details for multiple PRs concurrently with rate limiting.
// Returns a map of PR number -> PRDetails and a slice of PR numbers that failed to fetch.
// Uses goroutines with a semaphore to avoid overwhelming the GitHub API (default maxConcurrent is 5).
func (c *Client) GetPRDetailsBatch(ctx context.Context, owner, repo string, prNumbers []int, maxConcurrent int) (map[int]*PRDetails, []int) {
	if maxConcurrent <= 0 {
		maxConcurrent = 5 // default concurrent limit
	}

	results := make(map[int]*PRDetails)
	var failedPRs []int
	var mu sync.Mutex
	var wg sync.WaitGroup
	sem := make(chan struct{}, maxConcurrent)

	for _, prNum := range prNumbers {
		wg.Add(1)

		go func(num int) {
			defer wg.Done()

			// Acquire semaphore inside goroutine so all workers spawn immediately and self-limit
			sem <- struct{}{}
			defer func() { <-sem }()

			details, err := c.GetPRDetails(ctx, owner, repo, num)
			mu.Lock()
			defer mu.Unlock()
			if err != nil {
				logger.GitHub.Errorf("Failed to fetch PR #%d details for %s/%s: %v", num, owner, repo, err)
				failedPRs = append(failedPRs, num)
				return
			}
			if details != nil {
				results[num] = details
			}
		}(prNum)
	}

	wg.Wait()
	return results, failedPRs
}

// PRListItem represents a pull request in a list response
type PRListItem struct {
	Number  int    `json:"number"`
	State   string `json:"state"`
	Title   string `json:"title"`
	HTMLURL string `json:"htmlUrl"`
	IsDraft bool   `json:"isDraft"`
	Branch  string `json:"branch"`
	HeadSHA string `json:"headSha"`
}

// githubPRListItem represents a PR in the GitHub API list response
type githubPRListItem struct {
	Number  int    `json:"number"`
	State   string `json:"state"`
	Title   string `json:"title"`
	HTMLURL string `json:"html_url"`
	Draft   bool   `json:"draft"`
	Head    struct {
		Ref string `json:"ref"`
		SHA string `json:"sha"`
	} `json:"head"`
}

// ListOpenPRs lists all open pull requests for a repository
func (c *Client) ListOpenPRs(ctx context.Context, owner, repo string) ([]PRListItem, error) {
	token := c.GetToken()
	if token == "" {
		return nil, fmt.Errorf("not authenticated")
	}

	// Fetch open PRs (includes drafts)
	prsURL := fmt.Sprintf("%s/repos/%s/%s/pulls?state=open&per_page=100", c.apiURL, owner, repo)
	req, err := http.NewRequestWithContext(ctx, "GET", prsURL, nil)
	if err != nil {
		return nil, fmt.Errorf("creating PRs request: %w", err)
	}

	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/vnd.github+json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("fetching PRs: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("GitHub returned %d: %s", resp.StatusCode, body)
	}

	var ghPRs []githubPRListItem
	if err := json.NewDecoder(resp.Body).Decode(&ghPRs); err != nil {
		return nil, fmt.Errorf("decoding PRs: %w", err)
	}

	prs := make([]PRListItem, len(ghPRs))
	for i, pr := range ghPRs {
		prs[i] = PRListItem{
			Number:  pr.Number,
			State:   pr.State,
			Title:   pr.Title,
			HTMLURL: pr.HTMLURL,
			IsDraft: pr.Draft,
			Branch:  pr.Head.Ref,
			HeadSHA: pr.Head.SHA,
		}
	}

	return prs, nil
}

// githubSearchResult represents the GitHub API response for PR search
type githubSearchResult struct {
	TotalCount int `json:"total_count"`
	Items      []struct {
		Number int `json:"number"`
	} `json:"items"`
}

// FindPRForBranch finds an open PR for a given branch
func (c *Client) FindPRForBranch(ctx context.Context, owner, repo, branch string) (int, error) {
	token := c.GetToken()
	if token == "" {
		return 0, fmt.Errorf("not authenticated")
	}

	// Search for PRs with the given head branch
	searchURL := fmt.Sprintf("%s/repos/%s/%s/pulls?head=%s:%s&state=open",
		c.apiURL, owner, repo, owner, branch)

	req, err := http.NewRequestWithContext(ctx, "GET", searchURL, nil)
	if err != nil {
		return 0, fmt.Errorf("creating search request: %w", err)
	}

	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/vnd.github+json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return 0, fmt.Errorf("searching PRs: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return 0, fmt.Errorf("GitHub returned %d: %s", resp.StatusCode, body)
	}

	var prs []githubPR
	if err := json.NewDecoder(resp.Body).Decode(&prs); err != nil {
		return 0, fmt.Errorf("decoding search results: %w", err)
	}

	if len(prs) == 0 {
		return 0, nil // No open PR found
	}

	return prs[0].Number, nil
}
