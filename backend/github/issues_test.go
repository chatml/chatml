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

// ============================================================================
// ListIssuesWithETag Tests
// ============================================================================

func TestClient_ListIssuesWithETag_Success(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		require.Equal(t, "/repos/testowner/testrepo/issues", r.URL.Path)
		require.Equal(t, "Bearer test_token", r.Header.Get("Authorization"))
		require.Equal(t, "application/vnd.github+json", r.Header.Get("Accept"))
		require.Equal(t, "open", r.URL.Query().Get("state"))
		require.Equal(t, "updated", r.URL.Query().Get("sort"))
		require.Equal(t, "desc", r.URL.Query().Get("direction"))
		require.Equal(t, "50", r.URL.Query().Get("per_page"))

		w.Header().Set("ETag", `W/"etag-123"`)
		issues := []map[string]interface{}{
			{
				"number":   1,
				"title":    "Bug report",
				"state":    "open",
				"html_url": "https://github.com/testowner/testrepo/issues/1",
				"body":     "Bug description",
				"comments": 3,
				"created_at": "2024-01-01T00:00:00Z",
				"updated_at": "2024-01-02T00:00:00Z",
				"labels": []map[string]string{
					{"name": "bug", "color": "d73a4a"},
				},
				"user": map[string]string{
					"login":      "alice",
					"avatar_url": "https://github.com/alice.png",
				},
				"assignees": []map[string]string{
					{"login": "bob", "avatar_url": "https://github.com/bob.png"},
				},
			},
			{
				"number":     2,
				"title":      "Feature request",
				"state":      "open",
				"html_url":   "https://github.com/testowner/testrepo/issues/2",
				"body":       "Feature description",
				"comments":   0,
				"created_at": "2024-01-03T00:00:00Z",
				"updated_at": "2024-01-04T00:00:00Z",
				"labels":     []map[string]string{},
				"user": map[string]string{
					"login":      "charlie",
					"avatar_url": "https://github.com/charlie.png",
				},
				"assignees": []map[string]string{},
			},
		}
		json.NewEncoder(w).Encode(issues)
	}))
	defer server.Close()

	client := NewClient("", "")
	client.apiURL = server.URL
	client.SetToken("test_token")

	result, err := client.ListIssuesWithETag(context.Background(), "testowner", "testrepo", "open", "", "")
	require.NoError(t, err)
	require.NotNil(t, result)
	require.Len(t, result.Issues, 2)
	require.Equal(t, `W/"etag-123"`, result.ETag)

	// Verify first issue fields
	issue := result.Issues[0]
	require.Equal(t, 1, issue.Number)
	require.Equal(t, "Bug report", issue.Title)
	require.Equal(t, "open", issue.State)
	require.Equal(t, "https://github.com/testowner/testrepo/issues/1", issue.HTMLURL)
	require.Equal(t, 3, issue.Comments)
	require.Equal(t, "alice", issue.User.Login)
	require.Equal(t, "https://github.com/alice.png", issue.User.AvatarURL)
	require.Len(t, issue.Labels, 1)
	require.Equal(t, "bug", issue.Labels[0].Name)
	require.Equal(t, "d73a4a", issue.Labels[0].Color)
	require.Len(t, issue.Assignees, 1)
	require.Equal(t, "bob", issue.Assignees[0].Login)

	// Verify second issue
	require.Equal(t, 2, result.Issues[1].Number)
	require.Equal(t, "Feature request", result.Issues[1].Title)
}

func TestClient_ListIssuesWithETag_WithLabelsFilter(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		require.Equal(t, "bug,ui", r.URL.Query().Get("labels"))
		json.NewEncoder(w).Encode([]map[string]interface{}{})
	}))
	defer server.Close()

	client := NewClient("", "")
	client.apiURL = server.URL
	client.SetToken("test_token")

	result, err := client.ListIssuesWithETag(context.Background(), "testowner", "testrepo", "open", "bug,ui", "")
	require.NoError(t, err)
	require.NotNil(t, result)
	require.Empty(t, result.Issues)
}

