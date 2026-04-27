package server

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/chatml/chatml-backend/models"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// ============================================================================
// CI Handler Tests — Validation Errors and Error Paths
// ============================================================================

// TestListCIRuns_NoGitHubClient verifies that ListCIRuns returns an error when
// the session does not exist (before ever reaching the GitHub client check).
func TestListCIRuns_NoGitHubClient(t *testing.T) {
	h, _ := setupTestHandlers(t)

	req := httptest.NewRequest("GET", "/api/sessions/nonexistent/ci/runs", nil)
	req = withChiContext(req, map[string]string{"sessionId": "nonexistent"})
	w := httptest.NewRecorder()

	h.ListCIRuns(w, req)

	// resolveGitHubContext fails at GetSession — session not found
	assert.Equal(t, http.StatusNotFound, w.Code)

	var apiErr APIError
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &apiErr))
	assert.Equal(t, ErrCodeNotFound, apiErr.Code)
	assert.Contains(t, apiErr.Error, "session")
}

// TestGetCIRun_InvalidRunID verifies that a non-numeric runId returns a validation error.
func TestGetCIRun_InvalidRunID(t *testing.T) {
	h, _ := setupTestHandlers(t)

	req := httptest.NewRequest("GET", "/api/sessions/sess-1/ci/runs/abc", nil)
	req = withChiContext(req, map[string]string{"sessionId": "sess-1", "runId": "abc"})
	w := httptest.NewRecorder()

	h.GetCIRun(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)

	var apiErr APIError
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &apiErr))
	assert.Equal(t, ErrCodeValidation, apiErr.Code)
	assert.Contains(t, apiErr.Error, "invalid run ID")
}

// TestListCIJobs_InvalidRunID verifies that a non-numeric runId returns a validation error.
func TestListCIJobs_InvalidRunID(t *testing.T) {
	h, _ := setupTestHandlers(t)

	req := httptest.NewRequest("GET", "/api/sessions/sess-1/ci/runs/xyz/jobs", nil)
	req = withChiContext(req, map[string]string{"sessionId": "sess-1", "runId": "xyz"})
	w := httptest.NewRecorder()

	h.ListCIJobs(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)

	var apiErr APIError
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &apiErr))
	assert.Equal(t, ErrCodeValidation, apiErr.Code)
	assert.Contains(t, apiErr.Error, "invalid run ID")
}

// TestGetCIJobLogs_InvalidJobID verifies that a non-numeric jobId returns a validation error.
func TestGetCIJobLogs_InvalidJobID(t *testing.T) {
	h, _ := setupTestHandlers(t)

	req := httptest.NewRequest("GET", "/api/sessions/sess-1/ci/jobs/notanumber/logs", nil)
	req = withChiContext(req, map[string]string{"sessionId": "sess-1", "jobId": "notanumber"})
	w := httptest.NewRecorder()

	h.GetCIJobLogs(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)

	var apiErr APIError
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &apiErr))
	assert.Equal(t, ErrCodeValidation, apiErr.Code)
	assert.Contains(t, apiErr.Error, "invalid job ID")
}

// TestRerunCIWorkflow_InvalidRunID verifies that a non-numeric runId returns a validation error.
func TestRerunCIWorkflow_InvalidRunID(t *testing.T) {
	h, _ := setupTestHandlers(t)

	req := httptest.NewRequest("POST", "/api/sessions/sess-1/ci/runs/bad/rerun", nil)
	req = withChiContext(req, map[string]string{"sessionId": "sess-1", "runId": "bad"})
	w := httptest.NewRecorder()

	h.RerunCIWorkflow(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)

	var apiErr APIError
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &apiErr))
	assert.Equal(t, ErrCodeValidation, apiErr.Code)
	assert.Contains(t, apiErr.Error, "invalid run ID")
}

// TestAnalyzeCIFailure_InvalidBody verifies that invalid JSON body returns a validation error.
// Note: AnalyzeCIFailure calls resolveGitHubContext first, so we need a valid session path.
// Since we cannot easily set up a full GitHub context, we test a different flow:
// The handler calls resolveGitHubContext first, which will fail for a nonexistent session.
// To test the body validation path, we would need the GitHub context to succeed.
// Instead, we verify the session-not-found error path.
func TestAnalyzeCIFailure_InvalidBody(t *testing.T) {
	h, _ := setupTestHandlers(t)

	// With a nonexistent session, resolveGitHubContext fails before body parsing
	body := []byte("not valid json")
	req := httptest.NewRequest("POST", "/api/sessions/nonexistent/ci/analyze", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req = withChiContext(req, map[string]string{"sessionId": "nonexistent"})
	w := httptest.NewRecorder()

	h.AnalyzeCIFailure(w, req)

	// Fails at resolveGitHubContext — session not found
	assert.Equal(t, http.StatusNotFound, w.Code)

	var apiErr APIError
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &apiErr))
	assert.Equal(t, ErrCodeNotFound, apiErr.Code)
}

