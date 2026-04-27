package github

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"time"
)

// maxLogSize is the maximum size of job logs to download (50MB)
const maxLogSize = 50 * 1024 * 1024

// Pagination caps. Each page is up to 100 items, so 5 pages = 500 items.
// Beyond this, the panel UX would be unwieldy and we'd risk runaway responses.
// The cap is a hard safety net: the loop normally terminates earlier on
// `len(page) < pagePerPage` or once we've accumulated `total_count` items.
const (
	maxWorkflowRunPages = 5
	maxWorkflowJobPages = 5
	maxCheckRunPages    = 5
	pagePerPage         = 100
)

// WorkflowRun represents a GitHub Actions workflow run
type WorkflowRun struct {
	ID         int64     `json:"id"`
	Name       string    `json:"name"`
	Status     string    `json:"status"`     // queued, in_progress, completed, waiting, requested, pending
	Conclusion string    `json:"conclusion"` // success, failure, neutral, cancelled, skipped, timed_out, action_required, stale
	HeadSHA    string    `json:"headSha"`
	HeadBranch string    `json:"headBranch"`
	HTMLURL    string    `json:"htmlUrl"`
	JobsURL    string    `json:"jobsUrl"`
	LogsURL    string    `json:"logsUrl"`
	CreatedAt  time.Time `json:"createdAt"`
	UpdatedAt  time.Time `json:"updatedAt"`
}

// WorkflowJob represents a job within a workflow run
type WorkflowJob struct {
	ID          int64     `json:"id"`
	RunID       int64     `json:"runId"`
	Name        string    `json:"name"`
	Status      string    `json:"status"`     // queued, in_progress, completed, waiting, requested, pending
	Conclusion  string    `json:"conclusion"` // success, failure, neutral, cancelled, skipped, timed_out, action_required
	StartedAt   time.Time `json:"startedAt"`
	CompletedAt time.Time `json:"completedAt"`
	HTMLURL     string    `json:"htmlUrl"`
	Steps       []JobStep `json:"steps"`
}

// JobStep represents a step within a job
type JobStep struct {
	Name        string    `json:"name"`
	Status      string    `json:"status"`     // queued, in_progress, completed
	Conclusion  string    `json:"conclusion"` // success, failure, neutral, cancelled, skipped
	Number      int       `json:"number"`
	StartedAt   time.Time `json:"startedAt"`
	CompletedAt time.Time `json:"completedAt"`
}

// GitHub API response types (internal)
type githubWorkflowRunsResponse struct {
	TotalCount   int                 `json:"total_count"`
	WorkflowRuns []githubWorkflowRun `json:"workflow_runs"`
}

type githubWorkflowRun struct {
	ID         int64     `json:"id"`
	Name       string    `json:"name"`
	Status     string    `json:"status"`
	Conclusion *string   `json:"conclusion"`
	HeadSHA    string    `json:"head_sha"`
	HeadBranch string    `json:"head_branch"`
	HTMLURL    string    `json:"html_url"`
	JobsURL    string    `json:"jobs_url"`
	LogsURL    string    `json:"logs_url"`
	CreatedAt  time.Time `json:"created_at"`
	UpdatedAt  time.Time `json:"updated_at"`
}

type githubJobsResponse struct {
	TotalCount int         `json:"total_count"`
	Jobs       []githubJob `json:"jobs"`
}

type githubJob struct {
	ID          int64          `json:"id"`
	RunID       int64          `json:"run_id"`
	Name        string         `json:"name"`
	Status      string         `json:"status"`
	Conclusion  *string        `json:"conclusion"`
	StartedAt   time.Time      `json:"started_at"`
	CompletedAt *time.Time     `json:"completed_at"`
	HTMLURL     string         `json:"html_url"`
	Steps       []githubStep   `json:"steps"`
}

type githubStep struct {
	Name        string     `json:"name"`
	Status      string     `json:"status"`
	Conclusion  *string    `json:"conclusion"`
	Number      int        `json:"number"`
	StartedAt   *time.Time `json:"started_at"`
	CompletedAt *time.Time `json:"completed_at"`
}

