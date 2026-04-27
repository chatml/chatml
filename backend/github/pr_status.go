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

// ReviewDecision represents the computed review decision for a PR
type ReviewDecision string

const (
	ReviewApproved         ReviewDecision = "approved"
	ReviewChangesRequested ReviewDecision = "changes_requested"
	ReviewRequired         ReviewDecision = "review_required"
	ReviewNone             ReviewDecision = "none"
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
	Number             int            `json:"number"`
	State              string         `json:"state"`              // "open", "closed"
	Title              string         `json:"title"`
	Body               string         `json:"body"`
	HTMLURL            string         `json:"htmlUrl"`
	Merged             bool           `json:"merged"`             // true if the PR has been merged
	Mergeable          *bool          `json:"mergeable"`          // Can be null while GitHub computes it
	MergeableState     string         `json:"mergeableState"`     // "clean", "dirty", "blocked", "unknown", "unstable"
	CheckStatus        CheckStatus    `json:"checkStatus"`
	CheckDetails       []CheckDetail  `json:"checkDetails"`
	ReviewDecision     ReviewDecision `json:"reviewDecision"`     // "approved", "changes_requested", "review_required", "none"
	RequestedReviewers int            `json:"requestedReviewers"` // Count of pending reviewer requests
}

// githubPR represents the GitHub API response for a pull request
type githubPR struct {
	Number         int    `json:"number"`
	State          string `json:"state"`
	Title          string `json:"title"`
	Body           string `json:"body"`
	HTMLURL        string `json:"html_url"`
	Merged         bool   `json:"merged"`
	Mergeable      *bool  `json:"mergeable"`
	MergeableState string `json:"mergeable_state"`
	Head           struct {
		SHA string `json:"sha"`
	} `json:"head"`
	RequestedReviewers []struct {
		Login string `json:"login"`
	} `json:"requested_reviewers"`
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

// githubReview represents a single review from the GitHub API
type githubReview struct {
	User struct {
		Login string `json:"login"`
	} `json:"user"`
	State string `json:"state"` // "APPROVED", "CHANGES_REQUESTED", "COMMENTED", "DISMISSED", "PENDING"
}

// computeReviewDecision determines the effective review decision from a list of reviews
// and the count of pending reviewer requests.
func computeReviewDecision(reviews []githubReview, requestedReviewers int) ReviewDecision {
	// Track the latest substantive review per user
	latestByUser := make(map[string]string)
	for _, r := range reviews {
		state := r.State
		switch state {
		case "APPROVED", "CHANGES_REQUESTED":
			latestByUser[r.User.Login] = state
		case "DISMISSED":
			// Dismissed cancels the user's previous review
			delete(latestByUser, r.User.Login)
		}
		// COMMENTED and PENDING are not decisions — skip
	}

	hasApproval := false
	for _, state := range latestByUser {
		if state == "CHANGES_REQUESTED" {
			return ReviewChangesRequested
		}
		if state == "APPROVED" {
			hasApproval = true
		}
	}

	if hasApproval {
		return ReviewApproved
	}

	if requestedReviewers > 0 {
		return ReviewRequired
	}

	return ReviewNone
}

// GetPRDetails fetches detailed information about a pull request including CI status
func (c *Client) GetPRDetails(ctx context.Context, owner, repo string, prNumber int) (*PRDetails, error) {
	token, err := c.getValidToken(ctx)
	if err != nil {
		return nil, err
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
		body, readErr := io.ReadAll(resp.Body)
		if readErr != nil {
			return nil, fmt.Errorf("GitHub returned %d (body unreadable: %v)", resp.StatusCode, readErr)
		}
		return nil, fmt.Errorf("GitHub returned %d: %s", resp.StatusCode, body)
	}

	var pr githubPR
	if err := json.NewDecoder(resp.Body).Decode(&pr); err != nil {
		return nil, fmt.Errorf("decoding PR: %w", err)
	}

	details := &PRDetails{
		Number:             pr.Number,
		State:              pr.State,
		Title:              pr.Title,
		Body:               pr.Body,
		HTMLURL:            pr.HTMLURL,
		Merged:             pr.Merged,
		Mergeable:          pr.Mergeable,
		MergeableState:     pr.MergeableState,
		CheckStatus:        CheckStatusNone,
		CheckDetails:       []CheckDetail{},
		ReviewDecision:     ReviewNone,
		RequestedReviewers: len(pr.RequestedReviewers),
	}

	// Fetch combined Statuses (legacy API) concurrently with check-runs so
	// total latency is max(checks, status) instead of checks + status.
	// Always drained below to avoid leaking the goroutine.
	type combinedResult struct {
		combined *CombinedStatus
		err      error
	}
	combinedCh := make(chan combinedResult, 1)
	go func() {
		defer func() {
			if rec := recover(); rec != nil {
				logger.GitHub.Errorf("panic in GetCombinedStatus for %s/%s@%s: %v", owner, repo, pr.Head.SHA, rec)
				combinedCh <- combinedResult{nil, fmt.Errorf("panic: %v", rec)}
			}
		}()
		combined, statusErr := c.GetCombinedStatus(ctx, owner, repo, pr.Head.SHA)
		combinedCh <- combinedResult{combined, statusErr}
	}()

	// Fetch check runs for the PR's head commit. Paginates so PRs with many
	// checks (>30 — GitHub's default page size) aren't silently truncated.
	hasFailure := false
	hasPending := false

	for page := 1; page <= maxCheckRunPages; page++ {
		checksURL := fmt.Sprintf("%s/repos/%s/%s/commits/%s/check-runs?per_page=%d&page=%d", c.apiURL, owner, repo, pr.Head.SHA, pagePerPage, page)
		checksReq, reqErr := http.NewRequestWithContext(ctx, "GET", checksURL, nil)
		if reqErr != nil {
			logger.GitHub.Warnf("check-runs request build failed (page %d) for %s/%s@%s: %v", page, owner, repo, pr.Head.SHA, reqErr)
			break
		}
		checksReq.Header.Set("Authorization", "Bearer "+token)
		checksReq.Header.Set("Accept", "application/vnd.github+json")

		checksResp, doErr := c.httpClient.Do(checksReq)
		if doErr != nil {
			logger.GitHub.Warnf("check-runs fetch failed (page %d) for %s/%s@%s: %v", page, owner, repo, pr.Head.SHA, doErr)
			break
		}

		if checksResp.StatusCode != http.StatusOK {
			body, _ := io.ReadAll(checksResp.Body)
			checksResp.Body.Close()
			logger.GitHub.Warnf("check-runs returned %d (page %d) for %s/%s@%s: %s", checksResp.StatusCode, page, owner, repo, pr.Head.SHA, body)
			break
		}

		var checkRuns githubCheckRuns
		if decodeErr := json.NewDecoder(checksResp.Body).Decode(&checkRuns); decodeErr != nil {
			checksResp.Body.Close()
			logger.GitHub.Warnf("check-runs decode failed (page %d) for %s/%s@%s: %v", page, owner, repo, pr.Head.SHA, decodeErr)
			break
		}
		checksResp.Body.Close()

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

			if run.Status != "completed" {
				hasPending = true
			} else if conclusion == "failure" || conclusion == "timed_out" || conclusion == "action_required" {
				hasFailure = true
			}
		}

		if len(checkRuns.CheckRuns) < pagePerPage || len(details.CheckDetails) >= checkRuns.TotalCount {
			break
		}
	}

	// Always drain the combined-status goroutine, even if check-runs failed,
	// so we don't leak it.
	combinedRes := <-combinedCh

	// Merge legacy Combined Status API (e.g. Vercel previews, custom webhooks,
	// older CIs that post via /statuses). check-runs is the modern API but
	// many tools still use the legacy Statuses API; without merging, those
	// checks are invisible in the panel. Always merge — even if check-runs
	// failed entirely, legacy statuses may be the only signal we have.
	if combinedRes.err == nil && combinedRes.combined != nil {
		existing := make(map[string]bool, len(details.CheckDetails))
		for _, cd := range details.CheckDetails {
			existing[cd.Name] = true
		}
		for _, st := range combinedRes.combined.Statuses {
			if existing[st.Context] {
				continue // check-runs entry wins on name collision (richer data)
			}
			var status, conclusion string
			switch st.State {
			case "success":
				status, conclusion = "completed", "success"
			case "failure", "error":
				status, conclusion = "completed", "failure"
				hasFailure = true
			case "pending":
				status, conclusion = "in_progress", ""
				hasPending = true
			default:
				status, conclusion = st.State, ""
			}
			details.CheckDetails = append(details.CheckDetails, CheckDetail{
				Name:       st.Context,
				Status:     status,
				Conclusion: conclusion,
			})
		}
	}

	// Set aggregated status — empty -> None, otherwise based on flags.
	switch {
	case len(details.CheckDetails) == 0:
		details.CheckStatus = CheckStatusNone
	case hasFailure:
		details.CheckStatus = CheckStatusFailure
	case hasPending:
		details.CheckStatus = CheckStatusPending
	default:
		details.CheckStatus = CheckStatusSuccess
	}

	// Fetch PR reviews to determine review decision
	reviewsURL := fmt.Sprintf("%s/repos/%s/%s/pulls/%d/reviews?per_page=100", c.apiURL, owner, repo, pr.Number)
	reviewsReq, err := http.NewRequestWithContext(ctx, "GET", reviewsURL, nil)
	if err != nil {
		return details, nil
	}

	reviewsReq.Header.Set("Authorization", "Bearer "+token)
	reviewsReq.Header.Set("Accept", "application/vnd.github+json")

	reviewsResp, err := c.httpClient.Do(reviewsReq)
	if err != nil {
		return details, nil
	}
	defer reviewsResp.Body.Close()

	if reviewsResp.StatusCode == http.StatusOK {
		var reviews []githubReview
		if err := json.NewDecoder(reviewsResp.Body).Decode(&reviews); err == nil {
			details.ReviewDecision = computeReviewDecision(reviews, details.RequestedReviewers)
		}
	}

	return details, nil
}

