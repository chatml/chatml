package github

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestListWorkflowRuns_Success(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		require.Equal(t, "/repos/owner/repo/actions/runs", r.URL.Path)
		require.Equal(t, "Bearer test_token", r.Header.Get("Authorization"))
		require.Contains(t, r.URL.RawQuery, "per_page=100")
		require.Contains(t, r.URL.RawQuery, "page=1")

		json.NewEncoder(w).Encode(map[string]interface{}{
			"total_count": 2,
			"workflow_runs": []map[string]interface{}{
				{
					"id":          12345,
					"name":        "CI",
					"status":      "completed",
					"conclusion":  "success",
					"head_sha":    "abc123",
					"head_branch": "main",
					"html_url":    "https://github.com/owner/repo/actions/runs/12345",
					"jobs_url":    "https://api.github.com/repos/owner/repo/actions/runs/12345/jobs",
					"logs_url":    "https://api.github.com/repos/owner/repo/actions/runs/12345/logs",
					"created_at":  "2024-01-15T10:00:00Z",
					"updated_at":  "2024-01-15T10:05:00Z",
				},
				{
					"id":          12346,
					"name":        "Tests",
					"status":      "in_progress",
					"conclusion":  nil,
					"head_sha":    "def456",
					"head_branch": "feature",
					"html_url":    "https://github.com/owner/repo/actions/runs/12346",
					"jobs_url":    "https://api.github.com/repos/owner/repo/actions/runs/12346/jobs",
					"logs_url":    "https://api.github.com/repos/owner/repo/actions/runs/12346/logs",
					"created_at":  "2024-01-15T11:00:00Z",
					"updated_at":  "2024-01-15T11:01:00Z",
				},
			},
		})
	}))
	defer server.Close()

	client := NewClient("", "")
	client.SetToken("test_token")
	client.SetAPIURL(server.URL)

	runs, err := client.ListWorkflowRuns(context.Background(), "owner", "repo", "")
	require.NoError(t, err)
	require.Len(t, runs, 2)

	require.Equal(t, int64(12345), runs[0].ID)
	require.Equal(t, "CI", runs[0].Name)
	require.Equal(t, "completed", runs[0].Status)
	require.Equal(t, "success", runs[0].Conclusion)
	require.Equal(t, "abc123", runs[0].HeadSHA)

	require.Equal(t, int64(12346), runs[1].ID)
	require.Equal(t, "in_progress", runs[1].Status)
	require.Equal(t, "", runs[1].Conclusion) // nil becomes empty string
}

func TestListWorkflowRuns_WithBranch(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		require.Contains(t, r.URL.RawQuery, "branch=feature-branch")

		json.NewEncoder(w).Encode(map[string]interface{}{
			"total_count":   0,
			"workflow_runs": []map[string]interface{}{},
		})
	}))
	defer server.Close()

	client := NewClient("", "")
	client.SetToken("test_token")
	client.SetAPIURL(server.URL)

	runs, err := client.ListWorkflowRuns(context.Background(), "owner", "repo", "feature-branch")
	require.NoError(t, err)
	require.Empty(t, runs)
}

func TestListWorkflowRuns_NotAuthenticated(t *testing.T) {
	client := NewClient("", "")
	// No token set

	_, err := client.ListWorkflowRuns(context.Background(), "owner", "repo", "")
	require.Error(t, err)
	require.Contains(t, err.Error(), "not authenticated")
}

func TestGetWorkflowRun_Success(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		require.Equal(t, "/repos/owner/repo/actions/runs/12345", r.URL.Path)

		conclusion := "failure"
		json.NewEncoder(w).Encode(map[string]interface{}{
			"id":          12345,
			"name":        "CI",
			"status":      "completed",
			"conclusion":  conclusion,
			"head_sha":    "abc123",
			"head_branch": "main",
			"html_url":    "https://github.com/owner/repo/actions/runs/12345",
			"jobs_url":    "https://api.github.com/repos/owner/repo/actions/runs/12345/jobs",
			"logs_url":    "https://api.github.com/repos/owner/repo/actions/runs/12345/logs",
			"created_at":  "2024-01-15T10:00:00Z",
			"updated_at":  "2024-01-15T10:05:00Z",
		})
	}))
	defer server.Close()

	client := NewClient("", "")
	client.SetToken("test_token")
	client.SetAPIURL(server.URL)

	run, err := client.GetWorkflowRun(context.Background(), "owner", "repo", 12345)
	require.NoError(t, err)
	require.NotNil(t, run)
	require.Equal(t, int64(12345), run.ID)
	require.Equal(t, "failure", run.Conclusion)
}

