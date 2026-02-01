package github

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestClient_ListOpenPRs_Success(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		require.Equal(t, "/repos/testowner/testrepo/pulls", r.URL.Path)
		require.Equal(t, "state=open&per_page=100", r.URL.RawQuery)
		require.Equal(t, "Bearer test_token", r.Header.Get("Authorization"))
		require.Equal(t, "application/vnd.github+json", r.Header.Get("Accept"))

		prs := []map[string]interface{}{
			{
				"number":   1,
				"state":    "open",
				"title":    "First PR",
				"html_url": "https://github.com/testowner/testrepo/pull/1",
				"draft":    false,
				"head": map[string]string{
					"ref": "feature-branch-1",
					"sha": "abc123",
				},
			},
			{
				"number":   2,
				"state":    "open",
				"title":    "Second PR (draft)",
				"html_url": "https://github.com/testowner/testrepo/pull/2",
				"draft":    true,
				"head": map[string]string{
					"ref": "feature-branch-2",
					"sha": "def456",
				},
			},
		}
		json.NewEncoder(w).Encode(prs)
	}))
	defer server.Close()

	client := NewClient("", "")
	client.apiURL = server.URL
	client.SetToken("test_token")

	prs, err := client.ListOpenPRs(context.Background(), "testowner", "testrepo")
	require.NoError(t, err)
	require.Len(t, prs, 2)

	require.Equal(t, 1, prs[0].Number)
	require.Equal(t, "open", prs[0].State)
	require.Equal(t, "First PR", prs[0].Title)
	require.Equal(t, "https://github.com/testowner/testrepo/pull/1", prs[0].HTMLURL)
	require.False(t, prs[0].IsDraft)
	require.Equal(t, "feature-branch-1", prs[0].Branch)
	require.Equal(t, "abc123", prs[0].HeadSHA)

	require.Equal(t, 2, prs[1].Number)
	require.True(t, prs[1].IsDraft)
	require.Equal(t, "feature-branch-2", prs[1].Branch)
}

func TestClient_ListOpenPRs_EmptyList(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode([]map[string]interface{}{})
	}))
	defer server.Close()

	client := NewClient("", "")
	client.apiURL = server.URL
	client.SetToken("test_token")

	prs, err := client.ListOpenPRs(context.Background(), "testowner", "testrepo")
	require.NoError(t, err)
	require.Len(t, prs, 0)
}

func TestClient_ListOpenPRs_NotAuthenticated(t *testing.T) {
	client := NewClient("", "")
	// No token set

	_, err := client.ListOpenPRs(context.Background(), "testowner", "testrepo")
	require.Error(t, err)
	require.Contains(t, err.Error(), "not authenticated")
}

func TestClient_ListOpenPRs_HTTPError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusForbidden)
		w.Write([]byte(`{"message": "API rate limit exceeded"}`))
	}))
	defer server.Close()

	client := NewClient("", "")
	client.apiURL = server.URL
	client.SetToken("test_token")

	_, err := client.ListOpenPRs(context.Background(), "testowner", "testrepo")
	require.Error(t, err)
	require.Contains(t, err.Error(), "403")
}

func TestClient_ListOpenPRs_InvalidJSON(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("not valid json"))
	}))
	defer server.Close()

	client := NewClient("", "")
	client.apiURL = server.URL
	client.SetToken("test_token")

	_, err := client.ListOpenPRs(context.Background(), "testowner", "testrepo")
	require.Error(t, err)
	require.Contains(t, err.Error(), "decoding")
}

func TestClient_GetPRDetails_Success(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/repos/testowner/testrepo/pulls/1":
			pr := map[string]interface{}{
				"number":          1,
				"state":           "open",
				"title":           "Test PR",
				"html_url":        "https://github.com/testowner/testrepo/pull/1",
				"mergeable":       true,
				"mergeable_state": "clean",
				"head": map[string]string{
					"sha": "abc123",
				},
			}
			json.NewEncoder(w).Encode(pr)
		case "/repos/testowner/testrepo/commits/abc123/check-runs":
			checks := map[string]interface{}{
				"total_count": 2,
				"check_runs": []map[string]interface{}{
					{
						"name":       "build",
						"status":     "completed",
						"conclusion": "success",
					},
					{
						"name":       "test",
						"status":     "completed",
						"conclusion": "success",
					},
				},
			}
			json.NewEncoder(w).Encode(checks)
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	client := NewClient("", "")
	client.apiURL = server.URL
	client.SetToken("test_token")

	details, err := client.GetPRDetails(context.Background(), "testowner", "testrepo", 1)
	require.NoError(t, err)
	require.NotNil(t, details)

	require.Equal(t, 1, details.Number)
	require.Equal(t, "open", details.State)
	require.Equal(t, "Test PR", details.Title)
	require.Equal(t, "https://github.com/testowner/testrepo/pull/1", details.HTMLURL)
	require.NotNil(t, details.Mergeable)
	require.True(t, *details.Mergeable)
	require.Equal(t, "clean", details.MergeableState)
	require.Equal(t, CheckStatusSuccess, details.CheckStatus)
	require.Len(t, details.CheckDetails, 2)
}

