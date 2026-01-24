package agents

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
// Constructor Tests
// ============================================================================

func TestNewGitHubAdapter(t *testing.T) {
	adapter := NewGitHubAdapter("test-token")

	require.NotNil(t, adapter)
	require.Equal(t, "test-token", adapter.token)
	require.Equal(t, "https://api.github.com", adapter.apiURL)
	require.NotNil(t, adapter.httpClient)
	require.NotNil(t, adapter.cache)
}

func TestGitHubAdapter_SetToken(t *testing.T) {
	adapter := NewGitHubAdapter("initial-token")
	require.Equal(t, "initial-token", adapter.token)

	adapter.SetToken("new-token")
	require.Equal(t, "new-token", adapter.token)
}

// ============================================================================
// Poll Tests
// ============================================================================

func TestGitHubAdapter_Poll_Issues(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		require.Equal(t, "Bearer test-token", r.Header.Get("Authorization"))
		require.Contains(t, r.URL.Path, "/repos/owner/repo/issues")
		require.Equal(t, "open", r.URL.Query().Get("state"))

		issues := []GitHubIssue{
			{Number: 1, Title: "Issue 1", State: "open"},
			{Number: 2, Title: "Issue 2", State: "open"},
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(issues)
	}))
	defer server.Close()

	adapter := NewGitHubAdapter("test-token")
	adapter.apiURL = server.URL

	result, err := adapter.Poll(context.Background(), "owner", "repo", map[string]interface{}{
		"resources": []string{"issues"},
	})

	require.NoError(t, err)
	require.NotNil(t, result)
	require.Len(t, result.Issues, 2)
	require.Equal(t, 1, result.Issues[0].Number)
	require.Equal(t, "Issue 1", result.Issues[0].Title)
}

func TestGitHubAdapter_Poll_PullRequests(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Return issues with PullRequest field set (GitHub returns PRs in issues endpoint)
		issues := []GitHubIssue{
			{Number: 10, Title: "PR 1", State: "open", PullRequest: &GitHubPRRef{URL: "https://api.github.com/pulls/10"}},
			{Number: 11, Title: "PR 2", State: "open", PullRequest: &GitHubPRRef{URL: "https://api.github.com/pulls/11"}},
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(issues)
	}))
	defer server.Close()

	adapter := NewGitHubAdapter("test-token")
	adapter.apiURL = server.URL

	result, err := adapter.Poll(context.Background(), "owner", "repo", map[string]interface{}{
		"resources": []string{"pull_requests"},
	})

	require.NoError(t, err)
	require.NotNil(t, result)
	require.Len(t, result.PullRequests, 2)
}

func TestGitHubAdapter_Poll_Both(t *testing.T) {
	callCount := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		callCount++
		// Return mixed issues and PRs
		issues := []GitHubIssue{
			{Number: 1, Title: "Issue 1", State: "open"},
			{Number: 10, Title: "PR 1", State: "open", PullRequest: &GitHubPRRef{URL: "https://api.github.com/pulls/10"}},
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(issues)
	}))
	defer server.Close()

	adapter := NewGitHubAdapter("test-token")
	adapter.apiURL = server.URL

	result, err := adapter.Poll(context.Background(), "owner", "repo", map[string]interface{}{
		"resources": []string{"issues", "pulls"},
	})

	require.NoError(t, err)
	require.NotNil(t, result)
	require.Equal(t, 2, callCount, "should make separate calls for issues and pulls")
}

func TestGitHubAdapter_Poll_DefaultResources(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		issues := []GitHubIssue{
			{Number: 1, Title: "Issue 1", State: "open"},
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(issues)
	}))
	defer server.Close()

	adapter := NewGitHubAdapter("test-token")
	adapter.apiURL = server.URL

	// No resources specified - defaults to issues
	result, err := adapter.Poll(context.Background(), "owner", "repo", nil)

	require.NoError(t, err)
	require.NotNil(t, result)
	require.Len(t, result.Issues, 1)
}

func TestGitHubAdapter_Poll_WithFilters_State(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		require.Equal(t, "closed", r.URL.Query().Get("state"))

		issues := []GitHubIssue{}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(issues)
	}))
	defer server.Close()

	adapter := NewGitHubAdapter("test-token")
	adapter.apiURL = server.URL

	_, err := adapter.Poll(context.Background(), "owner", "repo", map[string]interface{}{
		"state": "closed",
	})

	require.NoError(t, err)
}

