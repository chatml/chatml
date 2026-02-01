package ai

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// ---------------------------------------------------------------------------
// parsePRResponse tests
// ---------------------------------------------------------------------------

func TestParsePRResponse_TitleAndBody(t *testing.T) {
	input := "TITLE: Add user authentication flow\n\nBODY:\n- Added login endpoint\n- Added JWT middleware"
	result := parsePRResponse(input)

	assert.Equal(t, "Add user authentication flow", result.Title)
	assert.Equal(t, "- Added login endpoint\n- Added JWT middleware", result.Body)
}

func TestParsePRResponse_TitleOnly(t *testing.T) {
	input := "TITLE: Fix typo in README"
	result := parsePRResponse(input)

	assert.Equal(t, "Fix typo in README", result.Title)
	assert.Empty(t, result.Body)
}

func TestParsePRResponse_WithWhitespace(t *testing.T) {
	input := "  TITLE:  Add feature  \n\n  BODY:  \n  Some description  "
	result := parsePRResponse(input)

	assert.Equal(t, "Add feature", result.Title)
	assert.Equal(t, "Some description", result.Body)
}

func TestParsePRResponse_FallbackNoPrefix(t *testing.T) {
	input := "Fix the broken tests\n\nThis fixes the flaky test suite by adding retries."
	result := parsePRResponse(input)

	assert.Equal(t, "Fix the broken tests", result.Title)
	assert.Equal(t, "This fixes the flaky test suite by adding retries.", result.Body)
}

func TestParsePRResponse_FallbackSingleLine(t *testing.T) {
	input := "Simple title only"
	result := parsePRResponse(input)

	assert.Equal(t, "Simple title only", result.Title)
	assert.Empty(t, result.Body)
}

func TestParsePRResponse_EmptyInput(t *testing.T) {
	result := parsePRResponse("")
	assert.Empty(t, result.Title)
	assert.Empty(t, result.Body)
}

func TestParsePRResponse_MultilineBody(t *testing.T) {
	input := `TITLE: Refactor database layer

BODY:
## Changes
- Extracted query builder
- Added connection pooling
- Updated migrations

## Testing
- All existing tests pass
- Added integration tests`

	result := parsePRResponse(input)

	assert.Equal(t, "Refactor database layer", result.Title)
	assert.Contains(t, result.Body, "## Changes")
	assert.Contains(t, result.Body, "## Testing")
	assert.Contains(t, result.Body, "Added integration tests")
}

// ---------------------------------------------------------------------------
// NewClient tests
// ---------------------------------------------------------------------------

func TestNewClient_EmptyKey(t *testing.T) {
	client := NewClient("")
	assert.Nil(t, client)
}

func TestNewClient_ValidKey(t *testing.T) {
	client := NewClient("sk-test-key")
	assert.NotNil(t, client)
	assert.Equal(t, "sk-test-key", client.apiKey)
	assert.Equal(t, defaultModel, client.model)
}

// ---------------------------------------------------------------------------
// GeneratePRDescription tests (with mock HTTP server)
// ---------------------------------------------------------------------------

func TestGeneratePRDescription_Success(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Verify request headers
		assert.Equal(t, "application/json", r.Header.Get("Content-Type"))
		assert.Equal(t, "sk-test-key", r.Header.Get("x-api-key"))
		assert.Equal(t, apiVersion, r.Header.Get("anthropic-version"))
		assert.Equal(t, "POST", r.Method)

		// Verify request body
		body, err := io.ReadAll(r.Body)
		require.NoError(t, err)

		var apiReq anthropicRequest
		require.NoError(t, json.Unmarshal(body, &apiReq))
		assert.Equal(t, defaultModel, apiReq.Model)
		assert.Equal(t, maxTokens, apiReq.MaxTokens)
		assert.Len(t, apiReq.Messages, 1)
		assert.Equal(t, "user", apiReq.Messages[0].Role)
		assert.Contains(t, apiReq.Messages[0].Content, "feature/auth")
		assert.Contains(t, apiReq.Messages[0].Content, "Add login")

		// Return mock response
		resp := anthropicResponse{
			Content: []struct {
				Type string `json:"type"`
				Text string `json:"text"`
			}{
				{Type: "text", Text: "TITLE: Add authentication flow\n\nBODY:\n- Added login endpoint\n- Added JWT tokens"},
			},
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(resp)
	}))
	defer server.Close()

	client := NewClient("sk-test-key")
	client.apiURL = server.URL

	result, err := client.GeneratePRDescription(context.Background(), GeneratePRRequest{
		Commits: []CommitInfo{
			{SHA: "abc1234567890", Message: "Add login endpoint", Author: "dev", Files: 3},
			{SHA: "def4567890123", Message: "Add JWT middleware", Author: "dev", Files: 2},
		},
		DiffSummary: "5 files changed, 200 insertions(+), 10 deletions(-)",
		BranchName:  "feature/auth",
		BaseBranch:  "main",
	})

	require.NoError(t, err)
	assert.Equal(t, "Add authentication flow", result.Title)
	assert.Contains(t, result.Body, "login endpoint")
}