func TestClient_GetPRDetails_ChecksPending(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/repos/testowner/testrepo/pulls/1":
			pr := map[string]interface{}{
				"number":          1,
				"state":           "open",
				"title":           "Test PR",
				"html_url":        "https://github.com/testowner/testrepo/pull/1",
				"mergeable":       nil,
				"mergeable_state": "unknown",
				"head": map[string]string{
					"sha": "abc123",
				},
			}
			json.NewEncoder(w).Encode(pr)
		case "/repos/testowner/testrepo/commits/abc123/check-runs":
			checks := map[string]interface{}{
				"total_count": 1,
				"check_runs": []map[string]interface{}{
					{
						"name":       "build",
						"status":     "in_progress",
						"conclusion": nil,
					},
				},
			}
			json.NewEncoder(w).Encode(checks)
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	client := NewClient("", "")
	client.apiURL = server.URL
	client.SetToken("test_token")

	details, err := client.GetPRDetails(context.Background(), "testowner", "testrepo", 1)
	require.NoError(t, err)
	require.NotNil(t, details)
	require.Equal(t, CheckStatusPending, details.CheckStatus)
}

func TestClient_GetPRDetails_ChecksFailure(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/repos/testowner/testrepo/pulls/1":
			pr := map[string]interface{}{
				"number":          1,
				"state":           "open",
				"title":           "Test PR",
				"html_url":        "https://github.com/testowner/testrepo/pull/1",
				"mergeable":       false,
				"mergeable_state": "blocked",
				"head": map[string]string{
					"sha": "abc123",
				},
			}
			json.NewEncoder(w).Encode(pr)
		case "/repos/testowner/testrepo/commits/abc123/check-runs":
			checks := map[string]interface{}{
				"total_count": 2,
				"check_runs": []map[string]interface{}{
					{
						"name":       "build",
						"status":     "completed",
						"conclusion": "success",
					},
					{
						"name":       "test",
						"status":     "completed",
						"conclusion": "failure",
					},
				},
			}
			json.NewEncoder(w).Encode(checks)
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	client := NewClient("", "")
	client.apiURL = server.URL
	client.SetToken("test_token")

	details, err := client.GetPRDetails(context.Background(), "testowner", "testrepo", 1)
	require.NoError(t, err)
	require.NotNil(t, details)
	require.Equal(t, CheckStatusFailure, details.CheckStatus)
}

func TestClient_GetPRDetails_NoChecks(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/repos/testowner/testrepo/pulls/1":
			pr := map[string]interface{}{
				"number":          1,
				"state":           "open",
				"title":           "Test PR",
				"html_url":        "https://github.com/testowner/testrepo/pull/1",
				"mergeable":       true,
				"mergeable_state": "clean",
				"head": map[string]string{
					"sha": "abc123",
				},
			}
			json.NewEncoder(w).Encode(pr)
		case "/repos/testowner/testrepo/commits/abc123/check-runs":
			checks := map[string]interface{}{
				"total_count": 0,
				"check_runs":  []map[string]interface{}{},
			}
			json.NewEncoder(w).Encode(checks)
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	client := NewClient("", "")
	client.apiURL = server.URL
	client.SetToken("test_token")

	details, err := client.GetPRDetails(context.Background(), "testowner", "testrepo", 1)
	require.NoError(t, err)
	require.NotNil(t, details)
	require.Equal(t, CheckStatusNone, details.CheckStatus)
}

func TestClient_GetPRDetails_NotFound(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))
	defer server.Close()

	client := NewClient("", "")
	client.apiURL = server.URL
	client.SetToken("test_token")

	details, err := client.GetPRDetails(context.Background(), "testowner", "testrepo", 999)
	require.NoError(t, err)
	require.Nil(t, details)
}