func TestGitHubAdapter_Poll_WithFilters_Labels(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		require.Equal(t, "bug,high-priority", r.URL.Query().Get("labels"))

		issues := []GitHubIssue{}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(issues)
	}))
	defer server.Close()

	adapter := NewGitHubAdapter("test-token")
	adapter.apiURL = server.URL

	_, err := adapter.Poll(context.Background(), "owner", "repo", map[string]interface{}{
		"labels": []string{"bug", "high-priority"},
	})

	require.NoError(t, err)
}

func TestGitHubAdapter_Poll_WithFilters_Labels_Interface(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		require.Equal(t, "bug,enhancement", r.URL.Query().Get("labels"))

		issues := []GitHubIssue{}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(issues)
	}))
	defer server.Close()

	adapter := NewGitHubAdapter("test-token")
	adapter.apiURL = server.URL

	_, err := adapter.Poll(context.Background(), "owner", "repo", map[string]interface{}{
		"labels": []interface{}{"bug", "enhancement"},
	})

	require.NoError(t, err)
}

func TestGitHubAdapter_Poll_WithFilters_Assignee(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		require.Equal(t, "johndoe", r.URL.Query().Get("assignee"))

		issues := []GitHubIssue{}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(issues)
	}))
	defer server.Close()

	adapter := NewGitHubAdapter("test-token")
	adapter.apiURL = server.URL

	_, err := adapter.Poll(context.Background(), "owner", "repo", map[string]interface{}{
		"assignee": "johndoe",
	})

	require.NoError(t, err)
}

func TestGitHubAdapter_Poll_WithFilters_Resources_Interface(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		issues := []GitHubIssue{}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(issues)
	}))
	defer server.Close()

	adapter := NewGitHubAdapter("test-token")
	adapter.apiURL = server.URL

	// Resources as []interface{} (from YAML parsing)
	_, err := adapter.Poll(context.Background(), "owner", "repo", map[string]interface{}{
		"resources": []interface{}{"issues"},
	})

	require.NoError(t, err)
}

func TestGitHubAdapter_Poll_ETag_NotModified(t *testing.T) {
	callCount := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		callCount++
		if callCount == 1 {
			// First call - return data with ETag
			issues := []GitHubIssue{{Number: 1, Title: "Issue 1"}}
			w.Header().Set("ETag", "\"abc123\"")
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(issues)
		} else {
			// Second call with If-None-Match - return 304
			if r.Header.Get("If-None-Match") == "\"abc123\"" {
				w.WriteHeader(http.StatusNotModified)
				return
			}
			// Should not reach here
			t.Error("Expected If-None-Match header")
		}
	}))
	defer server.Close()

	adapter := NewGitHubAdapter("test-token")
	adapter.apiURL = server.URL

	// First call - populates cache
	result1, err := adapter.Poll(context.Background(), "owner", "repo", nil)
	require.NoError(t, err)
	require.Len(t, result1.Issues, 1)
	require.False(t, result1.NotModified)

	// Second call - should get NotModified
	result2, err := adapter.Poll(context.Background(), "owner", "repo", nil)
	require.NoError(t, err)
	require.True(t, result2.NotModified)
}

func TestGitHubAdapter_Poll_APIError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusForbidden)
		w.Write([]byte(`{"message": "API rate limit exceeded"}`))
	}))
	defer server.Close()

	adapter := NewGitHubAdapter("test-token")
	adapter.apiURL = server.URL

	_, err := adapter.Poll(context.Background(), "owner", "repo", nil)

	require.Error(t, err)
	require.Contains(t, err.Error(), "403")
}

func TestGitHubAdapter_Poll_InvalidJSON(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte("not valid json"))
	}))
	defer server.Close()

	adapter := NewGitHubAdapter("test-token")
	adapter.apiURL = server.URL

	_, err := adapter.Poll(context.Background(), "owner", "repo", nil)

	require.Error(t, err)
	require.Contains(t, err.Error(), "decode")
}

func TestGitHubAdapter_Poll_ContextCancellation(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Simulate slow response
		time.Sleep(100 * time.Millisecond)
		json.NewEncoder(w).Encode([]GitHubIssue{})
	}))
	defer server.Close()

	adapter := NewGitHubAdapter("test-token")
	adapter.apiURL = server.URL

	ctx, cancel := context.WithCancel(context.Background())
	cancel() // Cancel immediately

	_, err := adapter.Poll(ctx, "owner", "repo", nil)

	require.Error(t, err)
}

