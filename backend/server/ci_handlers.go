package server

import (
	"encoding/json"
	"log"
	"net/http"
	"strconv"
	"strings"
	"sync"

	"github.com/chatml/chatml-backend/github"
	"github.com/chatml/chatml-backend/models"
	"github.com/go-chi/chi/v5"
)

// githubContext holds the resolved GitHub owner/repo and session for CI/status handlers.
type githubContext struct {
	owner   string
	repo    string
	session *models.Session
}

// resolveGitHubContext extracts the session, workspace, and GitHub remote info
// from a request. Returns an error response to the client if any step fails.
func (h *Handlers) resolveGitHubContext(w http.ResponseWriter, r *http.Request) (*githubContext, bool) {
	ctx := r.Context()
	sessionID := chi.URLParam(r, "sessionId")

	session, err := h.store.GetSession(ctx, sessionID)
	if err != nil {
		writeDBError(w, err)
		return nil, false
	}
	if session == nil {
		writeNotFound(w, "session")
		return nil, false
	}

	repo, err := h.store.GetRepo(ctx, session.WorkspaceID)
	if err != nil {
		writeDBError(w, err)
		return nil, false
	}
	if repo == nil {
		writeNotFound(w, "workspace")
		return nil, false
	}

	owner, repoName, err := h.repoManager.GetGitHubRemote(ctx, repo.Path)
	if err != nil {
		writeInternalError(w, "failed to get GitHub remote", err)
		return nil, false
	}

	if h.ghClient == nil {
		writeInternalError(w, "GitHub client not configured", nil)
		return nil, false
	}

	if !h.ghClient.IsAuthenticated() {
		writeUnauthorized(w, "GitHub not authenticated")
		return nil, false
	}

	return &githubContext{owner: owner, repo: repoName, session: session}, true
}

// ListCIRuns returns workflow runs for a session's branch
func (h *Handlers) ListCIRuns(w http.ResponseWriter, r *http.Request) {
	ghCtx, ok := h.resolveGitHubContext(w, r)
	if !ok {
		return
	}

	runs, err := h.ghClient.ListWorkflowRuns(r.Context(), ghCtx.owner, ghCtx.repo, ghCtx.session.Branch)
	if err != nil {
		writeBadGateway(w, "failed to list workflow runs", err)
		return
	}

	writeJSON(w, runs)
}

// GetCIRun returns a specific workflow run
func (h *Handlers) GetCIRun(w http.ResponseWriter, r *http.Request) {
	runIDStr := chi.URLParam(r, "runId")
	runID, err := strconv.ParseInt(runIDStr, 10, 64)
	if err != nil {
		writeValidationError(w, "invalid run ID")
		return
	}

	ghCtx, ok := h.resolveGitHubContext(w, r)
	if !ok {
		return
	}

	run, err := h.ghClient.GetWorkflowRun(r.Context(), ghCtx.owner, ghCtx.repo, runID)
	if err != nil {
		writeBadGateway(w, "failed to get workflow run", err)
		return
	}
	if run == nil {
		writeNotFound(w, "workflow run")
		return
	}

	writeJSON(w, run)
}

// ListCIJobs returns jobs for a workflow run
func (h *Handlers) ListCIJobs(w http.ResponseWriter, r *http.Request) {
	runIDStr := chi.URLParam(r, "runId")
	runID, err := strconv.ParseInt(runIDStr, 10, 64)
	if err != nil {
		writeValidationError(w, "invalid run ID")
		return
	}

	ghCtx, ok := h.resolveGitHubContext(w, r)
	if !ok {
		return
	}

	jobs, err := h.ghClient.ListWorkflowJobs(r.Context(), ghCtx.owner, ghCtx.repo, runID)
	if err != nil {
		writeBadGateway(w, "failed to list workflow jobs", err)
		return
	}

	writeJSON(w, jobs)
}

