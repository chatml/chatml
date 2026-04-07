package openai

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/chatml/chatml-core/provider"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestNew_RequiresAPIKey(t *testing.T) {
	_, err := New(Config{})
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "API key")
}

func TestNew_Defaults(t *testing.T) {
	c, err := New(Config{APIKey: "sk-test"})
	require.NoError(t, err)
	assert.Equal(t, "gpt-4o", c.model)
	assert.Equal(t, defaultAPIURL, c.apiURL)
}

func TestNew_CustomModel(t *testing.T) {
	c, err := New(Config{APIKey: "sk-test", Model: "o3-mini"})
	require.NoError(t, err)
	assert.Equal(t, "o3-mini", c.model)
}

func TestClient_Name(t *testing.T) {
	c, _ := New(Config{APIKey: "sk-test"})
	assert.Equal(t, "openai", c.Name())
}

func TestClient_MaxContextWindow(t *testing.T) {
	tests := []struct {
		model    string
		expected int
	}{
		{"gpt-4o", 128000},
		{"gpt-4", 8192},
		{"o3", 200000},
		{"unknown-model", defaultContextWindow},
	}

	for _, tt := range tests {
		c, _ := New(Config{APIKey: "sk-test", Model: tt.model})
		assert.Equal(t, tt.expected, c.MaxContextWindow(), "model %s", tt.model)
	}
}

func TestClient_Capabilities(t *testing.T) {
	c, _ := New(Config{APIKey: "sk-test"})
	caps := c.Capabilities()
	assert.False(t, caps.SupportsThinking) // OpenAI doesn't have thinking blocks
	assert.True(t, caps.SupportsImages)
	assert.True(t, caps.SupportsStreaming)
}

func TestBuildRequestBody_Defaults(t *testing.T) {
	c, _ := New(Config{APIKey: "sk-test", Model: "gpt-4o"})

	req := provider.ChatRequest{
		Messages: []provider.Message{
			{Role: provider.RoleUser, Content: []provider.ContentBlock{provider.NewTextBlock("Hello")}},
		},
	}

	body := c.buildRequestBody(req)
	assert.Equal(t, "gpt-4o", body["model"])
	assert.Equal(t, true, body["stream"])
	assert.Nil(t, body["tools"])

	msgs := body["messages"].([]map[string]interface{})
	require.Len(t, msgs, 1)
	assert.Equal(t, "user", msgs[0]["role"])
	assert.Equal(t, "Hello", msgs[0]["content"])
}

func TestBuildRequestBody_WithSystemPrompt(t *testing.T) {
	c, _ := New(Config{APIKey: "sk-test"})

	req := provider.ChatRequest{
		SystemPrompt: "You are helpful.",
		Messages: []provider.Message{
			{Role: provider.RoleUser, Content: []provider.ContentBlock{provider.NewTextBlock("Hi")}},
		},
	}

	body := c.buildRequestBody(req)
	msgs := body["messages"].([]map[string]interface{})
	require.Len(t, msgs, 2)
	assert.Equal(t, "system", msgs[0]["role"])
	assert.Equal(t, "You are helpful.", msgs[0]["content"])
}

func TestBuildRequestBody_WithTools(t *testing.T) {
	c, _ := New(Config{APIKey: "sk-test"})

	req := provider.ChatRequest{
		Messages: []provider.Message{
			{Role: provider.RoleUser, Content: []provider.ContentBlock{provider.NewTextBlock("Hi")}},
		},
		Tools: []provider.ToolDef{
			{Name: "Bash", Description: "Run commands", InputSchema: json.RawMessage(`{"type":"object"}`)},
		},
	}

	body := c.buildRequestBody(req)
	tools := body["tools"].([]map[string]interface{})
	require.Len(t, tools, 1)
	assert.Equal(t, "function", tools[0]["type"])
	fn := tools[0]["function"].(map[string]interface{})
	assert.Equal(t, "Bash", fn["name"])
}

