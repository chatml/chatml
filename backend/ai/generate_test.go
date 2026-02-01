package ai

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
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

// ---------------------------------------------------------------------------
// GenerateConversationSummary tests
// ---------------------------------------------------------------------------

func TestGenerateConversationSummary_Success(t *testing.T) {
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
		assert.Equal(t, summaryMaxTokens, apiReq.MaxTokens)
		assert.Equal(t, summarySystemPrompt, apiReq.System)
		assert.Len(t, apiReq.Messages, 1)
		assert.Equal(t, "user", apiReq.Messages[0].Role)
		assert.Contains(t, apiReq.System, "Summarize this AI coding conversation")

		// Return mock response
		resp := anthropicResponse{
			Content: []struct {
				Type string `json:"type"`
				Text string `json:"text"`
			}{
				{Type: "text", Text: "  The conversation involved setting up authentication.  "},
			},
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(resp)
	}))
	defer server.Close()

	client := NewClient("sk-test-key")
	client.apiURL = server.URL

	result, err := client.GenerateConversationSummary(context.Background(), GenerateSummaryRequest{
		ConversationName: "Auth Setup",
		Messages: []SummaryMessage{
			{Role: "user", Content: "Help me set up authentication"},
			{Role: "assistant", Content: "Sure, I can help with that."},
		},
	})

	require.NoError(t, err)
	// Verify response is trimmed
	assert.Equal(t, "The conversation involved setting up authentication.", result)
}

func TestGenerateConversationSummary_NilClient(t *testing.T) {
	var client *Client
	_, err := client.GenerateConversationSummary(context.Background(), GenerateSummaryRequest{})
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "not configured")
}

func TestGenerateConversationSummary_APIError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte(`{"error": "internal server error"}`))
	}))
	defer server.Close()

	client := NewClient("sk-test-key")
	client.apiURL = server.URL

	_, err := client.GenerateConversationSummary(context.Background(), GenerateSummaryRequest{
		ConversationName: "Test",
		Messages: []SummaryMessage{
			{Role: "user", Content: "Hello"},
		},
	})

	assert.Error(t, err)
	assert.Contains(t, err.Error(), "500")
}

func TestGenerateConversationSummary_EmptyResponse(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		resp := anthropicResponse{Content: nil}
		json.NewEncoder(w).Encode(resp)
	}))
	defer server.Close()

	client := NewClient("sk-test-key")
	client.apiURL = server.URL

	_, err := client.GenerateConversationSummary(context.Background(), GenerateSummaryRequest{
		ConversationName: "Test",
		Messages: []SummaryMessage{
			{Role: "user", Content: "Hello"},
		},
	})

	assert.Error(t, err)
	assert.Contains(t, err.Error(), "empty response")
}

func TestGenerateConversationSummary_MessageTruncation(t *testing.T) {
	var capturedUserMsg string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		var apiReq anthropicRequest
		json.Unmarshal(body, &apiReq)
		capturedUserMsg = apiReq.Messages[0].Content

		resp := anthropicResponse{
			Content: []struct {
				Type string `json:"type"`
				Text string `json:"text"`
			}{
				{Type: "text", Text: "Summary of truncated conversation."},
			},
		}
		json.NewEncoder(w).Encode(resp)
	}))
	defer server.Close()

	client := NewClient("sk-test-key")
	client.apiURL = server.URL

	// Build messages that exceed maxInputChars (400000)
	// Use 50 messages of 10000 chars each = 500000 chars total
	bigContent := strings.Repeat("x", 10000)
	messages := make([]SummaryMessage, 50)
	for i := range messages {
		role := "user"
		if i%2 == 1 {
			role = "assistant"
		}
		messages[i] = SummaryMessage{Role: role, Content: bigContent}
	}

	result, err := client.GenerateConversationSummary(context.Background(), GenerateSummaryRequest{
		ConversationName: "Large Conversation",
		Messages:         messages,
	})

	require.NoError(t, err)
	assert.Equal(t, "Summary of truncated conversation.", result)

	// Verify first 2 messages are kept (their "--- User ---" / "--- Assistant ---" headers)
	assert.Contains(t, capturedUserMsg, "--- User ---")
	assert.Contains(t, capturedUserMsg, "--- Assistant ---")

	// Verify truncation marker is present
	assert.Contains(t, capturedUserMsg, "messages omitted")

	// Verify the total sent is less than the original 50 messages
	// The omitted marker proves middle messages were dropped
	omittedIdx := strings.Index(capturedUserMsg, "messages omitted")
	assert.Greater(t, omittedIdx, 0)
}