func TestClient_ListIssuesWithETag_ClosedState(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		require.Equal(t, "closed", r.URL.Query().Get("state"))
		json.NewEncoder(w).Encode([]map[string]interface{}{})
	}))
	defer server.Close()

	client := NewClient("", "")
	client.apiURL = server.URL
	client.SetToken("test_token")

	result, err := client.ListIssuesWithETag(context.Background(), "testowner", "testrepo", "closed", "", "")
	require.NoError(t, err)
	require.NotNil(t, result)
}

func TestClient_ListIssuesWithETag_DefaultState(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		require.Equal(t, "open", r.URL.Query().Get("state"))
		json.NewEncoder(w).Encode([]map[string]interface{}{})
	}))
	defer server.Close()

	client := NewClient("", "")
	client.apiURL = server.URL
	client.SetToken("test_token")

	// Empty state should default to "open"
	result, err := client.ListIssuesWithETag(context.Background(), "testowner", "testrepo", "", "", "")
	require.NoError(t, err)
	require.NotNil(t, result)
}

func TestClient_ListIssuesWithETag_EmptyList(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode([]map[string]interface{}{})
	}))
	defer server.Close()

	client := NewClient("", "")
	client.apiURL = server.URL
	client.SetToken("test_token")

	result, err := client.ListIssuesWithETag(context.Background(), "testowner", "testrepo", "open", "", "")
	require.NoError(t, err)
	require.NotNil(t, result)
	require.NotNil(t, result.Issues)
	require.Empty(t, result.Issues)
}

func TestClient_ListIssuesWithETag_NotModified(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		require.Equal(t, `W/"etag-123"`, r.Header.Get("If-None-Match"))
		w.WriteHeader(http.StatusNotModified)
	}))
	defer server.Close()

	client := NewClient("", "")
	client.apiURL = server.URL
	client.SetToken("test_token")

	result, err := client.ListIssuesWithETag(context.Background(), "testowner", "testrepo", "open", "", `W/"etag-123"`)
	require.ErrorIs(t, err, ErrNotModified)
	require.Nil(t, result)
}

func TestClient_ListIssuesWithETag_SendsETagHeader(t *testing.T) {
	var receivedETag string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		receivedETag = r.Header.Get("If-None-Match")
		w.Header().Set("ETag", `W/"new-etag"`)
		json.NewEncoder(w).Encode([]map[string]interface{}{})
	}))
	defer server.Close()

	client := NewClient("", "")
	client.apiURL = server.URL
	client.SetToken("test_token")

	result, err := client.ListIssuesWithETag(context.Background(), "testowner", "testrepo", "open", "", `W/"old-etag"`)
	require.NoError(t, err)
	require.Equal(t, `W/"old-etag"`, receivedETag)
	require.Equal(t, `W/"new-etag"`, result.ETag)
}

func TestClient_ListIssuesWithETag_NoETagSendsNoHeader(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		require.Empty(t, r.Header.Get("If-None-Match"))
		json.NewEncoder(w).Encode([]map[string]interface{}{})
	}))
	defer server.Close()

	client := NewClient("", "")
	client.apiURL = server.URL
	client.SetToken("test_token")

	_, err := client.ListIssuesWithETag(context.Background(), "testowner", "testrepo", "open", "", "")
	require.NoError(t, err)
}