func TestConvertMessage_ToolUse(t *testing.T) {
	msg := provider.Message{
		Role: provider.RoleAssistant,
		Content: []provider.ContentBlock{
			provider.NewTextBlock("Let me run that."),
			provider.NewToolUseBlock("call_1", "Bash", json.RawMessage(`{"command":"ls"}`)),
		},
	}

	results := convertMessages(msg)
	require.Len(t, results, 1)
	result := results[0]
	assert.Equal(t, "assistant", result["role"])
	assert.Equal(t, "Let me run that.", result["content"])

	toolCalls := result["tool_calls"].([]map[string]interface{})
	require.Len(t, toolCalls, 1)
	assert.Equal(t, "call_1", toolCalls[0]["id"])
	assert.Equal(t, "function", toolCalls[0]["type"])
}

func TestConvertMessage_ToolResult(t *testing.T) {
	msg := provider.Message{
		Role: provider.RoleUser,
		Content: []provider.ContentBlock{
			provider.NewToolResultBlock("call_1", "file1.go\nfile2.go", false),
		},
	}

	results := convertMessages(msg)
	require.Len(t, results, 1)
	result := results[0]
	assert.Equal(t, "tool", result["role"])
	assert.Equal(t, "call_1", result["tool_call_id"])
	assert.Equal(t, "file1.go\nfile2.go", result["content"])
}

func TestStreamChat_HTTPError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "Bearer sk-test", r.Header.Get("Authorization"))
		w.WriteHeader(http.StatusBadRequest)
		w.Write([]byte(`{"error":{"message":"bad request"}}`))
	}))
	defer srv.Close()

	c, _ := New(Config{APIKey: "sk-test", APIURL: srv.URL})
	_, err := c.StreamChat(context.Background(), provider.ChatRequest{
		Messages: []provider.Message{
			{Role: provider.RoleUser, Content: []provider.ContentBlock{provider.NewTextBlock("hi")}},
		},
	})
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "400")
}

func TestStreamChat_Success(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		w.Write([]byte("data: {\"id\":\"chatcmpl-1\",\"choices\":[{\"index\":0,\"delta\":{\"role\":\"assistant\",\"content\":\"Hello\"}}]}\n\n"))
		w.Write([]byte("data: {\"id\":\"chatcmpl-1\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\" world\"}}]}\n\n"))
		w.Write([]byte("data: {\"id\":\"chatcmpl-1\",\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"stop\"}]}\n\n"))
		w.Write([]byte("data: {\"id\":\"chatcmpl-1\",\"choices\":[],\"usage\":{\"prompt_tokens\":10,\"completion_tokens\":2,\"total_tokens\":12}}\n\n"))
		w.Write([]byte("data: [DONE]\n\n"))
	}))
	defer srv.Close()

	c, _ := New(Config{APIKey: "sk-test", APIURL: srv.URL})
	ch, err := c.StreamChat(context.Background(), provider.ChatRequest{
		Messages: []provider.Message{
			{Role: provider.RoleUser, Content: []provider.ContentBlock{provider.NewTextBlock("hi")}},
		},
	})
	require.NoError(t, err)

	var text string
	var gotUsage bool
	var stopReason string
	for ev := range ch {
		switch ev.Type {
		case provider.EventTextDelta:
			text += ev.Text
		case provider.EventMessageDelta:
			if ev.Usage != nil {
				gotUsage = true
				assert.Equal(t, 10, ev.Usage.InputTokens)
				assert.Equal(t, 2, ev.Usage.OutputTokens)
			}
			if ev.StopReason != "" {
				stopReason = ev.StopReason
			}
		}
	}

	assert.Equal(t, "Hello world", text)
	assert.True(t, gotUsage)
	assert.Equal(t, "end_turn", stopReason)
}