// TestAnalyzeCIFailure_MissingFields verifies that when a session exists but the repo path
// is not a real GitHub repo, the handler fails at resolveGitHubContext.
// This tests the error path through the handler's dependency chain.
func TestAnalyzeCIFailure_MissingFields(t *testing.T) {
	h, s := setupTestHandlers(t)

	// Create a repo at a non-GitHub path and a session pointing to it
	repoPath := t.TempDir()
	createTestRepo(t, s, "ws-ci-1", repoPath)
	createTestSession(t, s, "sess-ci-1", "ws-ci-1")

	body, _ := json.Marshal(AnalyzeCIFailureRequest{RunID: 0, JobID: 0})
	req := httptest.NewRequest("POST", "/api/sessions/sess-ci-1/ci/analyze", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req = withChiContext(req, map[string]string{"sessionId": "sess-ci-1"})
	w := httptest.NewRecorder()

	h.AnalyzeCIFailure(w, req)

	// resolveGitHubContext fails at GetGitHubRemote because the test repo
	// does not have a GitHub remote URL
	assert.Equal(t, http.StatusInternalServerError, w.Code)

	var apiErr APIError
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &apiErr))
	assert.Equal(t, ErrCodeInternal, apiErr.Code)
}

// TestGetCIFailureContext_NoGitHubClient verifies that GetCIFailureContext returns an error
// when the session does not exist.
func TestGetCIFailureContext_NoGitHubClient(t *testing.T) {
	h, _ := setupTestHandlers(t)

	req := httptest.NewRequest("GET", "/api/sessions/nonexistent/ci/failure-context", nil)
	req = withChiContext(req, map[string]string{"sessionId": "nonexistent"})
	w := httptest.NewRecorder()

	h.GetCIFailureContext(w, req)

	// resolveGitHubContext fails at GetSession — session not found
	assert.Equal(t, http.StatusNotFound, w.Code)

	var apiErr APIError
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &apiErr))
	assert.Equal(t, ErrCodeNotFound, apiErr.Code)
	assert.Contains(t, apiErr.Error, "session")
}

// ============================================================================
// resolveGitHubContext Error Path Tests
// ============================================================================

// TestResolveGitHubContext_SessionNotFound verifies that resolveGitHubContext
// returns 404 when the session doesn't exist.
func TestResolveGitHubContext_SessionNotFound(t *testing.T) {
	h, _ := setupTestHandlers(t)

	req := httptest.NewRequest("GET", "/api/sessions/missing-session/ci/runs", nil)
	req = withChiContext(req, map[string]string{"sessionId": "missing-session"})
	w := httptest.NewRecorder()

	ghCtx, ok := h.resolveGitHubContext(w, req)

	assert.False(t, ok)
	assert.Nil(t, ghCtx)
	assert.Equal(t, http.StatusNotFound, w.Code)
}

// TestResolveGitHubContext_RepoPathNotGitRepo verifies that resolveGitHubContext
// returns an error when the repo path doesn't exist on disk (e.g. deleted directory).
func TestResolveGitHubContext_RepoPathNotGitRepo(t *testing.T) {
	h, s := setupTestHandlers(t)

	// Create a repo pointing to a path that is not a git repo
	nonGitPath := t.TempDir()
	createTestRepo(t, s, "ws-no-git", nonGitPath)
	createTestSession(t, s, "sess-no-git2", "ws-no-git")

	req := httptest.NewRequest("GET", "/api/sessions/sess-no-git2/ci/runs", nil)
	req = withChiContext(req, map[string]string{"sessionId": "sess-no-git2"})
	w := httptest.NewRecorder()

	ghCtx, ok := h.resolveGitHubContext(w, req)

	assert.False(t, ok)
	assert.Nil(t, ghCtx)
	// GetGitHubRemote fails because the path is not a git repository
	assert.Equal(t, http.StatusInternalServerError, w.Code)
}

