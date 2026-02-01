package server

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
)

// ListCIRuns returns workflow runs for a session's branch
func (h *Handlers) ListCIRuns(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	sessionID := chi.URLParam(r, "sessionId")

	// Get session
	session, err := h.store.GetSession(ctx, sessionID)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if session == nil {
		writeNotFound(w, "session")
		return
	}

	// Get the workspace to find the repo details
	repo, err := h.store.GetRepo(ctx, session.WorkspaceID)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if repo == nil {
		writeNotFound(w, "workspace")
		return
	}

	// Extract owner/repo from git remote
	owner, repoName, err := h.repoManager.GetGitHubRemote(ctx, repo.Path)
	if err != nil {
		writeInternalError(w, "failed to get GitHub remote", err)
		return
	}

	// Check if GitHub client is available
	if h.ghClient == nil {
		writeInternalError(w, "GitHub client not configured", nil)
		return
	}

	// List workflow runs for the session's branch
	runs, err := h.ghClient.ListWorkflowRuns(ctx, owner, repoName, session.Branch)
	if err != nil {
		writeInternalError(w, "failed to list workflow runs", err)
		return
	}

	writeJSON(w, runs)
}

// GetCIRun returns a specific workflow run
func (h *Handlers) GetCIRun(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	sessionID := chi.URLParam(r, "sessionId")
	runIDStr := chi.URLParam(r, "runId")

	runID, err := strconv.ParseInt(runIDStr, 10, 64)
	if err != nil {
		writeValidationError(w, "invalid run ID")
		return
	}

	// Get session
	session, err := h.store.GetSession(ctx, sessionID)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if session == nil {
		writeNotFound(w, "session")
		return
	}

	// Get the workspace to find the repo details
	repo, err := h.store.GetRepo(ctx, session.WorkspaceID)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if repo == nil {
		writeNotFound(w, "workspace")
		return
	}

	// Extract owner/repo from git remote
	owner, repoName, err := h.repoManager.GetGitHubRemote(ctx, repo.Path)
	if err != nil {
		writeInternalError(w, "failed to get GitHub remote", err)
		return
	}

	// Check if GitHub client is available
	if h.ghClient == nil {
		writeInternalError(w, "GitHub client not configured", nil)
		return
	}

	// Get workflow run
	run, err := h.ghClient.GetWorkflowRun(ctx, owner, repoName, runID)
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
	ctx := r.Context()
	sessionID := chi.URLParam(r, "sessionId")
	runIDStr := chi.URLParam(r, "runId")

	runID, err := strconv.ParseInt(runIDStr, 10, 64)
	if err != nil {
		writeValidationError(w, "invalid run ID")
		return
	}

	// Get session
	session, err := h.store.GetSession(ctx, sessionID)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if session == nil {
		writeNotFound(w, "session")
		return
	}

	// Get the workspace to find the repo details
	repo, err := h.store.GetRepo(ctx, session.WorkspaceID)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if repo == nil {
		writeNotFound(w, "workspace")
		return
	}

	// Extract owner/repo from git remote
	owner, repoName, err := h.repoManager.GetGitHubRemote(ctx, repo.Path)
	if err != nil {
		writeInternalError(w, "failed to get GitHub remote", err)
		return
	}

	// Check if GitHub client is available
	if h.ghClient == nil {
		writeInternalError(w, "GitHub client not configured", nil)
		return
	}

	// List jobs for the workflow run
	jobs, err := h.ghClient.ListWorkflowJobs(ctx, owner, repoName, runID)
	if err != nil {
		writeInternalError(w, "failed to list workflow jobs", err)
		return
	}

	writeJSON(w, jobs)
}

// GetCIJobLogs returns logs for a specific job
func (h *Handlers) GetCIJobLogs(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	sessionID := chi.URLParam(r, "sessionId")
	jobIDStr := chi.URLParam(r, "jobId")

	jobID, err := strconv.ParseInt(jobIDStr, 10, 64)
	if err != nil {
		writeValidationError(w, "invalid job ID")
		return
	}

	// Get session
	session, err := h.store.GetSession(ctx, sessionID)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if session == nil {
		writeNotFound(w, "session")
		return
	}

	// Get the workspace to find the repo details
	repo, err := h.store.GetRepo(ctx, session.WorkspaceID)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if repo == nil {
		writeNotFound(w, "workspace")
		return
	}

	// Extract owner/repo from git remote
	owner, repoName, err := h.repoManager.GetGitHubRemote(ctx, repo.Path)
	if err != nil {
		writeInternalError(w, "failed to get GitHub remote", err)
		return
	}

	// Check if GitHub client is available
	if h.ghClient == nil {
		writeInternalError(w, "GitHub client not configured", nil)
		return
	}

	// Get job logs
	logs, err := h.ghClient.GetJobLogs(ctx, owner, repoName, jobID)
	if err != nil {
		writeInternalError(w, "failed to get job logs", err)
		return
	}

	// Return logs as JSON with metadata
	writeJSON(w, map[string]interface{}{
		"jobId": jobID,
		"logs":  logs,
	})
}