func TestGenerateConversationSummary_ConversationNameInPrompt(t *testing.T) {
	var capturedUserMsg string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		var apiReq anthropicRequest
		json.Unmarshal(body, &apiReq)
		capturedUserMsg = apiReq.Messages[0].Content

		resp := anthropicResponse{
			Content: []struct {
				Type string `json:"type"`
				Text string `json:"text"`
			}{
				{Type: "text", Text: "Summary."},
			},
		}
		json.NewEncoder(w).Encode(resp)
	}))
	defer server.Close()

	client := NewClient("sk-test-key")
	client.apiURL = server.URL

	_, err := client.GenerateConversationSummary(context.Background(), GenerateSummaryRequest{
		ConversationName: "Fix Authentication Bug",
		Messages: []SummaryMessage{
			{Role: "user", Content: "There is a bug in the auth module."},
		},
	})

	require.NoError(t, err)
	assert.Contains(t, capturedUserMsg, "Conversation: Fix Authentication Bug")
}

func TestGenerateConversationSummary_MessageFormatting(t *testing.T) {
	var capturedUserMsg string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		var apiReq anthropicRequest
		json.Unmarshal(body, &apiReq)
		capturedUserMsg = apiReq.Messages[0].Content

		resp := anthropicResponse{
			Content: []struct {
				Type string `json:"type"`
				Text string `json:"text"`
			}{
				{Type: "text", Text: "Summary."},
			},
		}
		json.NewEncoder(w).Encode(resp)
	}))
	defer server.Close()

	client := NewClient("sk-test-key")
	client.apiURL = server.URL

	_, err := client.GenerateConversationSummary(context.Background(), GenerateSummaryRequest{
		ConversationName: "Test Session",
		Messages: []SummaryMessage{
			{Role: "user", Content: "Please fix the bug"},
			{Role: "assistant", Content: "I will fix it now"},
			{Role: "system", Content: "Tool result here"},
		},
	})

	require.NoError(t, err)
	// Verify the "--- Role ---" format with capitalized role names
	assert.Contains(t, capturedUserMsg, "--- User ---\nPlease fix the bug")
	assert.Contains(t, capturedUserMsg, "--- Assistant ---\nI will fix it now")
	assert.Contains(t, capturedUserMsg, "--- System ---\nTool result here")
}

// ---------------------------------------------------------------------------
// GenerateSessionSummary tests
// ---------------------------------------------------------------------------

func TestGenerateSessionSummary_Success(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "application/json", r.Header.Get("Content-Type"))
		assert.Equal(t, "sk-test-key", r.Header.Get("x-api-key"))
		assert.Equal(t, apiVersion, r.Header.Get("anthropic-version"))
		assert.Equal(t, "POST", r.Method)

		body, err := io.ReadAll(r.Body)
		require.NoError(t, err)

		var apiReq anthropicRequest
		require.NoError(t, json.Unmarshal(body, &apiReq))
		assert.Equal(t, defaultModel, apiReq.Model)
		assert.Equal(t, summaryMaxTokens, apiReq.MaxTokens)
		assert.Equal(t, sessionSummarySystemPrompt, apiReq.System)
		assert.Len(t, apiReq.Messages, 1)
		assert.Equal(t, "user", apiReq.Messages[0].Role)

		resp := anthropicResponse{
			Content: []struct {
				Type string `json:"type"`
				Text string `json:"text"`
			}{
				{Type: "text", Text: "  The session implemented OAuth2 login.  "},
			},
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(resp)
	}))
	defer server.Close()

	client := NewClient("sk-test-key")
	client.apiURL = server.URL

	result, err := client.GenerateSessionSummary(context.Background(), GenerateSessionSummaryRequest{
		SessionName: "Auth Feature",
		Task:        "Build login flow",
		Conversations: []ConversationMessages{
			{
				Name: "Task Conv",
				Type: "task",
				Messages: []SummaryMessage{
					{Role: "user", Content: "Help me build OAuth2 login"},
					{Role: "assistant", Content: "I'll set up the OAuth2 flow."},
				},
			},
		},
	})

	require.NoError(t, err)
	assert.Equal(t, "The session implemented OAuth2 login.", result)
}

func TestGenerateSessionSummary_NilClient(t *testing.T) {
	var client *Client
	_, err := client.GenerateSessionSummary(context.Background(), GenerateSessionSummaryRequest{})
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "not configured")
}

func TestGenerateSessionSummary_APIError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte(`{"error": "internal server error"}`))
	}))
	defer server.Close()

	client := NewClient("sk-test-key")
	client.apiURL = server.URL

	_, err := client.GenerateSessionSummary(context.Background(), GenerateSessionSummaryRequest{
		SessionName: "Test",
		Conversations: []ConversationMessages{
			{Name: "Conv1", Type: "task", Messages: []SummaryMessage{{Role: "user", Content: "Hello"}}},
		},
	})

	assert.Error(t, err)
	assert.Contains(t, err.Error(), "500")
}

