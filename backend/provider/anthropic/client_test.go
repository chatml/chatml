package anthropic

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/chatml/chatml-backend/provider"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestNew_APIKey(t *testing.T) {
	c, err := New(Config{APIKey: "sk-test-key", Model: "claude-sonnet-4-6"})
	require.NoError(t, err)
	assert.Equal(t, "x-api-key", c.authHeader)
	assert.Equal(t, "sk-test-key", c.authValue)
	assert.Equal(t, "claude-sonnet-4-6", c.model)
	assert.False(t, c.isOAuth)
}

func TestNew_OAuth(t *testing.T) {
	c, err := New(Config{OAuthToken: "tok_abc123"})
	require.NoError(t, err)
	assert.Equal(t, "Authorization", c.authHeader)
	assert.Equal(t, "Bearer tok_abc123", c.authValue)
	assert.True(t, c.isOAuth)
}

func TestNew_DefaultModel(t *testing.T) {
	c, err := New(Config{APIKey: "sk-test"})
	require.NoError(t, err)
	assert.Equal(t, "claude-sonnet-4-6", c.model)
}

func TestNew_NoCredentials(t *testing.T) {
	_, err := New(Config{})
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "APIKey or OAuthToken")
}

func TestClient_Name(t *testing.T) {
	c, _ := New(Config{APIKey: "sk-test"})
	assert.Equal(t, "anthropic", c.Name())
}

func TestClient_MaxContextWindow(t *testing.T) {
	tests := []struct {
		model    string
		expected int
	}{
		{"claude-opus-4-6", 1000000},
		{"claude-sonnet-4-6", 200000},
		{"claude-haiku-4-5-20251001", 200000},
		{"unknown-model", 200000}, // safe default
	}

	for _, tt := range tests {
		t.Run(tt.model, func(t *testing.T) {
			c, _ := New(Config{APIKey: "sk-test", Model: tt.model})
			assert.Equal(t, tt.expected, c.MaxContextWindow())
		})
	}
}

func TestClient_Capabilities(t *testing.T) {
	c, _ := New(Config{APIKey: "sk-test"})
	caps := c.Capabilities()
	assert.True(t, caps.SupportsThinking)
	assert.True(t, caps.SupportsImages)
	assert.True(t, caps.SupportsStreaming)
	assert.True(t, caps.SupportsCaching)
}

func TestBuildRequestBody_Defaults(t *testing.T) {
	c, _ := New(Config{APIKey: "sk-test", Model: "claude-sonnet-4-6"})

	req := provider.ChatRequest{
		Messages: []provider.Message{
			{Role: provider.RoleUser, Content: []provider.ContentBlock{
				provider.NewTextBlock("Hello"),
			}},
		},
	}

	body := c.buildRequestBody(req)
	assert.Equal(t, "claude-sonnet-4-6", body["model"])
	assert.Equal(t, true, body["stream"])
	assert.Equal(t, 16384, body["max_tokens"])
	assert.Nil(t, body["system"])
	assert.Nil(t, body["tools"])
	assert.Nil(t, body["thinking"])
}

func TestBuildRequestBody_AllOptions(t *testing.T) {
	c, _ := New(Config{APIKey: "sk-test", Model: "claude-sonnet-4-6"})

	temp := 0.7
	req := provider.ChatRequest{
		Model:        "claude-opus-4-6",
		SystemPrompt: "You are helpful.",
		Messages: []provider.Message{
			{Role: provider.RoleUser, Content: []provider.ContentBlock{
				provider.NewTextBlock("Hi"),
			}},
		},
		Tools: []provider.ToolDef{
			{Name: "Bash", Description: "Run shell commands", InputSchema: json.RawMessage(`{"type":"object"}`)},
		},
		MaxTokens:      8192,
		Temperature:    &temp,
		ThinkingBudget: 4096,
		StopSequences:  []string{"\n\nHuman:"},
	}

	body := c.buildRequestBody(req)
	assert.Equal(t, "claude-opus-4-6", body["model"]) // Override
	assert.Equal(t, "You are helpful.", body["system"])
	assert.Equal(t, 8192, body["max_tokens"])
	assert.Equal(t, 0.7, body["temperature"])
	assert.Equal(t, []string{"\n\nHuman:"}, body["stop_sequences"])

	thinking := body["thinking"].(map[string]interface{})
	assert.Equal(t, "enabled", thinking["type"])
	assert.Equal(t, 4096, thinking["budget_tokens"])

	tools := body["tools"].([]map[string]interface{})
	require.Len(t, tools, 1)
	assert.Equal(t, "Bash", tools[0]["name"])
}