func TestStreamChat_ToolCalls(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		// Tool call comes in multiple chunks
		w.Write([]byte("data: {\"id\":\"chatcmpl-1\",\"choices\":[{\"index\":0,\"delta\":{\"role\":\"assistant\",\"tool_calls\":[{\"index\":0,\"id\":\"call_abc\",\"type\":\"function\",\"function\":{\"name\":\"Bash\",\"arguments\":\"\"}}]}}]}\n\n"))
		w.Write([]byte("data: {\"id\":\"chatcmpl-1\",\"choices\":[{\"index\":0,\"delta\":{\"tool_calls\":[{\"index\":0,\"function\":{\"arguments\":\"{\\\"com\"}}]}}]}\n\n"))
		w.Write([]byte("data: {\"id\":\"chatcmpl-1\",\"choices\":[{\"index\":0,\"delta\":{\"tool_calls\":[{\"index\":0,\"function\":{\"arguments\":\"mand\\\":\\\"ls\\\"}\"}}]}}]}\n\n"))
		w.Write([]byte("data: {\"id\":\"chatcmpl-1\",\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"tool_calls\"}]}\n\n"))
		w.Write([]byte("data: [DONE]\n\n"))
	}))
	defer srv.Close()

	c, _ := New(Config{APIKey: "sk-test", APIURL: srv.URL})
	ch, err := c.StreamChat(context.Background(), provider.ChatRequest{
		Messages: []provider.Message{
			{Role: provider.RoleUser, Content: []provider.ContentBlock{provider.NewTextBlock("list files")}},
		},
	})
	require.NoError(t, err)

	var toolStartName string
	var toolEndInput string
	var stopReason string
	for ev := range ch {
		switch ev.Type {
		case provider.EventToolUseStart:
			if ev.ToolUse != nil {
				toolStartName = ev.ToolUse.Name
			}
		case provider.EventToolUseEnd:
			if ev.ToolUse != nil {
				toolEndInput = string(ev.ToolUse.Input)
			}
		case provider.EventMessageDelta:
			if ev.StopReason != "" {
				stopReason = ev.StopReason
			}
		}
	}

	assert.Equal(t, "Bash", toolStartName)
	assert.JSONEq(t, `{"command":"ls"}`, toolEndInput)
	assert.Equal(t, "tool_use", stopReason)
}

// --- CountTokens tests ---

func TestCountTokens_Empty(t *testing.T) {
	c, _ := New(Config{APIKey: "sk-test"})
	count, err := c.CountTokens(context.Background(), nil)
	require.NoError(t, err)
	assert.Equal(t, 0, count)
}

func TestCountTokens_TextMessages(t *testing.T) {
	c, _ := New(Config{APIKey: "sk-test"})
	msgs := []provider.Message{
		{Role: provider.RoleUser, Content: []provider.ContentBlock{provider.NewTextBlock("Hello world")}},
		{Role: provider.RoleAssistant, Content: []provider.ContentBlock{provider.NewTextBlock("Hi there")}},
	}
	count, err := c.CountTokens(context.Background(), msgs)
	require.NoError(t, err)
	assert.Greater(t, count, 0)
	// "Hello world" = 11 chars, "Hi there" = 8 chars → 19/4 + 2*4 = 4+8 = 12
	assert.Equal(t, 12, count)
}

func TestCountTokens_ToolMessages(t *testing.T) {
	c, _ := New(Config{APIKey: "sk-test"})
	msgs := []provider.Message{
		{Role: provider.RoleAssistant, Content: []provider.ContentBlock{
			provider.NewToolUseBlock("tu_1", "Bash", json.RawMessage(`{"command":"ls"}`)),
		}},
		{Role: provider.RoleUser, Content: []provider.ContentBlock{
			provider.NewToolResultBlock("tu_1", "file1.go\nfile2.go", false),
		}},
	}
	count, err := c.CountTokens(context.Background(), msgs)
	require.NoError(t, err)
	assert.Greater(t, count, 0)
}

// --- Stream edge cases ---