func TestClient_GetPRDetails_NotAuthenticated(t *testing.T) {
	client := NewClient("", "")
	// No token set

	_, err := client.GetPRDetails(context.Background(), "testowner", "testrepo", 1)
	require.Error(t, err)
	require.Contains(t, err.Error(), "not authenticated")
}

func TestClient_ListOpenPRsWithETag_Success(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		require.Equal(t, "/repos/testowner/testrepo/pulls", r.URL.Path)

		// Should not send If-None-Match when no etag provided
		require.Empty(t, r.Header.Get("If-None-Match"))

		w.Header().Set("ETag", "W/\"abc123\"")
		prs := []map[string]interface{}{
			{
				"number":   1,
				"state":    "open",
				"title":    "Test PR",
				"html_url": "https://github.com/testowner/testrepo/pull/1",
				"draft":    false,
				"head":     map[string]string{"ref": "feature-1", "sha": "sha1"},
			},
		}
		json.NewEncoder(w).Encode(prs)
	}))
	defer server.Close()

	client := NewClient("", "")
	client.apiURL = server.URL
	client.SetToken("test_token")

	result, err := client.ListOpenPRsWithETag(context.Background(), "testowner", "testrepo", "")
	require.NoError(t, err)
	require.NotNil(t, result)
	require.Len(t, result.PRs, 1)
	require.Equal(t, "W/\"abc123\"", result.ETag)
	require.Equal(t, 1, result.PRs[0].Number)
}

func TestClient_ListOpenPRsWithETag_NotModified(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Should send If-None-Match with the provided etag
		require.Equal(t, "W/\"abc123\"", r.Header.Get("If-None-Match"))

		w.WriteHeader(http.StatusNotModified)
	}))
	defer server.Close()

	client := NewClient("", "")
	client.apiURL = server.URL
	client.SetToken("test_token")

	result, err := client.ListOpenPRsWithETag(context.Background(), "testowner", "testrepo", "W/\"abc123\"")
	require.ErrorIs(t, err, ErrNotModified)
	require.Nil(t, result)
}

func TestClient_ListOpenPRsWithETag_SendsETagHeader(t *testing.T) {
	var receivedETag string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		receivedETag = r.Header.Get("If-None-Match")
		w.Header().Set("ETag", "W/\"new-etag\"")
		json.NewEncoder(w).Encode([]map[string]interface{}{})
	}))
	defer server.Close()

	client := NewClient("", "")
	client.apiURL = server.URL
	client.SetToken("test_token")

	result, err := client.ListOpenPRsWithETag(context.Background(), "testowner", "testrepo", "W/\"old-etag\"")
	require.NoError(t, err)
	require.Equal(t, "W/\"old-etag\"", receivedETag)
	require.Equal(t, "W/\"new-etag\"", result.ETag)
}

func TestClient_ListOpenPRsWithETag_NotAuthenticated(t *testing.T) {
	client := NewClient("", "")

	_, err := client.ListOpenPRsWithETag(context.Background(), "testowner", "testrepo", "")
	require.Error(t, err)
	require.Contains(t, err.Error(), "not authenticated")
}

func TestClient_FindPRForBranch_Success(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		require.Equal(t, "/repos/testowner/testrepo/pulls", r.URL.Path)
		require.Contains(t, r.URL.RawQuery, "head=testowner:feature-branch")
		require.Contains(t, r.URL.RawQuery, "state=open")

		prs := []map[string]interface{}{
			{
				"number": 42,
				"state":  "open",
				"title":  "Feature Branch PR",
			},
		}
		json.NewEncoder(w).Encode(prs)
	}))
	defer server.Close()

	client := NewClient("", "")
	client.apiURL = server.URL
	client.SetToken("test_token")

	prNumber, err := client.FindPRForBranch(context.Background(), "testowner", "testrepo", "feature-branch")
	require.NoError(t, err)
	require.Equal(t, 42, prNumber)
}

func TestClient_FindPRForBranch_NoPR(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode([]map[string]interface{}{})
	}))
	defer server.Close()

	client := NewClient("", "")
	client.apiURL = server.URL
	client.SetToken("test_token")

	prNumber, err := client.FindPRForBranch(context.Background(), "testowner", "testrepo", "no-pr-branch")
	require.NoError(t, err)
	require.Equal(t, 0, prNumber)
}

func TestClient_FindPRForBranch_NotAuthenticated(t *testing.T) {
	client := NewClient("", "")
	// No token set

	_, err := client.FindPRForBranch(context.Background(), "testowner", "testrepo", "feature-branch")
	require.Error(t, err)
	require.Contains(t, err.Error(), "not authenticated")
}