// PRFullDetails contains extended pull request information for session context
type PRFullDetails struct {
	Number       int       `json:"number"`
	State        string    `json:"state"`
	Title        string    `json:"title"`
	HTMLURL      string    `json:"htmlUrl"`
	Body         string    `json:"body"`
	Branch       string    `json:"branch"`     // head ref (source branch)
	BaseBranch   string    `json:"baseBranch"` // base ref (target branch)
	IsDraft      bool      `json:"isDraft"`
	Labels       []string  `json:"labels"`
	Reviewers    []string  `json:"reviewers"`
	Additions    int       `json:"additions"`
	Deletions    int       `json:"deletions"`
	ChangedFiles int       `json:"changedFiles"`
}

// githubPRFull extends the API response to decode additional fields
type githubPRFull struct {
	Number         int    `json:"number"`
	State          string `json:"state"`
	Title          string `json:"title"`
	HTMLURL        string `json:"html_url"`
	Body           string `json:"body"`
	Draft          bool   `json:"draft"`
	Additions      int    `json:"additions"`
	Deletions      int    `json:"deletions"`
	ChangedFiles   int    `json:"changed_files"`
	Head           struct {
		Ref string `json:"ref"`
		SHA string `json:"sha"`
	} `json:"head"`
	Base struct {
		Ref string `json:"ref"`
	} `json:"base"`
	Labels []struct {
		Name string `json:"name"`
	} `json:"labels"`
	RequestedReviewers []struct {
		Login string `json:"login"`
	} `json:"requested_reviewers"`
}

