package server

import (
	"encoding/json"
	"net/http"
	"strconv"

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
		writeInternalError(w, "failed to list workflow runs", err)
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
		writeInternalError(w, "failed to get workflow run", err)
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
		writeInternalError(w, "failed to list workflow jobs", err)
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
		writeInternalError(w, "failed to get job logs", err)
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
		writeInternalError(w, "failed to rerun workflow", err)
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
		writeInternalError(w, "failed to get workflow run", err)
		return
	}

	// Get job details to find the target job name
	jobs, err := h.ghClient.ListWorkflowJobs(ctx, ghCtx.owner, ghCtx.repo, req.RunID)
	if err != nil {
		writeInternalError(w, "failed to get workflow jobs", err)
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
		writeInternalError(w, "failed to get job logs", err)
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