func TestStreamChat_EmptyResponse(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		w.Write([]byte("data: [DONE]\n\n"))
	}))
	defer srv.Close()

	c, _ := New(Config{APIKey: "sk-test", APIURL: srv.URL})
	ch, err := c.StreamChat(context.Background(), provider.ChatRequest{
		Messages: []provider.Message{
			{Role: provider.RoleUser, Content: []provider.ContentBlock{provider.NewTextBlock("hi")}},
		},
	})
	require.NoError(t, err)

	// Should complete without panic
	for range ch {
	}
}

func TestStreamChat_MalformedJSON(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		w.Write([]byte("data: {invalid json}\n\n"))
		w.Write([]byte("data: {\"id\":\"chatcmpl-1\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"ok\"}}]}\n\n"))
		w.Write([]byte("data: [DONE]\n\n"))
	}))
	defer srv.Close()

	c, _ := New(Config{APIKey: "sk-test", APIURL: srv.URL})
	ch, err := c.StreamChat(context.Background(), provider.ChatRequest{
		Messages: []provider.Message{
			{Role: provider.RoleUser, Content: []provider.ContentBlock{provider.NewTextBlock("hi")}},
		},
	})
	require.NoError(t, err)

	// Should skip malformed JSON and still get the valid chunk
	var text string
	for ev := range ch {
		if ev.Type == provider.EventTextDelta {
			text += ev.Text
		}
	}
	assert.Equal(t, "ok", text)
}

func TestStreamChat_FinishReasonLength(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		w.Write([]byte("data: {\"id\":\"chatcmpl-1\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"partial\"}}]}\n\n"))
		w.Write([]byte("data: {\"id\":\"chatcmpl-1\",\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"length\"}]}\n\n"))
		w.Write([]byte("data: [DONE]\n\n"))
	}))
	defer srv.Close()

	c, _ := New(Config{APIKey: "sk-test", APIURL: srv.URL})
	ch, err := c.StreamChat(context.Background(), provider.ChatRequest{
		Messages: []provider.Message{
			{Role: provider.RoleUser, Content: []provider.ContentBlock{provider.NewTextBlock("hi")}},
		},
	})
	require.NoError(t, err)

	var stopReason string
	for ev := range ch {
		if ev.Type == provider.EventMessageDelta && ev.StopReason != "" {
			stopReason = ev.StopReason
		}
	}
	assert.Equal(t, "max_tokens", stopReason) // "length" mapped to "max_tokens"
}

func TestStreamChat_MultipleToolCalls(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		// Two tool calls in parallel
		w.Write([]byte("data: {\"id\":\"chatcmpl-1\",\"choices\":[{\"index\":0,\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"call_1\",\"type\":\"function\",\"function\":{\"name\":\"Read\",\"arguments\":\"{\\\"file_path\\\":\\\"a.go\\\"}\"}}]}}]}\n\n"))
		w.Write([]byte("data: {\"id\":\"chatcmpl-1\",\"choices\":[{\"index\":0,\"delta\":{\"tool_calls\":[{\"index\":1,\"id\":\"call_2\",\"type\":\"function\",\"function\":{\"name\":\"Read\",\"arguments\":\"{\\\"file_path\\\":\\\"b.go\\\"}\"}}]}}]}\n\n"))
		w.Write([]byte("data: {\"id\":\"chatcmpl-1\",\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"tool_calls\"}]}\n\n"))
		w.Write([]byte("data: [DONE]\n\n"))
	}))
	defer srv.Close()

	c, _ := New(Config{APIKey: "sk-test", APIURL: srv.URL})
	ch, err := c.StreamChat(context.Background(), provider.ChatRequest{
		Messages: []provider.Message{
			{Role: provider.RoleUser, Content: []provider.ContentBlock{provider.NewTextBlock("read both files")}},
		},
	})
	require.NoError(t, err)

	var toolEnds []string
	for ev := range ch {
		if ev.Type == provider.EventToolUseEnd && ev.ToolUse != nil {
			toolEnds = append(toolEnds, ev.ToolUse.ID)
		}
	}
	assert.Len(t, toolEnds, 2)
	assert.Contains(t, toolEnds, "call_1")
	assert.Contains(t, toolEnds, "call_2")
}

