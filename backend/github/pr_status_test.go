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