func TestGitHubAdapter_Poll_NoToken(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Should not have Authorization header when token is empty
		require.Empty(t, r.Header.Get("Authorization"))

		issues := []GitHubIssue{}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(issues)
	}))
	defer server.Close()

	adapter := NewGitHubAdapter("")
	adapter.apiURL = server.URL

	_, err := adapter.Poll(context.Background(), "owner", "repo", nil)

	require.NoError(t, err)
}

// ============================================================================
// Filter Issues Tests
// ============================================================================

func TestFilterIssues_IssuesOnly(t *testing.T) {
	issues := []GitHubIssue{
		{Number: 1, Title: "Issue 1"},
		{Number: 2, Title: "PR 1", PullRequest: &GitHubPRRef{URL: "http://example.com"}},
		{Number: 3, Title: "Issue 2"},
	}

	filtered := filterIssues(issues, false)

	require.Len(t, filtered, 2)
	require.Equal(t, 1, filtered[0].Number)
	require.Equal(t, 3, filtered[1].Number)
}

func TestFilterIssues_PRsOnly(t *testing.T) {
	issues := []GitHubIssue{
		{Number: 1, Title: "Issue 1"},
		{Number: 2, Title: "PR 1", PullRequest: &GitHubPRRef{URL: "http://example.com"}},
		{Number: 3, Title: "PR 2", PullRequest: &GitHubPRRef{URL: "http://example.com"}},
	}

	filtered := filterIssues(issues, true)

	require.Len(t, filtered, 2)
	require.Equal(t, 2, filtered[0].Number)
	require.Equal(t, 3, filtered[1].Number)
}

func TestFilterIssues_Empty(t *testing.T) {
	issues := []GitHubIssue{}

	filteredIssues := filterIssues(issues, false)
	filteredPRs := filterIssues(issues, true)

	require.Empty(t, filteredIssues)
	require.Empty(t, filteredPRs)
}

func TestFilterIssues_AllIssues(t *testing.T) {
	issues := []GitHubIssue{
		{Number: 1, Title: "Issue 1"},
		{Number: 2, Title: "Issue 2"},
	}

	filteredIssues := filterIssues(issues, false)
	filteredPRs := filterIssues(issues, true)

	require.Len(t, filteredIssues, 2)
	require.Empty(t, filteredPRs)
}

func TestFilterIssues_AllPRs(t *testing.T) {
	issues := []GitHubIssue{
		{Number: 1, Title: "PR 1", PullRequest: &GitHubPRRef{URL: "http://example.com"}},
		{Number: 2, Title: "PR 2", PullRequest: &GitHubPRRef{URL: "http://example.com"}},
	}

	filteredIssues := filterIssues(issues, false)
	filteredPRs := filterIssues(issues, true)

	require.Empty(t, filteredIssues)
	require.Len(t, filteredPRs, 2)
}

// ============================================================================
// Parse Rate Limit Tests
// ============================================================================

func TestParseRateLimit(t *testing.T) {
	header := http.Header{}
	header.Set("X-RateLimit-Limit", "5000")
	header.Set("X-RateLimit-Remaining", "4999")
	header.Set("X-RateLimit-Reset", "1609459200")

	rl := parseRateLimit(header)

	require.Equal(t, 5000, rl.Limit)
	require.Equal(t, 4999, rl.Remaining)
	require.Equal(t, time.Unix(1609459200, 0), rl.Reset)
}

func TestParseRateLimit_MissingHeaders(t *testing.T) {
	header := http.Header{}

	rl := parseRateLimit(header)

	require.Equal(t, 0, rl.Limit)
	require.Equal(t, 0, rl.Remaining)
	require.True(t, rl.Reset.IsZero())
}

func TestParseRateLimit_PartialHeaders(t *testing.T) {
	header := http.Header{}
	header.Set("X-RateLimit-Limit", "5000")
	// Missing Remaining and Reset

	rl := parseRateLimit(header)

	require.Equal(t, 5000, rl.Limit)
	require.Equal(t, 0, rl.Remaining)
	require.True(t, rl.Reset.IsZero())
}

func TestParseRateLimit_InvalidValues(t *testing.T) {
	header := http.Header{}
	header.Set("X-RateLimit-Limit", "not-a-number")
	header.Set("X-RateLimit-Remaining", "abc")
	header.Set("X-RateLimit-Reset", "invalid")

	rl := parseRateLimit(header)

	// Should default to zero on parse error
	require.Equal(t, 0, rl.Limit)
	require.Equal(t, 0, rl.Remaining)
	require.True(t, rl.Reset.IsZero())
}