// RerunCIWorkflow triggers a re-run of a workflow
func (h *Handlers) RerunCIWorkflow(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	sessionID := chi.URLParam(r, "sessionId")
	runIDStr := chi.URLParam(r, "runId")

	runID, err := strconv.ParseInt(runIDStr, 10, 64)
	if err != nil {
		writeValidationError(w, "invalid run ID")
		return
	}

	// Get session
	session, err := h.store.GetSession(ctx, sessionID)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if session == nil {
		writeNotFound(w, "session")
		return
	}

	// Get the workspace to find the repo details
	repo, err := h.store.GetRepo(ctx, session.WorkspaceID)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if repo == nil {
		writeNotFound(w, "workspace")
		return
	}

	// Extract owner/repo from git remote
	owner, repoName, err := h.repoManager.GetGitHubRemote(ctx, repo.Path)
	if err != nil {
		writeInternalError(w, "failed to get GitHub remote", err)
		return
	}

	// Check if GitHub client is available
	if h.ghClient == nil {
		writeInternalError(w, "GitHub client not configured", nil)
		return
	}

	// Check for query param to rerun only failed jobs
	failedOnly := r.URL.Query().Get("failedOnly") == "true"

	if failedOnly {
		err = h.ghClient.RerunFailedJobs(ctx, owner, repoName, runID)
	} else {
		err = h.ghClient.RerunWorkflow(ctx, owner, repoName, runID)
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
	ErrorType     string           `json:"errorType"`
	Summary       string           `json:"summary"`
	RootCause     string           `json:"rootCause"`
	AffectedFiles []string         `json:"affectedFiles"`
	SuggestedFix  *CISuggestedFix  `json:"suggestedFix,omitempty"`
	Confidence    float64          `json:"confidence"`
	RawLogs       string           `json:"rawLogs,omitempty"`
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
	ctx := r.Context()
	sessionID := chi.URLParam(r, "sessionId")

	// Get session
	session, err := h.store.GetSession(ctx, sessionID)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if session == nil {
		writeNotFound(w, "session")
		return
	}

	// Parse request
	var req AnalyzeCIFailureRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeValidationError(w, "invalid request body")
		return
	}

	if req.RunID == 0 || req.JobID == 0 {
		writeValidationError(w, "runId and jobId are required")
		return
	}

	// Get the workspace to find the repo details
	repo, err := h.store.GetRepo(ctx, session.WorkspaceID)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if repo == nil {
		writeNotFound(w, "workspace")
		return
	}

	// Extract owner/repo from git remote
	owner, repoName, err := h.repoManager.GetGitHubRemote(ctx, repo.Path)
	if err != nil {
		writeInternalError(w, "failed to get GitHub remote", err)
		return
	}

	// Check if GitHub client is available
	if h.ghClient == nil {
		writeInternalError(w, "GitHub client not configured", nil)
		return
	}

	// Get workflow run for context
	run, err := h.ghClient.GetWorkflowRun(ctx, owner, repoName, req.RunID)
	if err != nil {
		writeInternalError(w, "failed to get workflow run", err)
		return
	}

	// Get job details
	jobs, err := h.ghClient.ListWorkflowJobs(ctx, owner, repoName, req.RunID)
	if err != nil {
		writeInternalError(w, "failed to get workflow jobs", err)
		return
	}

	// Find the specific job
	var targetJob *struct {
		Name       string
		Conclusion string
	}
	for _, job := range jobs {
		if job.ID == req.JobID {
			targetJob = &struct {
				Name       string
				Conclusion string
			}{
				Name:       job.Name,
				Conclusion: job.Conclusion,
			}
			break
		}
	}

	// Get job logs
	logs, err := h.ghClient.GetJobLogs(ctx, owner, repoName, req.JobID)
	if err != nil {
		writeInternalError(w, "failed to get job logs", err)
		return
	}

	// Return the raw data for the frontend/agent to analyze
	// In a full implementation, this could call an AI service directly
	// For now, we return the logs and context for the frontend to display
	// and potentially send to an agent for analysis
	result := CIAnalysisResult{
		ErrorType: "ci_failure",
		Summary:   "",
		RootCause: "",
		RawLogs:   logs,
	}

	if run != nil {
		result.Summary = "Workflow '" + run.Name + "' failed"
	}
	if targetJob != nil {
		result.Summary += " in job '" + targetJob.Name + "'"
	}

	writeJSON(w, result)
}