func TestClient_ListIssuesWithETag_FiltersPullRequests(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		items := []map[string]interface{}{
			{
				"number": 1, "title": "Issue 1", "state": "open",
				"html_url": "https://github.com/o/r/issues/1",
				"created_at": "2024-01-01T00:00:00Z", "updated_at": "2024-01-01T00:00:00Z",
				"user": map[string]string{"login": "a", "avatar_url": ""},
			},
			{
				"number": 2, "title": "PR 1", "state": "open",
				"html_url": "https://github.com/o/r/pull/2",
				"created_at": "2024-01-01T00:00:00Z", "updated_at": "2024-01-01T00:00:00Z",
				"user":         map[string]string{"login": "b", "avatar_url": ""},
				"pull_request": map[string]string{"url": "https://api.github.com/repos/o/r/pulls/2"},
			},
			{
				"number": 3, "title": "Issue 2", "state": "open",
				"html_url": "https://github.com/o/r/issues/3",
				"created_at": "2024-01-01T00:00:00Z", "updated_at": "2024-01-01T00:00:00Z",
				"user": map[string]string{"login": "c", "avatar_url": ""},
			},
			{
				"number": 4, "title": "PR 2", "state": "open",
				"html_url": "https://github.com/o/r/pull/4",
				"created_at": "2024-01-01T00:00:00Z", "updated_at": "2024-01-01T00:00:00Z",
				"user":         map[string]string{"login": "d", "avatar_url": ""},
				"pull_request": map[string]string{"url": "https://api.github.com/repos/o/r/pulls/4"},
			},
			{
				"number": 5, "title": "Issue 3", "state": "open",
				"html_url": "https://github.com/o/r/issues/5",
				"created_at": "2024-01-01T00:00:00Z", "updated_at": "2024-01-01T00:00:00Z",
				"user": map[string]string{"login": "e", "avatar_url": ""},
			},
		}
		json.NewEncoder(w).Encode(items)
	}))
	defer server.Close()

	client := NewClient("", "")
	client.apiURL = server.URL
	client.SetToken("test_token")

	result, err := client.ListIssuesWithETag(context.Background(), "o", "r", "open", "", "")
	require.NoError(t, err)
	require.Len(t, result.Issues, 3)
	require.Equal(t, 1, result.Issues[0].Number)
	require.Equal(t, 3, result.Issues[1].Number)
	require.Equal(t, 5, result.Issues[2].Number)
}

func TestClient_ListIssuesWithETag_NotAuthenticated(t *testing.T) {
	client := NewClient("", "")
	// No token set

	_, err := client.ListIssuesWithETag(context.Background(), "testowner", "testrepo", "open", "", "")
	require.Error(t, err)
	require.Contains(t, err.Error(), "not authenticated")
}

func TestClient_ListIssuesWithETag_HTTPError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusForbidden)
		w.Write([]byte(`{"message": "API rate limit exceeded"}`))
	}))
	defer server.Close()

	client := NewClient("", "")
	client.apiURL = server.URL
	client.SetToken("test_token")

	_, err := client.ListIssuesWithETag(context.Background(), "testowner", "testrepo", "open", "", "")
	require.Error(t, err)
	require.Contains(t, err.Error(), "403")
}

func TestClient_ListIssuesWithETag_InvalidJSON(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("not valid json"))
	}))
	defer server.Close()

	client := NewClient("", "")
	client.apiURL = server.URL
	client.SetToken("test_token")

	_, err := client.ListIssuesWithETag(context.Background(), "testowner", "testrepo", "open", "", "")
	require.Error(t, err)
	require.Contains(t, err.Error(), "decoding")
}

func TestClient_ListIssuesWithETag_ContextCancellation(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(100 * time.Millisecond)
		json.NewEncoder(w).Encode([]map[string]interface{}{})
	}))
	defer server.Close()

	client := NewClient("", "")
	client.apiURL = server.URL
	client.SetToken("test_token")

	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	_, err := client.ListIssuesWithETag(ctx, "testowner", "testrepo", "open", "", "")
	require.Error(t, err)
}