// GetPRFullDetails fetches extended pull request information including body, branch refs,
// labels, reviewers, and diff stats. Used for the "create session from PR" flow.
func (c *Client) GetPRFullDetails(ctx context.Context, owner, repo string, prNumber int) (*PRFullDetails, error) {
	token, err := c.getValidToken(ctx)
	if err != nil {
		return nil, err
	}

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
		return nil, fmt.Errorf("PR #%d not found in %s/%s", prNumber, owner, repo)
	}

	if resp.StatusCode != http.StatusOK {
		body, readErr := io.ReadAll(resp.Body)
		if readErr != nil {
			return nil, fmt.Errorf("GitHub returned %d (body unreadable: %v)", resp.StatusCode, readErr)
		}
		return nil, fmt.Errorf("GitHub returned %d: %s", resp.StatusCode, body)
	}

	var pr githubPRFull
	if err := json.NewDecoder(resp.Body).Decode(&pr); err != nil {
		return nil, fmt.Errorf("decoding PR: %w", err)
	}

	labels := make([]string, len(pr.Labels))
	for i, l := range pr.Labels {
		labels[i] = l.Name
	}

	reviewers := make([]string, len(pr.RequestedReviewers))
	for i, r := range pr.RequestedReviewers {
		reviewers[i] = r.Login
	}

	return &PRFullDetails{
		Number:       pr.Number,
		State:        pr.State,
		Title:        pr.Title,
		HTMLURL:      pr.HTMLURL,
		Body:         pr.Body,
		Branch:       pr.Head.Ref,
		BaseBranch:   pr.Base.Ref,
		IsDraft:      pr.Draft,
		Labels:       labels,
		Reviewers:    reviewers,
		Additions:    pr.Additions,
		Deletions:    pr.Deletions,
		ChangedFiles: pr.ChangedFiles,
	}, nil
}