// ============================================================================
// GetPRFullDetails Tests
// ============================================================================

func TestClient_GetPRFullDetails_Success(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		require.Equal(t, "/repos/testowner/testrepo/pulls/42", r.URL.Path)
		require.Equal(t, "Bearer test_token", r.Header.Get("Authorization"))

		pr := map[string]interface{}{
			"number":        42,
			"state":         "open",
			"title":         "Add new feature",
			"html_url":      "https://github.com/testowner/testrepo/pull/42",
			"body":          "This PR adds a great new feature.\n\nCloses #10",
			"draft":         false,
			"additions":     150,
			"deletions":     30,
			"changed_files": 5,
			"head": map[string]string{
				"ref": "feature/new-thing",
				"sha": "abc123",
			},
			"base": map[string]string{
				"ref": "main",
			},
			"labels": []map[string]string{
				{"name": "enhancement"},
				{"name": "needs-review"},
			},
			"requested_reviewers": []map[string]string{
				{"login": "reviewer1"},
				{"login": "reviewer2"},
			},
		}
		json.NewEncoder(w).Encode(pr)
	}))
	defer server.Close()

	client := NewClient("", "")
	client.apiURL = server.URL
	client.SetToken("test_token")

	details, err := client.GetPRFullDetails(context.Background(), "testowner", "testrepo", 42)
	require.NoError(t, err)
	require.NotNil(t, details)

	require.Equal(t, 42, details.Number)
	require.Equal(t, "open", details.State)
	require.Equal(t, "Add new feature", details.Title)
	require.Equal(t, "https://github.com/testowner/testrepo/pull/42", details.HTMLURL)
	require.Equal(t, "This PR adds a great new feature.\n\nCloses #10", details.Body)
	require.Equal(t, "feature/new-thing", details.Branch)
	require.Equal(t, "main", details.BaseBranch)
	require.False(t, details.IsDraft)
	require.Equal(t, 150, details.Additions)
	require.Equal(t, 30, details.Deletions)
	require.Equal(t, 5, details.ChangedFiles)
	require.Equal(t, []string{"enhancement", "needs-review"}, details.Labels)
	require.Equal(t, []string{"reviewer1", "reviewer2"}, details.Reviewers)
}

func TestClient_GetPRFullDetails_DraftPR(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		pr := map[string]interface{}{
			"number":        7,
			"state":         "open",
			"title":         "WIP: Draft feature",
			"html_url":      "https://github.com/testowner/testrepo/pull/7",
			"body":          "",
			"draft":         true,
			"additions":     10,
			"deletions":     0,
			"changed_files": 1,
			"head":          map[string]string{"ref": "draft-branch", "sha": "def456"},
			"base":          map[string]string{"ref": "develop"},
			"labels":        []map[string]string{},
			"requested_reviewers": []map[string]string{},
		}
		json.NewEncoder(w).Encode(pr)
	}))
	defer server.Close()

	client := NewClient("", "")
	client.apiURL = server.URL
	client.SetToken("test_token")

	details, err := client.GetPRFullDetails(context.Background(), "testowner", "testrepo", 7)
	require.NoError(t, err)
	require.NotNil(t, details)

	require.True(t, details.IsDraft)
	require.Equal(t, "", details.Body)
	require.Equal(t, "develop", details.BaseBranch)
	require.Empty(t, details.Labels)
	require.Empty(t, details.Reviewers)
}

func TestClient_GetPRFullDetails_NotFound(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))
	defer server.Close()

	client := NewClient("", "")
	client.apiURL = server.URL
	client.SetToken("test_token")

	_, err := client.GetPRFullDetails(context.Background(), "testowner", "testrepo", 999)
	require.Error(t, err)
	require.Contains(t, err.Error(), "not found")
}

func TestClient_GetPRFullDetails_NotAuthenticated(t *testing.T) {
	client := NewClient("", "")

	_, err := client.GetPRFullDetails(context.Background(), "testowner", "testrepo", 1)
	require.Error(t, err)
	require.Contains(t, err.Error(), "not authenticated")
}

func TestClient_GetPRFullDetails_HTTPError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusForbidden)
		w.Write([]byte(`{"message": "API rate limit exceeded"}`))
	}))
	defer server.Close()

	client := NewClient("", "")
	client.apiURL = server.URL
	client.SetToken("test_token")

	_, err := client.GetPRFullDetails(context.Background(), "testowner", "testrepo", 1)
	require.Error(t, err)
	require.Contains(t, err.Error(), "403")
}