func TestGetWorkflowRun_NotFound(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))
	defer server.Close()

	client := NewClient("", "")
	client.SetToken("test_token")
	client.SetAPIURL(server.URL)

	run, err := client.GetWorkflowRun(context.Background(), "owner", "repo", 99999)
	require.NoError(t, err)
	require.Nil(t, run)
}

func TestListWorkflowJobs_Success(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		require.Equal(t, "/repos/owner/repo/actions/runs/12345/jobs", r.URL.Path)

		startedAt := "2024-01-15T10:00:00Z"
		completedAt := "2024-01-15T10:05:00Z"
		stepStartedAt := "2024-01-15T10:01:00Z"
		stepCompletedAt := "2024-01-15T10:02:00Z"

		json.NewEncoder(w).Encode(map[string]interface{}{
			"total_count": 1,
			"jobs": []map[string]interface{}{
				{
					"id":           67890,
					"run_id":       12345,
					"name":         "build",
					"status":       "completed",
					"conclusion":   "success",
					"started_at":   startedAt,
					"completed_at": completedAt,
					"html_url":     "https://github.com/owner/repo/actions/runs/12345/job/67890",
					"steps": []map[string]interface{}{
						{
							"name":         "Checkout",
							"status":       "completed",
							"conclusion":   "success",
							"number":       1,
							"started_at":   stepStartedAt,
							"completed_at": stepCompletedAt,
						},
						{
							"name":         "Build",
							"status":       "completed",
							"conclusion":   "failure",
							"number":       2,
							"started_at":   stepStartedAt,
							"completed_at": stepCompletedAt,
						},
					},
				},
			},
		})
	}))
	defer server.Close()

	client := NewClient("", "")
	client.SetToken("test_token")
	client.SetAPIURL(server.URL)

	jobs, err := client.ListWorkflowJobs(context.Background(), "owner", "repo", 12345)
	require.NoError(t, err)
	require.Len(t, jobs, 1)

	job := jobs[0]
	require.Equal(t, int64(67890), job.ID)
	require.Equal(t, int64(12345), job.RunID)
	require.Equal(t, "build", job.Name)
	require.Equal(t, "completed", job.Status)
	require.Equal(t, "success", job.Conclusion)
	require.Len(t, job.Steps, 2)

	require.Equal(t, "Checkout", job.Steps[0].Name)
	require.Equal(t, "success", job.Steps[0].Conclusion)
	require.Equal(t, 1, job.Steps[0].Number)

	require.Equal(t, "Build", job.Steps[1].Name)
	require.Equal(t, "failure", job.Steps[1].Conclusion)
}

func TestGetJobLogs_Success(t *testing.T) {
	// Create the logs server that will serve actual logs
	logsServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("2024-01-15T10:00:00.000Z Running tests...\n2024-01-15T10:00:01.000Z FAILED: Test assertion error\n"))
	}))
	defer logsServer.Close()

	// Create the main API server that returns a redirect
	apiServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		require.Equal(t, "/repos/owner/repo/actions/jobs/67890/logs", r.URL.Path)
		w.Header().Set("Location", logsServer.URL+"/logs")
		w.WriteHeader(http.StatusFound)
	}))
	defer apiServer.Close()

	client := NewClient("", "")
	client.SetToken("test_token")
	client.SetAPIURL(apiServer.URL)

	logs, err := client.GetJobLogs(context.Background(), "owner", "repo", 67890)
	require.NoError(t, err)
	require.Contains(t, logs, "Running tests...")
	require.Contains(t, logs, "FAILED: Test assertion error")
}

func TestGetJobLogs_NotFound(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))
	defer server.Close()

	client := NewClient("", "")
	client.SetToken("test_token")
	client.SetAPIURL(server.URL)

	_, err := client.GetJobLogs(context.Background(), "owner", "repo", 99999)
	require.Error(t, err)
	require.Contains(t, err.Error(), "not found")
}