func TestConvertMessages(t *testing.T) {
	msgs := []provider.Message{
		{
			Role: provider.RoleUser,
			Content: []provider.ContentBlock{
				provider.NewTextBlock("Read this file"),
			},
		},
		{
			Role: provider.RoleAssistant,
			Content: []provider.ContentBlock{
				provider.NewTextBlock("I'll read it"),
				provider.NewToolUseBlock("tu_1", "Read", json.RawMessage(`{"file_path":"/tmp/x"}`)),
			},
		},
		{
			Role: provider.RoleUser,
			Content: []provider.ContentBlock{
				provider.NewToolResultBlock("tu_1", "file contents here", false),
			},
		},
	}

	result := convertMessages(msgs)
	require.Len(t, result, 3)

	// User message
	assert.Equal(t, "user", result[0]["role"])
	content0 := result[0]["content"].([]map[string]interface{})
	assert.Equal(t, "text", content0[0]["type"])

	// Assistant message with tool use
	content1 := result[1]["content"].([]map[string]interface{})
	require.Len(t, content1, 2)
	assert.Equal(t, "tool_use", content1[1]["type"])
	assert.Equal(t, "tu_1", content1[1]["id"])
	assert.Equal(t, "Read", content1[1]["name"])

	// Tool result
	content2 := result[2]["content"].([]map[string]interface{})
	assert.Equal(t, "tool_result", content2[0]["type"])
	assert.Equal(t, "tu_1", content2[0]["tool_use_id"])
}

func TestStreamChat_HTTPError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusTooManyRequests)
		w.Write([]byte(`{"error":{"type":"rate_limit_error","message":"Too many requests"}}`))
	}))
	defer srv.Close()

	c, _ := New(Config{APIKey: "sk-test", APIURL: srv.URL})

	_, err := c.StreamChat(context.Background(), provider.ChatRequest{
		Messages: []provider.Message{
			{Role: provider.RoleUser, Content: []provider.ContentBlock{provider.NewTextBlock("hi")}},
		},
	})

	assert.Error(t, err)
	assert.Contains(t, err.Error(), "429")
}

func TestStreamChat_Success(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Verify headers
		assert.Equal(t, "application/json", r.Header.Get("Content-Type"))
		assert.Equal(t, "sk-test-key", r.Header.Get("x-api-key"))
		assert.Equal(t, "2023-06-01", r.Header.Get("anthropic-version"))

		// Verify request body
		body, _ := io.ReadAll(r.Body)
		var req map[string]interface{}
		json.Unmarshal(body, &req)
		assert.Equal(t, true, req["stream"])

		// Write SSE response
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("event: message_start\ndata: {\"message\":{\"usage\":{\"input_tokens\":5}}}\n\n"))
		w.Write([]byte("event: content_block_delta\ndata: {\"delta\":{\"type\":\"text_delta\",\"text\":\"Hi!\"}}\n\n"))
		w.Write([]byte("event: message_delta\ndata: {\"delta\":{\"stop_reason\":\"end_turn\"}}\n\n"))
		w.Write([]byte("event: message_stop\ndata: {}\n\n"))
	}))
	defer srv.Close()

	c, _ := New(Config{APIKey: "sk-test-key", APIURL: srv.URL})

	ch, err := c.StreamChat(context.Background(), provider.ChatRequest{
		Messages: []provider.Message{
			{Role: provider.RoleUser, Content: []provider.ContentBlock{provider.NewTextBlock("Hello")}},
		},
	})
	require.NoError(t, err)

	events := collectEvents(ch)

	var gotText bool
	for _, ev := range events {
		if ev.Type == provider.EventTextDelta && ev.Text == "Hi!" {
			gotText = true
		}
	}
	assert.True(t, gotText, "expected to receive text delta 'Hi!'")
}

func TestStreamChat_OAuthHeaders(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "Bearer tok_oauth", r.Header.Get("Authorization"))
		assert.Contains(t, r.Header.Get("anthropic-beta"), "oauth-2025-04-20")

		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("event: message_stop\ndata: {}\n\n"))
	}))
	defer srv.Close()

	c, _ := New(Config{OAuthToken: "tok_oauth", APIURL: srv.URL})

	ch, err := c.StreamChat(context.Background(), provider.ChatRequest{
		Messages: []provider.Message{
			{Role: provider.RoleUser, Content: []provider.ContentBlock{provider.NewTextBlock("hi")}},
		},
	})
	require.NoError(t, err)

	// Drain events
	for range ch {
	}
}

func TestConvertTools(t *testing.T) {
	tools := []provider.ToolDef{
		{
			Name:        "Bash",
			Description: "Run a shell command",
			InputSchema: json.RawMessage(`{"type":"object","properties":{"command":{"type":"string"}}}`),
		},
	}

	result := convertTools(tools)
	require.Len(t, result, 1)
	assert.Equal(t, "Bash", result[0]["name"])
	assert.Equal(t, "Run a shell command", result[0]["description"])
	assert.NotNil(t, result[0]["input_schema"])
}