func TestClient_ListIssuesWithETag_MultipleLabelsAndAssignees(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		issues := []map[string]interface{}{
			{
				"number": 1, "title": "Complex issue", "state": "open",
				"html_url": "https://github.com/o/r/issues/1",
				"comments": 5,
				"created_at": "2024-01-01T00:00:00Z", "updated_at": "2024-01-02T00:00:00Z",
				"labels": []map[string]string{
					{"name": "bug", "color": "d73a4a"},
					{"name": "priority:high", "color": "e4e669"},
					{"name": "ui", "color": "0075ca"},
				},
				"user": map[string]string{"login": "alice", "avatar_url": "https://github.com/alice.png"},
				"assignees": []map[string]string{
					{"login": "bob", "avatar_url": "https://github.com/bob.png"},
					{"login": "charlie", "avatar_url": "https://github.com/charlie.png"},
				},
			},
		}
		json.NewEncoder(w).Encode(issues)
	}))
	defer server.Close()

	client := NewClient("", "")
	client.apiURL = server.URL
	client.SetToken("test_token")

	result, err := client.ListIssuesWithETag(context.Background(), "o", "r", "open", "", "")
	require.NoError(t, err)
	require.Len(t, result.Issues, 1)

	issue := result.Issues[0]
	require.Len(t, issue.Labels, 3)
	require.Equal(t, "bug", issue.Labels[0].Name)
	require.Equal(t, "priority:high", issue.Labels[1].Name)
	require.Equal(t, "ui", issue.Labels[2].Name)
	require.Equal(t, "0075ca", issue.Labels[2].Color)

	require.Len(t, issue.Assignees, 2)
	require.Equal(t, "bob", issue.Assignees[0].Login)
	require.Equal(t, "charlie", issue.Assignees[1].Login)
	require.Equal(t, "https://github.com/charlie.png", issue.Assignees[1].AvatarURL)
}

// ============================================================================
// SearchIssues Tests
// ============================================================================

func TestClient_SearchIssues_Success(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		require.Equal(t, "/search/issues", r.URL.Path)
		require.Equal(t, "Bearer test_token", r.Header.Get("Authorization"))

		q := r.URL.Query().Get("q")
		require.Contains(t, q, "repo:testowner/testrepo")
		require.Contains(t, q, "is:issue")
		require.Contains(t, q, "memory leak")
		require.Equal(t, "30", r.URL.Query().Get("per_page"))

		resp := map[string]interface{}{
			"total_count": 2,
			"items": []map[string]interface{}{
				{
					"number": 10, "title": "Memory leak in parser", "state": "open",
					"html_url": "https://github.com/testowner/testrepo/issues/10",
					"comments": 1,
					"created_at": "2024-01-01T00:00:00Z", "updated_at": "2024-01-02T00:00:00Z",
					"user": map[string]string{"login": "alice", "avatar_url": ""},
				},
				{
					"number": 20, "title": "Memory leak in cache", "state": "open",
					"html_url": "https://github.com/testowner/testrepo/issues/20",
					"comments": 0,
					"created_at": "2024-01-03T00:00:00Z", "updated_at": "2024-01-04T00:00:00Z",
					"user": map[string]string{"login": "bob", "avatar_url": ""},
				},
			},
		}
		json.NewEncoder(w).Encode(resp)
	}))
	defer server.Close()

	client := NewClient("", "")
	client.apiURL = server.URL
	client.SetToken("test_token")

	result, err := client.SearchIssues(context.Background(), "testowner", "testrepo", "memory leak")
	require.NoError(t, err)
	require.NotNil(t, result)
	require.Equal(t, 2, result.TotalCount)
	require.Len(t, result.Issues, 2)
	require.Equal(t, 10, result.Issues[0].Number)
	require.Equal(t, "Memory leak in parser", result.Issues[0].Title)
	require.Equal(t, 20, result.Issues[1].Number)
}