func TestRerunWorkflow_Success(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		require.Equal(t, "/repos/owner/repo/actions/runs/12345/rerun", r.URL.Path)
		require.Equal(t, "POST", r.Method)
		w.WriteHeader(http.StatusCreated)
	}))
	defer server.Close()

	client := NewClient("", "")
	client.SetToken("test_token")
	client.SetAPIURL(server.URL)

	err := client.RerunWorkflow(context.Background(), "owner", "repo", 12345)
	require.NoError(t, err)
}

func TestRerunWorkflow_Failure(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusForbidden)
		w.Write([]byte(`{"message": "Resource not accessible by integration"}`))
	}))
	defer server.Close()

	client := NewClient("", "")
	client.SetToken("test_token")
	client.SetAPIURL(server.URL)

	err := client.RerunWorkflow(context.Background(), "owner", "repo", 12345)
	require.Error(t, err)
	require.Contains(t, err.Error(), "403")
}

func TestRerunFailedJobs_Success(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		require.Equal(t, "/repos/owner/repo/actions/runs/12345/rerun-failed-jobs", r.URL.Path)
		require.Equal(t, "POST", r.Method)
		w.WriteHeader(http.StatusCreated)
	}))
	defer server.Close()

	client := NewClient("", "")
	client.SetToken("test_token")
	client.SetAPIURL(server.URL)

	err := client.RerunFailedJobs(context.Background(), "owner", "repo", 12345)
	require.NoError(t, err)
}

func TestCreateCommitStatus_Success(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		require.Equal(t, "/repos/owner/repo/statuses/abc123", r.URL.Path)
		require.Equal(t, "POST", r.Method)
		require.Equal(t, "application/json", r.Header.Get("Content-Type"))

		var status CommitStatus
		err := json.NewDecoder(r.Body).Decode(&status)
		require.NoError(t, err)
		require.Equal(t, "success", status.State)
		require.Equal(t, "https://chatml.app/session/123", status.TargetURL)
		require.Equal(t, "AI review passed", status.Description)
		require.Equal(t, "chatml/ai-review", status.Context)

		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"id":          123456,
			"state":       "success",
			"description": "AI review passed",
			"context":     "chatml/ai-review",
			"target_url":  "https://chatml.app/session/123",
			"created_at":  "2024-01-15T10:00:00Z",
			"updated_at":  "2024-01-15T10:00:00Z",
			"creator": map[string]interface{}{
				"login":      "testuser",
				"avatar_url": "https://github.com/testuser.png",
			},
		})
	}))
	defer server.Close()

	client := NewClient("", "")
	client.SetToken("test_token")
	client.SetAPIURL(server.URL)

	status := CommitStatus{
		State:       "success",
		TargetURL:   "https://chatml.app/session/123",
		Description: "AI review passed",
		Context:     "chatml/ai-review",
	}

	resp, err := client.CreateCommitStatus(context.Background(), "owner", "repo", "abc123", status)
	require.NoError(t, err)
	require.NotNil(t, resp)
	require.Equal(t, int64(123456), resp.ID)
	require.Equal(t, "success", resp.State)
	require.Equal(t, "chatml/ai-review", resp.Context)
}

func TestCreateCommitStatus_NotAuthenticated(t *testing.T) {
	client := NewClient("", "")
	// No token set

	status := CommitStatus{
		State:   "success",
		Context: "test",
	}

	_, err := client.CreateCommitStatus(context.Background(), "owner", "repo", "abc123", status)
	require.Error(t, err)
	require.Contains(t, err.Error(), "not authenticated")
}