// ============================================================================
// Get Rate Limit Tests
// ============================================================================

func TestGitHubAdapter_GetRateLimit(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		require.Equal(t, "/rate_limit", r.URL.Path)

		w.Header().Set("X-RateLimit-Limit", "5000")
		w.Header().Set("X-RateLimit-Remaining", "4500")
		w.Header().Set("X-RateLimit-Reset", "1609459200")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("{}"))
	}))
	defer server.Close()

	adapter := NewGitHubAdapter("test-token")
	adapter.apiURL = server.URL

	rl, err := adapter.GetRateLimit(context.Background())

	require.NoError(t, err)
	require.NotNil(t, rl)
	require.Equal(t, 5000, rl.Limit)
	require.Equal(t, 4500, rl.Remaining)
}

// ============================================================================
// Rate Limit Check Tests
// ============================================================================

func TestGitHubAdapter_IsRateLimited_True(t *testing.T) {
	adapter := NewGitHubAdapter("test-token")

	rl := GitHubRateLimit{
		Limit:     5000,
		Remaining: 0,
		Reset:     time.Now().Add(1 * time.Hour), // Reset in the future
	}

	require.True(t, adapter.IsRateLimited(rl))
}

func TestGitHubAdapter_IsRateLimited_False_HasRemaining(t *testing.T) {
	adapter := NewGitHubAdapter("test-token")

	rl := GitHubRateLimit{
		Limit:     5000,
		Remaining: 100,
		Reset:     time.Now().Add(1 * time.Hour),
	}

	require.False(t, adapter.IsRateLimited(rl))
}

func TestGitHubAdapter_IsRateLimited_False_ResetPassed(t *testing.T) {
	adapter := NewGitHubAdapter("test-token")

	rl := GitHubRateLimit{
		Limit:     5000,
		Remaining: 0,
		Reset:     time.Now().Add(-1 * time.Hour), // Reset in the past
	}

	require.False(t, adapter.IsRateLimited(rl))
}

// ============================================================================
// Time Until Reset Tests
// ============================================================================

func TestGitHubAdapter_TimeUntilReset(t *testing.T) {
	adapter := NewGitHubAdapter("test-token")

	rl := GitHubRateLimit{
		Reset: time.Now().Add(30 * time.Minute),
	}

	duration := adapter.TimeUntilReset(rl)

	// Should be approximately 30 minutes
	require.Greater(t, duration.Minutes(), 29.0)
	require.Less(t, duration.Minutes(), 31.0)
}

func TestGitHubAdapter_TimeUntilReset_AlreadyPassed(t *testing.T) {
	adapter := NewGitHubAdapter("test-token")

	rl := GitHubRateLimit{
		Reset: time.Now().Add(-1 * time.Hour), // Reset in the past
	}

	duration := adapter.TimeUntilReset(rl)

	require.Equal(t, time.Duration(0), duration)
}

// ============================================================================
// Issue Struct Tests
// ============================================================================

func TestGitHubIssue_JSONSerialization(t *testing.T) {
	now := time.Now().Truncate(time.Second)
	closedAt := now.Add(time.Hour)

	issue := GitHubIssue{
		Number:  42,
		Title:   "Test Issue",
		Body:    "This is the body",
		State:   "open",
		HTMLURL: "https://github.com/owner/repo/issues/42",
		Labels: []GitHubLabel{
			{ID: 1, Name: "bug", Color: "ff0000"},
		},
		User: GitHubUser{Login: "johndoe", AvatarURL: "https://example.com/avatar"},
		Assignees: []GitHubUser{
			{Login: "janedoe"},
		},
		CreatedAt: now,
		UpdatedAt: now,
		ClosedAt:  &closedAt,
	}

	data, err := json.Marshal(issue)
	require.NoError(t, err)

	var decoded GitHubIssue
	err = json.Unmarshal(data, &decoded)
	require.NoError(t, err)

	require.Equal(t, 42, decoded.Number)
	require.Equal(t, "Test Issue", decoded.Title)
	require.Len(t, decoded.Labels, 1)
	require.Equal(t, "bug", decoded.Labels[0].Name)
	require.NotNil(t, decoded.ClosedAt)
}

func TestGitHubPollResult_NotModified(t *testing.T) {
	result := GitHubPollResult{
		NotModified: true,
		RateLimit: GitHubRateLimit{
			Limit:     5000,
			Remaining: 4999,
		},
	}

	require.True(t, result.NotModified)
	require.Empty(t, result.Issues)
	require.Empty(t, result.PullRequests)
}