func TestClient_SearchIssues_FiltersPullRequests(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		resp := map[string]interface{}{
			"total_count": 3,
			"items": []map[string]interface{}{
				{
					"number": 1, "title": "Issue", "state": "open",
					"html_url": "https://github.com/o/r/issues/1",
					"created_at": "2024-01-01T00:00:00Z", "updated_at": "2024-01-01T00:00:00Z",
					"user": map[string]string{"login": "a", "avatar_url": ""},
				},
				{
					"number": 2, "title": "PR", "state": "open",
					"html_url": "https://github.com/o/r/pull/2",
					"created_at": "2024-01-01T00:00:00Z", "updated_at": "2024-01-01T00:00:00Z",
					"user":         map[string]string{"login": "b", "avatar_url": ""},
					"pull_request": map[string]string{"url": "https://api.github.com/repos/o/r/pulls/2"},
				},
				{
					"number": 3, "title": "Another issue", "state": "open",
					"html_url": "https://github.com/o/r/issues/3",
					"created_at": "2024-01-01T00:00:00Z", "updated_at": "2024-01-01T00:00:00Z",
					"user": map[string]string{"login": "c", "avatar_url": ""},
				},
			},
		}
		json.NewEncoder(w).Encode(resp)
	}))
	defer server.Close()

	client := NewClient("", "")
	client.apiURL = server.URL
	client.SetToken("test_token")

	result, err := client.SearchIssues(context.Background(), "o", "r", "test")
	require.NoError(t, err)
	require.Len(t, result.Issues, 2)
	require.Equal(t, 1, result.Issues[0].Number)
	require.Equal(t, 3, result.Issues[1].Number)
}

func TestClient_SearchIssues_EmptyResults(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		resp := map[string]interface{}{
			"total_count": 0,
			"items":       []map[string]interface{}{},
		}
		json.NewEncoder(w).Encode(resp)
	}))
	defer server.Close()

	client := NewClient("", "")
	client.apiURL = server.URL
	client.SetToken("test_token")

	result, err := client.SearchIssues(context.Background(), "o", "r", "nonexistent")
	require.NoError(t, err)
	require.NotNil(t, result)
	require.Equal(t, 0, result.TotalCount)
	require.NotNil(t, result.Issues)
	require.Empty(t, result.Issues)
}

func TestClient_SearchIssues_HTTPError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnprocessableEntity)
		w.Write([]byte(`{"message": "Validation Failed"}`))
	}))
	defer server.Close()

	client := NewClient("", "")
	client.apiURL = server.URL
	client.SetToken("test_token")

	_, err := client.SearchIssues(context.Background(), "o", "r", "bad query")
	require.Error(t, err)
	require.Contains(t, err.Error(), "422")
}

func TestClient_SearchIssues_NotAuthenticated(t *testing.T) {
	client := NewClient("", "")

	_, err := client.SearchIssues(context.Background(), "o", "r", "test")
	require.Error(t, err)
	require.Contains(t, err.Error(), "not authenticated")
}

func TestClient_SearchIssues_ContextCancellation(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(100 * time.Millisecond)
		json.NewEncoder(w).Encode(map[string]interface{}{"total_count": 0, "items": []interface{}{}})
	}))
	defer server.Close()

	client := NewClient("", "")
	client.apiURL = server.URL
	client.SetToken("test_token")

	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	_, err := client.SearchIssues(ctx, "o", "r", "test")
	require.Error(t, err)
}

// ============================================================================
// GetIssue Tests
// ============================================================================