// GetCIJobLogs returns logs for a specific job
func (h *Handlers) GetCIJobLogs(w http.ResponseWriter, r *http.Request) {
	jobIDStr := chi.URLParam(r, "jobId")
	jobID, err := strconv.ParseInt(jobIDStr, 10, 64)
	if err != nil {
		writeValidationError(w, "invalid job ID")
		return
	}

	ghCtx, ok := h.resolveGitHubContext(w, r)
	if !ok {
		return
	}

	logs, err := h.ghClient.GetJobLogs(r.Context(), ghCtx.owner, ghCtx.repo, jobID)
	if err != nil {
		writeBadGateway(w, "failed to get job logs", err)
		return
	}

	writeJSON(w, map[string]interface{}{
		"jobId": jobID,
		"logs":  logs,
	})
}

// RerunCIWorkflow triggers a re-run of a workflow
func (h *Handlers) RerunCIWorkflow(w http.ResponseWriter, r *http.Request) {
	runIDStr := chi.URLParam(r, "runId")
	runID, err := strconv.ParseInt(runIDStr, 10, 64)
	if err != nil {
		writeValidationError(w, "invalid run ID")
		return
	}

	ghCtx, ok := h.resolveGitHubContext(w, r)
	if !ok {
		return
	}

	failedOnly := r.URL.Query().Get("failedOnly") == "true"

	if failedOnly {
		err = h.ghClient.RerunFailedJobs(r.Context(), ghCtx.owner, ghCtx.repo, runID)
	} else {
		err = h.ghClient.RerunWorkflow(r.Context(), ghCtx.owner, ghCtx.repo, runID)
	}

	if err != nil {
		writeBadGateway(w, "failed to rerun workflow", err)
		return
	}

	w.WriteHeader(http.StatusAccepted)
	writeJSON(w, map[string]string{"status": "rerun triggered"})
}

// AnalyzeCIFailureRequest represents the request body for CI failure analysis
type AnalyzeCIFailureRequest struct {
	RunID int64 `json:"runId"`
	JobID int64 `json:"jobId"`
}

// CIAnalysisResult represents the AI analysis of a CI failure
type CIAnalysisResult struct {
	ErrorType     string          `json:"errorType"`
	Summary       string          `json:"summary"`
	RootCause     string          `json:"rootCause"`
	AffectedFiles []string        `json:"affectedFiles"`
	SuggestedFix  *CISuggestedFix `json:"suggestedFix,omitempty"`
	Confidence    float64         `json:"confidence"`
	RawLogs       string          `json:"rawLogs,omitempty"`
}

// CISuggestedFix represents a suggested fix for a CI failure
type CISuggestedFix struct {
	Description string    `json:"description"`
	Patches     []CIPatch `json:"patches"`
}

// CIPatch represents a code patch
type CIPatch struct {
	File string `json:"file"`
	Diff string `json:"diff"`
}

// AnalyzeCIFailure fetches logs and returns them for AI analysis
// Note: The actual AI analysis would be done by the agent-runner, this endpoint
// provides the logs and context needed for the analysis
func (h *Handlers) AnalyzeCIFailure(w http.ResponseWriter, r *http.Request) {
	ghCtx, ok := h.resolveGitHubContext(w, r)
	if !ok {
		return
	}

	var req AnalyzeCIFailureRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeValidationError(w, "invalid request body")
		return
	}

	if req.RunID == 0 || req.JobID == 0 {
		writeValidationError(w, "runId and jobId are required")
		return
	}

	ctx := r.Context()

	// Get workflow run for context
	run, err := h.ghClient.GetWorkflowRun(ctx, ghCtx.owner, ghCtx.repo, req.RunID)
	if err != nil {
		writeBadGateway(w, "failed to get workflow run", err)
		return
	}

	// Get job details to find the target job name
	jobs, err := h.ghClient.ListWorkflowJobs(ctx, ghCtx.owner, ghCtx.repo, req.RunID)
	if err != nil {
		writeBadGateway(w, "failed to get workflow jobs", err)
		return
	}

	var targetJobName string
	for _, job := range jobs {
		if job.ID == req.JobID {
			targetJobName = job.Name
			break
		}
	}

	// Get job logs
	logs, err := h.ghClient.GetJobLogs(ctx, ghCtx.owner, ghCtx.repo, req.JobID)
	if err != nil {
		writeBadGateway(w, "failed to get job logs", err)
		return
	}

	result := CIAnalysisResult{
		ErrorType: "ci_failure",
		RawLogs:   logs,
	}

	if run != nil {
		result.Summary = "Workflow '" + run.Name + "' failed"
	}
	if targetJobName != "" {
		result.Summary += " in job '" + targetJobName + "'"
	}

	writeJSON(w, result)
}