func TestGenerateSessionSummary_EmptyResponse(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		resp := anthropicResponse{Content: nil}
		json.NewEncoder(w).Encode(resp)
	}))
	defer server.Close()

	client := NewClient("sk-test-key")
	client.apiURL = server.URL

	_, err := client.GenerateSessionSummary(context.Background(), GenerateSessionSummaryRequest{
		SessionName: "Test",
		Conversations: []ConversationMessages{
			{Name: "Conv1", Type: "task", Messages: []SummaryMessage{{Role: "user", Content: "Hello"}}},
		},
	})

	assert.Error(t, err)
	assert.Contains(t, err.Error(), "empty response")
}

func TestGenerateSessionSummary_MessageTruncation(t *testing.T) {
	var capturedUserMsg string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		var apiReq anthropicRequest
		json.Unmarshal(body, &apiReq)
		capturedUserMsg = apiReq.Messages[0].Content

		resp := anthropicResponse{
			Content: []struct {
				Type string `json:"type"`
				Text string `json:"text"`
			}{
				{Type: "text", Text: "Summary of truncated session."},
			},
		}
		json.NewEncoder(w).Encode(resp)
	}))
	defer server.Close()

	client := NewClient("sk-test-key")
	client.apiURL = server.URL

	bigContent := strings.Repeat("x", 10000)
	messages := make([]SummaryMessage, 50)
	for i := range messages {
		role := "user"
		if i%2 == 1 {
			role = "assistant"
		}
		messages[i] = SummaryMessage{Role: role, Content: bigContent}
	}

	result, err := client.GenerateSessionSummary(context.Background(), GenerateSessionSummaryRequest{
		SessionName: "Large Session",
		Task:        "Big refactor",
		Conversations: []ConversationMessages{
			{Name: "Main Task", Type: "task", Messages: messages},
		},
	})

	require.NoError(t, err)
	assert.Equal(t, "Summary of truncated session.", result)
	assert.Contains(t, capturedUserMsg, "messages omitted")
	assert.Contains(t, capturedUserMsg, "--- User ---")
	assert.Contains(t, capturedUserMsg, "--- Assistant ---")
}

func TestGenerateSessionSummary_SessionNameAndTaskInPrompt(t *testing.T) {
	var capturedUserMsg string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		var apiReq anthropicRequest
		json.Unmarshal(body, &apiReq)
		capturedUserMsg = apiReq.Messages[0].Content

		resp := anthropicResponse{
			Content: []struct {
				Type string `json:"type"`
				Text string `json:"text"`
			}{
				{Type: "text", Text: "Summary."},
			},
		}
		json.NewEncoder(w).Encode(resp)
	}))
	defer server.Close()

	client := NewClient("sk-test-key")
	client.apiURL = server.URL

	_, err := client.GenerateSessionSummary(context.Background(), GenerateSessionSummaryRequest{
		SessionName: "Fix Auth Bug",
		Task:        "Fix login redirect issue",
		Conversations: []ConversationMessages{
			{Name: "Debug", Type: "task", Messages: []SummaryMessage{{Role: "user", Content: "The login redirect is broken"}}},
		},
	})

	require.NoError(t, err)
	assert.Contains(t, capturedUserMsg, "Session: Fix Auth Bug")
	assert.Contains(t, capturedUserMsg, "Task: Fix login redirect issue")
}

func TestGenerateSessionSummary_ConversationGrouping(t *testing.T) {
	var capturedUserMsg string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		var apiReq anthropicRequest
		json.Unmarshal(body, &apiReq)
		capturedUserMsg = apiReq.Messages[0].Content

		resp := anthropicResponse{
			Content: []struct {
				Type string `json:"type"`
				Text string `json:"text"`
			}{
				{Type: "text", Text: "Summary."},
			},
		}
		json.NewEncoder(w).Encode(resp)
	}))
	defer server.Close()

	client := NewClient("sk-test-key")
	client.apiURL = server.URL

	_, err := client.GenerateSessionSummary(context.Background(), GenerateSessionSummaryRequest{
		SessionName: "Multi-conv Session",
		Conversations: []ConversationMessages{
			{Name: "Implementation", Type: "task", Messages: []SummaryMessage{{Role: "user", Content: "Build the feature"}}},
			{Name: "Code Review", Type: "review", Messages: []SummaryMessage{{Role: "user", Content: "Review the changes"}}},
		},
	})

	require.NoError(t, err)
	assert.Contains(t, capturedUserMsg, "=== Conversation: Implementation (task) ===")
	assert.Contains(t, capturedUserMsg, "=== Conversation: Code Review (review) ===")
}

func TestGenerateSessionSummary_ContextCancellation(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		select {
		case <-r.Context().Done():
			return
		}
	}))
	defer server.Close()

	client := NewClient("sk-test-key")
	client.apiURL = server.URL

	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	_, err := client.GenerateSessionSummary(ctx, GenerateSessionSummaryRequest{
		SessionName: "Test",
		Conversations: []ConversationMessages{
			{Name: "Conv1", Type: "task", Messages: []SummaryMessage{{Role: "user", Content: "Hello"}}},
		},
	})

	assert.Error(t, err)
}