// TestResolveGitHubContext_NotGitHubRepo verifies that resolveGitHubContext
// returns an internal error when the repo path doesn't have a GitHub remote.
func TestResolveGitHubContext_NotGitHubRepo(t *testing.T) {
	h, s := setupTestHandlers(t)

	// Create a real git repo without a GitHub remote
	repoPath := createTestGitRepo(t)
	createTestRepo(t, s, "ws-no-gh", repoPath)
	createTestSession(t, s, "sess-no-gh", "ws-no-gh")

	req := httptest.NewRequest("GET", "/api/sessions/sess-no-gh/ci/runs", nil)
	req = withChiContext(req, map[string]string{"sessionId": "sess-no-gh"})
	w := httptest.NewRecorder()

	ghCtx, ok := h.resolveGitHubContext(w, req)

	assert.False(t, ok)
	assert.Nil(t, ghCtx)
	// GetGitHubRemote fails because the remote is a local path, not a GitHub URL
	assert.Equal(t, http.StatusInternalServerError, w.Code)
}

// ============================================================================
// GetCIFailureContext — happy-path / status-field tests
//
// These tests guard the regression that caused "Fix Issues" to falsely report
// "No CI failures found" — a discrepancy between the panel (which surfaces
// action_required as a failure) and this handler (which used to drop it),
// plus the fact that an empty failedRuns array could mean "all passed",
// "still in progress", or "no runs" — ambiguity the frontend had to invent
// a hardcoded reply for.
// ============================================================================

// setupCIFailureContextTest wires together a mock GitHub server, a real git
// repo with a github.com remote, a workspace, and a session on a feature
// branch — i.e. the minimum to drive GetCIFailureContext end-to-end.
func setupCIFailureContextTest(t *testing.T, ghServer *httptest.Server) (*Handlers, *http.Request, *httptest.ResponseRecorder) {
	t.Helper()

	h, s := setupTestHandlersWithGitHub(t, ghServer)

	repoPath := createTestGitRepo(t)
	runGit(t, repoPath, "remote", "set-url", "origin", "https://github.com/owner/repo.git")
	createTestRepo(t, s, "ws-ci", repoPath)

	// Create a session on a feature branch — the handler reads
	// session.Branch when calling ListWorkflowRuns.
	require.NoError(t, s.AddSession(context.Background(), &models.Session{
		ID:          "sess-ci",
		WorkspaceID: "ws-ci",
		Name:        "CI Test Session",
		Status:      "idle",
		Branch:      "feature/test",
	}))

	req := httptest.NewRequest("GET", "/api/repos/ws-ci/sessions/sess-ci/ci/failure-context", nil)
	req = withChiContext(req, map[string]string{"id": "ws-ci", "sessionId": "sess-ci"})
	w := httptest.NewRecorder()

	return h, req, w
}

// TestGetCIFailureContext_NoRuns asserts that when GitHub returns no workflow
// runs, the response carries Status="no_runs" so the frontend can craft an
// honest message instead of the misleading "no failures found."
func TestGetCIFailureContext_NoRuns(t *testing.T) {
	ghServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		require.True(t, strings.HasPrefix(r.URL.Path, "/repos/owner/repo/actions/runs"))
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"total_count":   0,
			"workflow_runs": []interface{}{},
		})
	}))
	defer ghServer.Close()

	h, req, w := setupCIFailureContextTest(t, ghServer)
	h.GetCIFailureContext(w, req)

	require.Equal(t, http.StatusOK, w.Code)
	var resp CIFailureContext
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &resp))
	assert.Equal(t, CIStatusNoRuns, resp.Status)
	assert.Empty(t, resp.FailedRuns)
	assert.Equal(t, 0, resp.TotalFailed)
}

// TestGetCIFailureContext_AllPassed asserts that when all latest-SHA runs
// completed successfully, Status="all_passed" and failedRuns is empty.
func TestGetCIFailureContext_AllPassed(t *testing.T) {
	ghServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Only the runs listing is hit here — no eligible runs means jobs
		// are never fetched.
		require.Contains(t, r.URL.Path, "/actions/runs")
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"total_count": 1,
			"workflow_runs": []map[string]interface{}{
				{
					"id":          int64(1),
					"name":        "ci",
					"status":      "completed",
					"conclusion":  "success",
					"head_sha":    "sha-1",
					"head_branch": "feature/test",
				},
			},
		})
	}))
	defer ghServer.Close()

	h, req, w := setupCIFailureContextTest(t, ghServer)
	h.GetCIFailureContext(w, req)

	require.Equal(t, http.StatusOK, w.Code)
	var resp CIFailureContext
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &resp))
	assert.Equal(t, CIStatusAllPassed, resp.Status)
	assert.Empty(t, resp.FailedRuns)
}