// CIFailureContext holds aggregated CI failure information for all failing jobs.
type CIFailureContext struct {
	Branch      string             `json:"branch"`
	FailedRuns  []FailedRunContext `json:"failedRuns"`
	TotalFailed int                `json:"totalFailed"`
	Truncated   bool               `json:"truncated"`
}

// FailedRunContext holds failure details for a single workflow run.
type FailedRunContext struct {
	RunID      int64              `json:"runId"`
	RunName    string             `json:"runName"`
	RunURL     string             `json:"runUrl"`
	FailedJobs []FailedJobContext `json:"failedJobs"`
}

// FailedJobContext holds failure details and truncated logs for a single job.
type FailedJobContext struct {
	JobID       int64    `json:"jobId"`
	JobName     string   `json:"jobName"`
	JobURL      string   `json:"jobUrl"`
	FailedSteps []string `json:"failedSteps"`
	Logs        string   `json:"logs"`
	LogLines    int      `json:"logLines"`
	Truncated   bool     `json:"truncated"`
}

const (
	maxLogLinesPerJob = 150
	// maxFailedJobs is the total number of failed jobs collected across all workflow runs.
	// Jobs beyond this limit are still counted in TotalFailed but their logs are not fetched.
	maxFailedJobs = 5
)

// truncateLogLines returns the last n lines of a log string.
func truncateLogLines(logs string, maxLines int) (string, int, bool) {
	lines := strings.Split(logs, "\n")
	totalLines := len(lines)
	if totalLines <= maxLines {
		return logs, totalLines, false
	}
	truncated := strings.Join(lines[totalLines-maxLines:], "\n")
	return truncated, totalLines, true
}