// ListWorkflowRuns lists workflow runs for a repository, optionally filtered by branch.
// Paginates until total_count is reached or maxWorkflowRunPages is hit, so repos with
// many recent runs don't silently truncate at the first page.
func (c *Client) ListWorkflowRuns(ctx context.Context, owner, repo, branch string) ([]WorkflowRun, error) {
	token, err := c.getValidToken(ctx)
	if err != nil {
		return nil, err
	}

	var runs []WorkflowRun
	for page := 1; page <= maxWorkflowRunPages; page++ {
		q := url.Values{}
		q.Set("per_page", strconv.Itoa(pagePerPage))
		q.Set("page", strconv.Itoa(page))
		if branch != "" {
			q.Set("branch", branch)
		}
		reqURL := fmt.Sprintf("%s/repos/%s/%s/actions/runs?%s", c.apiURL, owner, repo, q.Encode())

		req, err := http.NewRequestWithContext(ctx, "GET", reqURL, nil)
		if err != nil {
			return nil, fmt.Errorf("creating request: %w", err)
		}
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set("Accept", "application/vnd.github+json")

		resp, err := c.httpClient.Do(req)
		if err != nil {
			return nil, fmt.Errorf("fetching workflow runs: %w", err)
		}

		if resp.StatusCode != http.StatusOK {
			body, _ := io.ReadAll(resp.Body)
			resp.Body.Close()
			return nil, fmt.Errorf("GitHub returned %d: %s", resp.StatusCode, body)
		}

		var ghResp githubWorkflowRunsResponse
		if err := json.NewDecoder(resp.Body).Decode(&ghResp); err != nil {
			resp.Body.Close()
			return nil, fmt.Errorf("decoding response: %w", err)
		}
		resp.Body.Close()

		for _, run := range ghResp.WorkflowRuns {
			conclusion := ""
			if run.Conclusion != nil {
				conclusion = *run.Conclusion
			}
			runs = append(runs, WorkflowRun{
				ID:         run.ID,
				Name:       run.Name,
				Status:     run.Status,
				Conclusion: conclusion,
				HeadSHA:    run.HeadSHA,
				HeadBranch: run.HeadBranch,
				HTMLURL:    run.HTMLURL,
				JobsURL:    run.JobsURL,
				LogsURL:    run.LogsURL,
				CreatedAt:  run.CreatedAt,
				UpdatedAt:  run.UpdatedAt,
			})
		}

		// Stop when this page returned fewer than per_page items, or we've reached total_count.
		if len(ghResp.WorkflowRuns) < pagePerPage || len(runs) >= ghResp.TotalCount {
			break
		}
	}

	return runs, nil
}

// GetWorkflowRun fetches a specific workflow run by ID
func (c *Client) GetWorkflowRun(ctx context.Context, owner, repo string, runID int64) (*WorkflowRun, error) {
	token, err := c.getValidToken(ctx)
	if err != nil {
		return nil, err
	}

	url := fmt.Sprintf("%s/repos/%s/%s/actions/runs/%d", c.apiURL, owner, repo, runID)

	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return nil, fmt.Errorf("creating request: %w", err)
	}

	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/vnd.github+json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("fetching workflow run: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotFound {
		return nil, nil
	}

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("GitHub returned %d: %s", resp.StatusCode, body)
	}

	var run githubWorkflowRun
	if err := json.NewDecoder(resp.Body).Decode(&run); err != nil {
		return nil, fmt.Errorf("decoding response: %w", err)
	}

	conclusion := ""
	if run.Conclusion != nil {
		conclusion = *run.Conclusion
	}

	return &WorkflowRun{
		ID:         run.ID,
		Name:       run.Name,
		Status:     run.Status,
		Conclusion: conclusion,
		HeadSHA:    run.HeadSHA,
		HeadBranch: run.HeadBranch,
		HTMLURL:    run.HTMLURL,
		JobsURL:    run.JobsURL,
		LogsURL:    run.LogsURL,
		CreatedAt:  run.CreatedAt,
		UpdatedAt:  run.UpdatedAt,
	}, nil
}

// ListWorkflowJobs lists jobs for a workflow run.
// Paginates so large matrix builds (>100 jobs) aren't silently truncated.
func (c *Client) ListWorkflowJobs(ctx context.Context, owner, repo string, runID int64) ([]WorkflowJob, error) {
	token, err := c.getValidToken(ctx)
	if err != nil {
		return nil, err
	}

	var jobs []WorkflowJob
	for page := 1; page <= maxWorkflowJobPages; page++ {
		q := url.Values{}
		q.Set("per_page", strconv.Itoa(pagePerPage))
		q.Set("page", strconv.Itoa(page))
		reqURL := fmt.Sprintf("%s/repos/%s/%s/actions/runs/%d/jobs?%s", c.apiURL, owner, repo, runID, q.Encode())

		req, err := http.NewRequestWithContext(ctx, "GET", reqURL, nil)
		if err != nil {
			return nil, fmt.Errorf("creating request: %w", err)
		}
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set("Accept", "application/vnd.github+json")

		resp, err := c.httpClient.Do(req)
		if err != nil {
			return nil, fmt.Errorf("fetching jobs: %w", err)
		}

		if resp.StatusCode != http.StatusOK {
			body, _ := io.ReadAll(resp.Body)
			resp.Body.Close()
			return nil, fmt.Errorf("GitHub returned %d: %s", resp.StatusCode, body)
		}

		var ghResp githubJobsResponse
		if err := json.NewDecoder(resp.Body).Decode(&ghResp); err != nil {
			resp.Body.Close()
			return nil, fmt.Errorf("decoding response: %w", err)
		}
		resp.Body.Close()

		for _, job := range ghResp.Jobs {
			conclusion := ""
			if job.Conclusion != nil {
				conclusion = *job.Conclusion
			}

			completedAt := time.Time{}
			if job.CompletedAt != nil {
				completedAt = *job.CompletedAt
			}

			steps := make([]JobStep, len(job.Steps))
			for j, step := range job.Steps {
				stepConclusion := ""
				if step.Conclusion != nil {
					stepConclusion = *step.Conclusion
				}
				startedAt := time.Time{}
				if step.StartedAt != nil {
					startedAt = *step.StartedAt
				}
				stepCompletedAt := time.Time{}
				if step.CompletedAt != nil {
					stepCompletedAt = *step.CompletedAt
				}
				steps[j] = JobStep{
					Name:        step.Name,
					Status:      step.Status,
					Conclusion:  stepConclusion,
					Number:      step.Number,
					StartedAt:   startedAt,
					CompletedAt: stepCompletedAt,
				}
			}

			jobs = append(jobs, WorkflowJob{
				ID:          job.ID,
				RunID:       job.RunID,
				Name:        job.Name,
				Status:      job.Status,
				Conclusion:  conclusion,
				StartedAt:   job.StartedAt,
				CompletedAt: completedAt,
				HTMLURL:     job.HTMLURL,
				Steps:       steps,
			})
		}

		if len(ghResp.Jobs) < pagePerPage || len(jobs) >= ghResp.TotalCount {
			break
		}
	}

	return jobs, nil
}