// GetPRDetailsBatch fetches details for multiple PRs concurrently with rate limiting.
// Returns a map of PR number -> PRDetails and a slice of PR numbers that failed to fetch.
// Uses goroutines with a semaphore to avoid overwhelming the GitHub API (default maxConcurrent is 5).
func (c *Client) GetPRDetailsBatch(ctx context.Context, owner, repo string, prNumbers []int, maxConcurrent int) (map[int]*PRDetails, []int) {
	if maxConcurrent <= 0 {
		maxConcurrent = 3 // default concurrent limit
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

// PRLabel represents a label on a pull request
type PRLabel struct {
	Name  string `json:"name"`
	Color string `json:"color"`
}

// PRListItem represents a pull request in a list response
type PRListItem struct {
	Number  int       `json:"number"`
	State   string    `json:"state"`
	Title   string    `json:"title"`
	HTMLURL string    `json:"htmlUrl"`
	IsDraft bool      `json:"isDraft"`
	Branch  string    `json:"branch"`
	HeadSHA string    `json:"headSha"`
	Labels  []PRLabel `json:"labels"`
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
	Labels []struct {
		Name  string `json:"name"`
		Color string `json:"color"`
	} `json:"labels"`
}

// ErrNotModified is returned when a conditional request receives 304 Not Modified
var ErrNotModified = fmt.Errorf("not modified")

// ListOpenPRsResult contains the result of listing open PRs
type ListOpenPRsResult struct {
	PRs  []PRListItem
	ETag string // Response ETag for conditional requests
}

// ListOpenPRs lists all open pull requests for a repository
func (c *Client) ListOpenPRs(ctx context.Context, owner, repo string) ([]PRListItem, error) {
	result, err := c.ListOpenPRsWithETag(ctx, owner, repo, "")
	if err != nil {
		return nil, err
	}
	return result.PRs, nil
}

// ListOpenPRsWithETag lists open PRs with ETag support for conditional requests.
// If etag is non-empty, sends If-None-Match header. Returns ErrNotModified on 304.
func (c *Client) ListOpenPRsWithETag(ctx context.Context, owner, repo, etag string) (*ListOpenPRsResult, error) {
	token, err := c.getValidToken(ctx)
	if err != nil {
		return nil, err
	}

	// Fetch open PRs (includes drafts)
	prsURL := fmt.Sprintf("%s/repos/%s/%s/pulls?state=open&per_page=100", c.apiURL, owner, repo)
	req, err := http.NewRequestWithContext(ctx, "GET", prsURL, nil)
	if err != nil {
		return nil, fmt.Errorf("creating PRs request: %w", err)
	}

	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/vnd.github+json")
	if etag != "" {
		req.Header.Set("If-None-Match", etag)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("fetching PRs: %w", err)
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

	var ghPRs []githubPRListItem
	if err := json.NewDecoder(resp.Body).Decode(&ghPRs); err != nil {
		return nil, fmt.Errorf("decoding PRs: %w", err)
	}

	prs := make([]PRListItem, len(ghPRs))
	for i, pr := range ghPRs {
		labels := make([]PRLabel, len(pr.Labels))
		for j, label := range pr.Labels {
			labels[j] = PRLabel{
				Name:  label.Name,
				Color: label.Color,
			}
		}
		prs[i] = PRListItem{
			Number:  pr.Number,
			State:   pr.State,
			Title:   pr.Title,
			HTMLURL: pr.HTMLURL,
			IsDraft: pr.Draft,
			Branch:  pr.Head.Ref,
			HeadSHA: pr.Head.SHA,
			Labels:  labels,
		}
	}

	return &ListOpenPRsResult{
		PRs:  prs,
		ETag: resp.Header.Get("ETag"),
	}, nil
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
	token, err := c.getValidToken(ctx)
	if err != nil {
		return 0, err
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
		body, readErr := io.ReadAll(resp.Body)
		if readErr != nil {
			return 0, fmt.Errorf("GitHub returned %d (body unreadable: %v)", resp.StatusCode, readErr)
		}
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

// IsPRMerged checks if a PR was merged using the dedicated GitHub merge endpoint.
// Returns true if the PR has been merged (HTTP 204), false otherwise (HTTP 404).
func (c *Client) IsPRMerged(ctx context.Context, owner, repo string, prNumber int) (bool, error) {
	token, err := c.getValidToken(ctx)
	if err != nil {
		return false, err
	}

	mergeURL := fmt.Sprintf("%s/repos/%s/%s/pulls/%d/merge", c.apiURL, owner, repo, prNumber)
	req, err := http.NewRequestWithContext(ctx, "GET", mergeURL, nil)
	if err != nil {
		return false, fmt.Errorf("creating merge check request: %w", err)
	}

	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/vnd.github+json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return false, fmt.Errorf("checking merge status: %w", err)
	}
	defer resp.Body.Close()

	// 204 = merged, 404 = not merged
	return resp.StatusCode == http.StatusNoContent, nil
}