// GetCIFailureContext aggregates CI failure context for a session's branch.
// Returns failed workflow runs, their failed jobs, failed step names, and truncated logs.
func (h *Handlers) GetCIFailureContext(w http.ResponseWriter, r *http.Request) {
	ghCtx, ok := h.resolveGitHubContext(w, r)
	if !ok {
		return
	}

	ctx := r.Context()
	branch := ghCtx.session.Branch

	// Fetch workflow runs for this branch
	runs, err := h.ghClient.ListWorkflowRuns(ctx, ghCtx.owner, ghCtx.repo, branch)
	if err != nil {
		writeBadGateway(w, "failed to list workflow runs", err)
		return
	}

	// Find the latest head SHA from any run (runs are returned newest first).
	// We intentionally do not restrict to "completed" runs here — a workflow run
	// may still be "in_progress" if some jobs are still running, even though one
	// or more individual jobs have already completed with a failure.
	var latestSHA string
	for _, run := range runs {
		latestSHA = run.HeadSHA
		break // runs are returned newest first
	}

	if latestSHA == "" {
		writeJSON(w, CIFailureContext{
			Branch:      branch,
			FailedRuns:  []FailedRunContext{},
			TotalFailed: 0,
		})
		return
	}

	// Filter to runs from the latest SHA that have or may have failures.
	// Include both fully-completed failed runs and in-progress runs (their
	// individual jobs may already be completed with a failure conclusion).
	// Skip runs that are still queued/waiting and have no jobs to inspect yet.
	var eligibleRuns []github.WorkflowRun
	for _, run := range runs {
		if run.HeadSHA != latestSHA {
			continue
		}
		if run.Status == "queued" || run.Status == "waiting" || run.Status == "pending" || run.Status == "requested" {
			continue
		}
		if run.Status == "completed" && run.Conclusion != "failure" && run.Conclusion != "timed_out" {
			continue
		}
		eligibleRuns = append(eligibleRuns, run)
	}

	// Fetch jobs for all eligible runs concurrently. Each ListWorkflowJobs call
	// can paginate up to 5 pages, so serializing them across runs would
	// linearly inflate p99 latency.
	type runJobsResult struct {
		jobs []github.WorkflowJob
		err  error
	}
	jobResults := make([]runJobsResult, len(eligibleRuns))
	var fetchWg sync.WaitGroup
	for i, run := range eligibleRuns {
		fetchWg.Add(1)
		go func(idx int, runID int64) {
			defer fetchWg.Done()
			jobs, err := h.ghClient.ListWorkflowJobs(ctx, ghCtx.owner, ghCtx.repo, runID)
			jobResults[idx] = runJobsResult{jobs: jobs, err: err}
		}(i, run.ID)
	}
	fetchWg.Wait()

	// Process results serially so jobCount cap and truncation flag are
	// applied deterministically (matches GitHub's newest-first ordering).
	var failedRuns []FailedRunContext
	totalFailed := 0
	truncatedOverall := false
	jobCount := 0

	for i, run := range eligibleRuns {
		if jobResults[i].err != nil {
			log.Printf("Failed to fetch jobs for run %d: %v", run.ID, jobResults[i].err)
			continue
		}

		var failedJobs []FailedJobContext
		for _, job := range jobResults[i].jobs {
			if job.Conclusion != "failure" && job.Conclusion != "timed_out" {
				continue
			}

			totalFailed++
			jobCount++
			if jobCount > maxFailedJobs {
				truncatedOverall = true
				continue
			}

			// Extract failed step names
			var failedSteps []string
			for _, step := range job.Steps {
				if step.Conclusion == "failure" || step.Conclusion == "timed_out" {
					failedSteps = append(failedSteps, step.Name)
				}
			}

			failedJobs = append(failedJobs, FailedJobContext{
				JobID:       job.ID,
				JobName:     job.Name,
				JobURL:      job.HTMLURL,
				FailedSteps: failedSteps,
			})
		}

		if len(failedJobs) > 0 {
			failedRuns = append(failedRuns, FailedRunContext{
				RunID:      run.ID,
				RunName:    run.Name,
				RunURL:     run.HTMLURL,
				FailedJobs: failedJobs,
			})
		}
	}

	// Fetch logs for all failed jobs in parallel.
	// Each goroutine writes to a distinct slice element so no mutex is needed.
	var wg sync.WaitGroup

	for i := range failedRuns {
		for j := range failedRuns[i].FailedJobs {
			wg.Add(1)
			go func(runIdx, jobIdx int) {
				defer wg.Done()
				job := &failedRuns[runIdx].FailedJobs[jobIdx]

				logs, err := h.ghClient.GetJobLogs(ctx, ghCtx.owner, ghCtx.repo, job.JobID)
				if err != nil {
					log.Printf("Failed to fetch logs for job %d: %v", job.JobID, err)
					job.Logs = "(logs unavailable)"
					job.LogLines = 0
					return
				}

				truncatedLogs, totalLines, wasTruncated := truncateLogLines(logs, maxLogLinesPerJob)
				job.Logs = truncatedLogs
				job.LogLines = totalLines
				job.Truncated = wasTruncated
			}(i, j)
		}
	}
	wg.Wait()

	result := CIFailureContext{
		Branch:      branch,
		FailedRuns:  failedRuns,
		TotalFailed: totalFailed,
		Truncated:   truncatedOverall,
	}

	if result.FailedRuns == nil {
		result.FailedRuns = []FailedRunContext{}
	}

	writeJSON(w, result)
}