func TestGeneratePRDescription_NilClient(t *testing.T) {
	var client *Client
	_, err := client.GeneratePRDescription(context.Background(), GeneratePRRequest{})
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "not configured")
}

func TestGeneratePRDescription_APIError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusTooManyRequests)
		w.Write([]byte(`{"error": "rate limited"}`))
	}))
	defer server.Close()

	client := NewClient("sk-test-key")
	client.apiURL = server.URL

	_, err := client.GeneratePRDescription(context.Background(), GeneratePRRequest{
		Commits:    []CommitInfo{{SHA: "abc1234567890", Message: "test", Author: "dev", Files: 1}},
		BranchName: "test",
		BaseBranch: "main",
	})

	assert.Error(t, err)
	assert.Contains(t, err.Error(), "429")
}

func TestGeneratePRDescription_EmptyResponse(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		resp := anthropicResponse{Content: nil}
		json.NewEncoder(w).Encode(resp)
	}))
	defer server.Close()

	client := NewClient("sk-test-key")
	client.apiURL = server.URL

	_, err := client.GeneratePRDescription(context.Background(), GeneratePRRequest{
		Commits:    []CommitInfo{{SHA: "abc1234567890", Message: "test", Author: "dev", Files: 1}},
		BranchName: "test",
		BaseBranch: "main",
	})

	assert.Error(t, err)
	assert.Contains(t, err.Error(), "empty response")
}

func TestGeneratePRDescription_CustomPrompt(t *testing.T) {
	var capturedSystem string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		var apiReq anthropicRequest
		json.Unmarshal(body, &apiReq)
		capturedSystem = apiReq.System

		resp := anthropicResponse{
			Content: []struct {
				Type string `json:"type"`
				Text string `json:"text"`
			}{
				{Type: "text", Text: "TITLE: Test\n\nBODY:\nTest body"},
			},
		}
		json.NewEncoder(w).Encode(resp)
	}))
	defer server.Close()

	client := NewClient("sk-test-key")
	client.apiURL = server.URL

	_, err := client.GeneratePRDescription(context.Background(), GeneratePRRequest{
		Commits:      []CommitInfo{{SHA: "abc1234567890", Message: "test", Author: "dev", Files: 1}},
		BranchName:   "test",
		BaseBranch:   "main",
		CustomPrompt: "Always mention the ticket number PROJ-123",
	})

	require.NoError(t, err)
	assert.Contains(t, capturedSystem, "PROJ-123")
	assert.Contains(t, capturedSystem, defaultSystemPrompt)
}

func TestGeneratePRDescription_ContextCancellation(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Simulate slow response — won't matter because context is cancelled
		select {
		case <-r.Context().Done():
			return
		}
	}))
	defer server.Close()

	client := NewClient("sk-test-key")
	client.apiURL = server.URL

	ctx, cancel := context.WithCancel(context.Background())
	cancel() // Cancel immediately

	_, err := client.GeneratePRDescription(ctx, GeneratePRRequest{
		Commits:    []CommitInfo{{SHA: "abc1234567890", Message: "test", Author: "dev", Files: 1}},
		BranchName: "test",
		BaseBranch: "main",
	})

	assert.Error(t, err)
}