func TestClient_GetIssue_Success(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		require.Equal(t, "/repos/testowner/testrepo/issues/42", r.URL.Path)
		require.Equal(t, "Bearer test_token", r.Header.Get("Authorization"))
		require.Equal(t, "application/vnd.github+json", r.Header.Get("Accept"))

		issue := map[string]interface{}{
			"number":   42,
			"title":    "Critical bug in auth",
			"state":    "open",
			"html_url": "https://github.com/testowner/testrepo/issues/42",
			"body":     "The auth module crashes when...",
			"comments": 7,
			"created_at": "2024-01-01T00:00:00Z",
			"updated_at": "2024-01-05T00:00:00Z",
			"labels": []map[string]string{
				{"name": "bug", "color": "d73a4a"},
				{"name": "critical", "color": "b60205"},
			},
			"user": map[string]string{
				"login":      "reporter",
				"avatar_url": "https://github.com/reporter.png",
			},
			"assignees": []map[string]string{
				{"login": "dev1", "avatar_url": "https://github.com/dev1.png"},
				{"login": "dev2", "avatar_url": "https://github.com/dev2.png"},
			},
			"milestone": map[string]interface{}{
				"number": 5,
				"title":  "v2.0",
				"state":  "open",
			},
		}
		json.NewEncoder(w).Encode(issue)
	}))
	defer server.Close()

	client := NewClient("", "")
	client.apiURL = server.URL
	client.SetToken("test_token")

	details, err := client.GetIssue(context.Background(), "testowner", "testrepo", 42)
	require.NoError(t, err)
	require.NotNil(t, details)

	require.Equal(t, 42, details.Number)
	require.Equal(t, "Critical bug in auth", details.Title)
	require.Equal(t, "open", details.State)
	require.Equal(t, "https://github.com/testowner/testrepo/issues/42", details.HTMLURL)
	require.Equal(t, "The auth module crashes when...", details.Body)
	require.Equal(t, 7, details.Comments)
	require.Equal(t, "reporter", details.User.Login)

	require.Len(t, details.Labels, 2)
	require.Equal(t, "bug", details.Labels[0].Name)
	require.Equal(t, "critical", details.Labels[1].Name)

	require.Len(t, details.Assignees, 2)
	require.Equal(t, "dev1", details.Assignees[0].Login)

	require.NotNil(t, details.Milestone)
	require.Equal(t, 5, details.Milestone.Number)
	require.Equal(t, "v2.0", details.Milestone.Title)
	require.Equal(t, "open", details.Milestone.State)
}

func TestClient_GetIssue_NotFound(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))
	defer server.Close()

	client := NewClient("", "")
	client.apiURL = server.URL
	client.SetToken("test_token")

	details, err := client.GetIssue(context.Background(), "testowner", "testrepo", 999)
	require.NoError(t, err)
	require.Nil(t, details)
}

func TestClient_GetIssue_NoMilestone(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		issue := map[string]interface{}{
			"number": 1, "title": "Simple issue", "state": "open",
			"html_url": "https://github.com/o/r/issues/1",
			"body": "No milestone",
			"created_at": "2024-01-01T00:00:00Z", "updated_at": "2024-01-01T00:00:00Z",
			"user": map[string]string{"login": "a", "avatar_url": ""},
		}
		json.NewEncoder(w).Encode(issue)
	}))
	defer server.Close()

	client := NewClient("", "")
	client.apiURL = server.URL
	client.SetToken("test_token")

	details, err := client.GetIssue(context.Background(), "o", "r", 1)
	require.NoError(t, err)
	require.NotNil(t, details)
	require.Nil(t, details.Milestone)
}

func TestClient_GetIssue_NotAuthenticated(t *testing.T) {
	client := NewClient("", "")

	_, err := client.GetIssue(context.Background(), "o", "r", 1)
	require.Error(t, err)
	require.Contains(t, err.Error(), "not authenticated")
}

func TestClient_GetIssue_HTTPError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte(`{"message": "Internal Server Error"}`))
	}))
	defer server.Close()

	client := NewClient("", "")
	client.apiURL = server.URL
	client.SetToken("test_token")

	_, err := client.GetIssue(context.Background(), "o", "r", 1)
	require.Error(t, err)
	require.Contains(t, err.Error(), "500")
}

func TestClient_GetIssue_InvalidJSON(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("not valid json"))
	}))
	defer server.Close()

	client := NewClient("", "")
	client.apiURL = server.URL
	client.SetToken("test_token")

	_, err := client.GetIssue(context.Background(), "o", "r", 1)
	require.Error(t, err)
	require.Contains(t, err.Error(), "decoding")
}

func TestClient_GetIssue_ContextCancellation(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(100 * time.Millisecond)
		json.NewEncoder(w).Encode(map[string]interface{}{"number": 1})
	}))
	defer server.Close()

	client := NewClient("", "")
	client.apiURL = server.URL
	client.SetToken("test_token")

	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	_, err := client.GetIssue(ctx, "o", "r", 1)
	require.Error(t, err)
}