func TestGetCombinedStatus_Success(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		require.Equal(t, "/repos/owner/repo/commits/abc123/status", r.URL.Path)
		require.Equal(t, "GET", r.Method)

		json.NewEncoder(w).Encode(map[string]interface{}{
			"state":       "success",
			"sha":         "abc123",
			"total_count": 2,
			"statuses": []map[string]interface{}{
				{
					"id":          1,
					"state":       "success",
					"description": "Build passed",
					"context":     "ci/build",
					"target_url":  "https://ci.example.com/build/123",
					"created_at":  "2024-01-15T10:00:00Z",
					"updated_at":  "2024-01-15T10:00:00Z",
				},
				{
					"id":          2,
					"state":       "success",
					"description": "AI review passed",
					"context":     "chatml/ai-review",
					"target_url":  "https://chatml.app/session/456",
					"created_at":  "2024-01-15T10:01:00Z",
					"updated_at":  "2024-01-15T10:01:00Z",
				},
			},
		})
	}))
	defer server.Close()

	client := NewClient("", "")
	client.SetToken("test_token")
	client.SetAPIURL(server.URL)

	combined, err := client.GetCombinedStatus(context.Background(), "owner", "repo", "abc123")
	require.NoError(t, err)
	require.NotNil(t, combined)
	require.Equal(t, "success", combined.State)
	require.Equal(t, "abc123", combined.SHA)
	require.Equal(t, 2, combined.TotalCount)
	require.Len(t, combined.Statuses, 2)
	require.Equal(t, "ci/build", combined.Statuses[0].Context)
	require.Equal(t, "chatml/ai-review", combined.Statuses[1].Context)
}

// Regression: a Go nil slice marshals to JSON `null`, which crashes the
// frontend Checks panel when it does `runs.some(...)`. ListWorkflowRuns must
// always return a non-nil slice when the API responds 200 with zero runs.
func TestListWorkflowRuns_EmptyResultSerializesAsArray(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"total_count":   0,
			"workflow_runs": []map[string]interface{}{},
		})
	}))
	defer server.Close()

	client := NewClient("", "")
	client.SetToken("test_token")
	client.SetAPIURL(server.URL)

	runs, err := client.ListWorkflowRuns(context.Background(), "owner", "repo", "")
	require.NoError(t, err)
	require.NotNil(t, runs, "must be non-nil so JSON serializes as `[]` not `null`")
	require.Len(t, runs, 0)

	encoded, err := json.Marshal(runs)
	require.NoError(t, err)
	require.Equal(t, "[]", string(encoded))
}

// Regression: same nil-slice pitfall as above, for ListWorkflowJobs.
func TestListWorkflowJobs_EmptyResultSerializesAsArray(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"total_count": 0,
			"jobs":        []map[string]interface{}{},
		})
	}))
	defer server.Close()

	client := NewClient("", "")
	client.SetToken("test_token")
	client.SetAPIURL(server.URL)

	jobs, err := client.ListWorkflowJobs(context.Background(), "owner", "repo", 12345)
	require.NoError(t, err)
	require.NotNil(t, jobs, "must be non-nil so JSON serializes as `[]` not `null`")
	require.Len(t, jobs, 0)

	encoded, err := json.Marshal(jobs)
	require.NoError(t, err)
	require.Equal(t, "[]", string(encoded))
}

func TestWorkflowRun_TimeFields(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"total_count": 1,
			"workflow_runs": []map[string]interface{}{
				{
					"id":          12345,
					"name":        "CI",
					"status":      "completed",
					"conclusion":  "success",
					"head_sha":    "abc123",
					"head_branch": "main",
					"html_url":    "https://github.com/owner/repo/actions/runs/12345",
					"jobs_url":    "https://api.github.com/repos/owner/repo/actions/runs/12345/jobs",
					"logs_url":    "https://api.github.com/repos/owner/repo/actions/runs/12345/logs",
					"created_at":  "2024-01-15T10:00:00Z",
					"updated_at":  "2024-01-15T10:05:00Z",
				},
			},
		})
	}))
	defer server.Close()

	client := NewClient("", "")
	client.SetToken("test_token")
	client.SetAPIURL(server.URL)

	runs, err := client.ListWorkflowRuns(context.Background(), "owner", "repo", "")
	require.NoError(t, err)
	require.Len(t, runs, 1)

	expectedCreated, _ := time.Parse(time.RFC3339, "2024-01-15T10:00:00Z")
	expectedUpdated, _ := time.Parse(time.RFC3339, "2024-01-15T10:05:00Z")

	require.Equal(t, expectedCreated, runs[0].CreatedAt)
	require.Equal(t, expectedUpdated, runs[0].UpdatedAt)
}