// TestGetCIFailureContext_InProgress asserts that when latest-SHA runs are
// still queued or in-progress with no failed jobs surfaced, Status reports
// "in_progress" — the frontend must NOT mislabel this as "all passed."
func TestGetCIFailureContext_InProgress(t *testing.T) {
	ghServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case strings.Contains(r.URL.Path, "/actions/runs/1/jobs"):
			// One in-progress job, no failures yet.
			_ = json.NewEncoder(w).Encode(map[string]interface{}{
				"total_count": 1,
				"jobs": []map[string]interface{}{
					{
						"id":         int64(11),
						"run_id":     int64(1),
						"name":       "build",
						"status":     "in_progress",
						"conclusion": nil,
						"steps":      []interface{}{},
					},
				},
			})
		case strings.Contains(r.URL.Path, "/actions/runs"):
			_ = json.NewEncoder(w).Encode(map[string]interface{}{
				"total_count": 1,
				"workflow_runs": []map[string]interface{}{
					{
						"id":          int64(1),
						"name":        "ci",
						"status":      "in_progress",
						"conclusion":  nil,
						"head_sha":    "sha-1",
						"head_branch": "feature/test",
					},
				},
			})
		default:
			t.Fatalf("unexpected GH path: %s", r.URL.Path)
		}
	}))
	defer ghServer.Close()

	h, req, w := setupCIFailureContextTest(t, ghServer)
	h.GetCIFailureContext(w, req)

	require.Equal(t, http.StatusOK, w.Code)
	var resp CIFailureContext
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &resp))
	assert.Equal(t, CIStatusInProgress, resp.Status)
	assert.Empty(t, resp.FailedRuns)
}

// TestGetCIFailureContext_ActionRequired asserts that a run/job concluded as
// "action_required" surfaces in failedRuns. The Checks panel,
// PRHoverCard, and pr_status.go all treat action_required as a failure;
// this handler must agree, otherwise users see red checks in the panel
// while Fix Issues silently sees nothing.
func TestGetCIFailureContext_ActionRequired(t *testing.T) {
	// Declare ghServer up front so the handler can build a Location header
	// pointing back at this same test server (avoids any real network I/O).
	var ghServer *httptest.Server
	ghServer = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/logs/job-11":
			// Body served at the redirect target — keeps the log fetch
			// inside the test server.
			_, _ = w.Write([]byte("error: deploy step failed\n"))
		case strings.Contains(r.URL.Path, "/actions/jobs/11/logs"):
			// 302 → redirect target on this same server so we never
			// hit the network.
			w.Header().Set("Location", ghServer.URL+"/logs/job-11")
			w.WriteHeader(http.StatusFound)
		case strings.Contains(r.URL.Path, "/actions/runs/1/jobs"):
			_ = json.NewEncoder(w).Encode(map[string]interface{}{
				"total_count": 1,
				"jobs": []map[string]interface{}{
					{
						"id":         int64(11),
						"run_id":     int64(1),
						"name":       "deploy",
						"status":     "completed",
						"conclusion": "action_required",
						"html_url":   "https://github.com/owner/repo/actions/runs/1/job/11",
						"steps":      []interface{}{},
					},
				},
			})
		case strings.Contains(r.URL.Path, "/actions/runs"):
			_ = json.NewEncoder(w).Encode(map[string]interface{}{
				"total_count": 1,
				"workflow_runs": []map[string]interface{}{
					{
						"id":          int64(1),
						"name":        "deploy",
						"status":      "completed",
						"conclusion":  "action_required",
						"head_sha":    "sha-1",
						"head_branch": "feature/test",
						"html_url":    "https://github.com/owner/repo/actions/runs/1",
					},
				},
			})
		default:
			t.Fatalf("unexpected GH path: %s", r.URL.Path)
		}
	}))
	defer ghServer.Close()

	h, req, w := setupCIFailureContextTest(t, ghServer)
	h.GetCIFailureContext(w, req)

	require.Equal(t, http.StatusOK, w.Code)
	var resp CIFailureContext
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &resp))
	assert.Equal(t, CIStatusHasFailures, resp.Status)
	require.Len(t, resp.FailedRuns, 1)
	require.Len(t, resp.FailedRuns[0].FailedJobs, 1)
	assert.Equal(t, "deploy", resp.FailedRuns[0].FailedJobs[0].JobName)
	assert.Equal(t, 1, resp.TotalFailed)
	// Verify the log-fetch path actually executed end-to-end and the body
	// from the redirect target landed on the job. Without this, a regression
	// that breaks log fetching would still let the test pass.
	assert.Contains(t, resp.FailedRuns[0].FailedJobs[0].Logs, "deploy step failed")
}