func TestClient_GetIssue_TrimsBody(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		issue := map[string]interface{}{
			"number": 1, "title": "Issue", "state": "open",
			"html_url": "https://github.com/o/r/issues/1",
			"body":       "  Body with whitespace  \n\n",
			"created_at": "2024-01-01T00:00:00Z", "updated_at": "2024-01-01T00:00:00Z",
			"user": map[string]string{"login": "a", "avatar_url": ""},
		}
		json.NewEncoder(w).Encode(issue)
	}))
	defer server.Close()

	client := NewClient("", "")
	client.apiURL = server.URL
	client.SetToken("test_token")

	details, err := client.GetIssue(context.Background(), "o", "r", 1)
	require.NoError(t, err)
	require.Equal(t, "Body with whitespace", details.Body)
}

// ============================================================================
// JSON Serialization Tests
// ============================================================================

func TestIssueListItem_JSONSerialization(t *testing.T) {
	item := IssueListItem{
		Number:    42,
		Title:     "Test Issue",
		State:     "open",
		HTMLURL:   "https://github.com/o/r/issues/42",
		Labels:    []IssueLabel{{Name: "bug", Color: "d73a4a"}},
		User:      IssueUser{Login: "alice", AvatarURL: "https://github.com/alice.png"},
		Assignees: []IssueUser{{Login: "bob", AvatarURL: "https://github.com/bob.png"}},
		Comments:  5,
		CreatedAt: time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC),
		UpdatedAt: time.Date(2024, 1, 2, 0, 0, 0, 0, time.UTC),
	}

	data, err := json.Marshal(item)
	require.NoError(t, err)

	// Verify camelCase field names
	var raw map[string]interface{}
	require.NoError(t, json.Unmarshal(data, &raw))
	require.Contains(t, raw, "htmlUrl")
	require.Contains(t, raw, "createdAt")
	require.Contains(t, raw, "updatedAt")
	userMap := raw["user"].(map[string]interface{})
	require.Contains(t, userMap, "avatarUrl")

	// Round-trip
	var decoded IssueListItem
	require.NoError(t, json.Unmarshal(data, &decoded))
	require.Equal(t, item.Number, decoded.Number)
	require.Equal(t, item.Title, decoded.Title)
	require.Equal(t, item.HTMLURL, decoded.HTMLURL)
	require.Equal(t, item.User.Login, decoded.User.Login)
}

func TestIssueDetails_JSONSerialization(t *testing.T) {
	details := IssueDetails{
		IssueListItem: IssueListItem{
			Number:  42,
			Title:   "Test",
			State:   "open",
			HTMLURL: "https://github.com/o/r/issues/42",
			User:    IssueUser{Login: "alice"},
		},
		Body:      "Description here",
		Milestone: &IssueMilestone{Number: 1, Title: "v1.0", State: "open"},
	}

	data, err := json.Marshal(details)
	require.NoError(t, err)

	var decoded IssueDetails
	require.NoError(t, json.Unmarshal(data, &decoded))
	require.Equal(t, 42, decoded.Number)
	require.Equal(t, "Description here", decoded.Body)
	require.NotNil(t, decoded.Milestone)
	require.Equal(t, "v1.0", decoded.Milestone.Title)
}

func TestSearchIssuesResult_JSONSerialization(t *testing.T) {
	result := SearchIssuesResult{
		TotalCount: 1,
		Issues: []IssueListItem{
			{Number: 1, Title: "Test", State: "open", User: IssueUser{Login: "a"}},
		},
	}

	data, err := json.Marshal(result)
	require.NoError(t, err)

	var raw map[string]interface{}
	require.NoError(t, json.Unmarshal(data, &raw))
	require.Contains(t, raw, "totalCount")
	require.Contains(t, raw, "issues")

	var decoded SearchIssuesResult
	require.NoError(t, json.Unmarshal(data, &decoded))
	require.Equal(t, 1, decoded.TotalCount)
	require.Len(t, decoded.Issues, 1)
}