// GetJobLogs fetches logs for a specific job
// The GitHub API returns a 302 redirect to a temporary URL containing the logs
func (c *Client) GetJobLogs(ctx context.Context, owner, repo string, jobID int64) (string, error) {
	token, err := c.getValidToken(ctx)
	if err != nil {
		return "", err
	}

	url := fmt.Sprintf("%s/repos/%s/%s/actions/jobs/%d/logs", c.apiURL, owner, repo, jobID)

	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return "", fmt.Errorf("creating request: %w", err)
	}

	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/vnd.github+json")

	// Use the no-redirect client to handle the 302 manually
	resp, err := c.noRedirectClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("fetching logs redirect: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotFound {
		return "", fmt.Errorf("job logs not found")
	}

	if resp.StatusCode != http.StatusFound {
		body, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("GitHub returned %d: %s", resp.StatusCode, body)
	}

	// Get the redirect URL from the Location header
	redirectURL := resp.Header.Get("Location")
	if redirectURL == "" {
		return "", fmt.Errorf("no redirect URL in response")
	}

	// Fetch the actual logs from the redirect URL (no auth needed)
	logsReq, err := http.NewRequestWithContext(ctx, "GET", redirectURL, nil)
	if err != nil {
		return "", fmt.Errorf("creating logs request: %w", err)
	}

	logsResp, err := c.httpClient.Do(logsReq)
	if err != nil {
		return "", fmt.Errorf("fetching logs: %w", err)
	}
	defer logsResp.Body.Close()

	if logsResp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(logsResp.Body)
		return "", fmt.Errorf("logs endpoint returned %d: %s", logsResp.StatusCode, body)
	}

	logs, err := io.ReadAll(io.LimitReader(logsResp.Body, maxLogSize))
	if err != nil {
		return "", fmt.Errorf("reading logs: %w", err)
	}

	return string(logs), nil
}

// RerunWorkflow triggers a re-run of an entire workflow
func (c *Client) RerunWorkflow(ctx context.Context, owner, repo string, runID int64) error {
	token, err := c.getValidToken(ctx)
	if err != nil {
		return err
	}

	url := fmt.Sprintf("%s/repos/%s/%s/actions/runs/%d/rerun", c.apiURL, owner, repo, runID)

	req, err := http.NewRequestWithContext(ctx, "POST", url, nil)
	if err != nil {
		return fmt.Errorf("creating request: %w", err)
	}

	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/vnd.github+json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("triggering rerun: %w", err)
	}
	defer resp.Body.Close()

	// GitHub returns 201 Created on success
	if resp.StatusCode != http.StatusCreated {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("GitHub returned %d: %s", resp.StatusCode, body)
	}

	return nil
}

// RerunFailedJobs re-runs only the failed jobs in a workflow
func (c *Client) RerunFailedJobs(ctx context.Context, owner, repo string, runID int64) error {
	token, err := c.getValidToken(ctx)
	if err != nil {
		return err
	}

	url := fmt.Sprintf("%s/repos/%s/%s/actions/runs/%d/rerun-failed-jobs", c.apiURL, owner, repo, runID)

	req, err := http.NewRequestWithContext(ctx, "POST", url, nil)
	if err != nil {
		return fmt.Errorf("creating request: %w", err)
	}

	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/vnd.github+json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("triggering rerun: %w", err)
	}
	defer resp.Body.Close()

	// GitHub returns 201 Created on success
	if resp.StatusCode != http.StatusCreated {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("GitHub returned %d: %s", resp.StatusCode, body)
	}

	return nil
}