// --- emitPendingToolCalls tests ---

func TestEmitPendingToolCalls_Empty(t *testing.T) {
	ch := make(chan provider.StreamEvent, 10)
	calls := map[int]*toolCallState{}
	emitPendingToolCalls(ch, calls)
	assert.Len(t, ch, 0)
}

func TestEmitPendingToolCalls_EmptyID(t *testing.T) {
	ch := make(chan provider.StreamEvent, 10)
	calls := map[int]*toolCallState{
		0: {id: "", name: "Bash"},
	}
	emitPendingToolCalls(ch, calls)
	assert.Len(t, ch, 0) // Skips calls with empty ID
}

func TestEmitPendingToolCalls_EmptyArguments(t *testing.T) {
	ch := make(chan provider.StreamEvent, 10)
	calls := map[int]*toolCallState{
		0: {id: "call_1", name: "Bash"},
	}
	emitPendingToolCalls(ch, calls)
	require.Len(t, ch, 1)

	ev := <-ch
	assert.Equal(t, provider.EventToolUseEnd, ev.Type)
	assert.Equal(t, "call_1", ev.ToolUse.ID)
	assert.Equal(t, "{}", string(ev.ToolUse.Input)) // Default to empty object
}

// --- convertMessage edge cases ---

func TestConvertMessage_TextOnly(t *testing.T) {
	msg := provider.Message{
		Role: provider.RoleUser,
		Content: []provider.ContentBlock{
			provider.NewTextBlock("Hello"),
			provider.NewTextBlock("World"),
		},
	}
	results := convertMessages(msg)
	require.Len(t, results, 1)
	assert.Equal(t, "user", results[0]["role"])
	assert.Equal(t, "Hello\nWorld", results[0]["content"])
}

func TestConvertMessage_EmptyContent(t *testing.T) {
	msg := provider.Message{
		Role:    provider.RoleAssistant,
		Content: nil,
	}
	results := convertMessages(msg)
	require.Len(t, results, 1)
	assert.Equal(t, "assistant", results[0]["role"])
	assert.Equal(t, "", results[0]["content"])
}

// --- buildRequestBody edge cases ---

func TestBuildRequestBody_WithTemperature(t *testing.T) {
	c, _ := New(Config{APIKey: "sk-test"})

	temp := 0.5
	req := provider.ChatRequest{
		Messages:    []provider.Message{{Role: provider.RoleUser, Content: []provider.ContentBlock{provider.NewTextBlock("Hi")}}},
		Temperature: &temp,
	}

	body := c.buildRequestBody(req)
	assert.Equal(t, 0.5, body["temperature"])
}

func TestBuildRequestBody_WithMaxTokens(t *testing.T) {
	c, _ := New(Config{APIKey: "sk-test"})

	req := provider.ChatRequest{
		Messages:  []provider.Message{{Role: provider.RoleUser, Content: []provider.ContentBlock{provider.NewTextBlock("Hi")}}},
		MaxTokens: 4096,
	}

	body := c.buildRequestBody(req)
	assert.Equal(t, 4096, body["max_tokens"])
}

func TestBuildRequestBody_ModelOverride(t *testing.T) {
	c, _ := New(Config{APIKey: "sk-test", Model: "gpt-4o"})

	req := provider.ChatRequest{
		Model:    "o3-mini",
		Messages: []provider.Message{{Role: provider.RoleUser, Content: []provider.ContentBlock{provider.NewTextBlock("Hi")}}},
	}

	body := c.buildRequestBody(req)
	assert.Equal(t, "o3-mini", body["model"])
}
