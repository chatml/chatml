package automation

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// ============================================================================
// WebhookExecutor
// ============================================================================

func TestWebhookExecutor_Success(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "POST", r.Method)
		assert.Equal(t, "application/json", r.Header.Get("Content-Type"))
		w.WriteHeader(200)
		w.Write([]byte(`{"ok": true}`))
	}))
	defer server.Close()

	exec := NewWebhookExecutor()
	result, err := exec.Execute(context.Background(), StepContext{
		Config: map[string]interface{}{
			"method":       "POST",
			"url":          server.URL,
			"bodyTemplate": `{"test": true}`,
		},
		Input: `{"test": true}`,
	})

	require.NoError(t, err)

	var output map[string]interface{}
	require.NoError(t, json.Unmarshal([]byte(result.OutputData), &output))
	assert.Equal(t, float64(200), output["statusCode"])
}

func TestWebhookExecutor_MissingURL(t *testing.T) {
	exec := NewWebhookExecutor()
	_, err := exec.Execute(context.Background(), StepContext{
		Config: map[string]interface{}{
			"method": "GET",
		},
		Input: "{}",
	})

	assert.Error(t, err)
	assert.Contains(t, err.Error(), "URL is required")
}

func TestWebhookExecutor_HTTP4xxReturnsError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(404)
		w.Write([]byte("not found"))
	}))
	defer server.Close()

	exec := NewWebhookExecutor()
	_, err := exec.Execute(context.Background(), StepContext{
		Config: map[string]interface{}{
			"url":    server.URL,
			"method": "GET",
		},
		Input: "{}",
	})

	assert.Error(t, err)
	assert.Contains(t, err.Error(), "404")
}

func TestWebhookExecutor_BodyTemplate(t *testing.T) {
	var receivedBody string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body := make([]byte, r.ContentLength)
		r.Body.Read(body)
		receivedBody = string(body)
		w.WriteHeader(200)
		w.Write([]byte(`{}`))
	}))
	defer server.Close()

	exec := NewWebhookExecutor()
	_, err := exec.Execute(context.Background(), StepContext{
		Config: map[string]interface{}{
			"url":          server.URL,
			"method":       "POST",
			"bodyTemplate": `{"msg": "hello"}`,
		},
		Input: `{"value": "test"}`,
	})

	require.NoError(t, err)
	assert.Contains(t, receivedBody, "hello")
}

func TestWebhookExecutor_CustomHeaders(t *testing.T) {
	var receivedAuth string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		receivedAuth = r.Header.Get("Authorization")
		w.WriteHeader(200)
		w.Write([]byte(`{}`))
	}))
	defer server.Close()

	exec := NewWebhookExecutor()
	_, err := exec.Execute(context.Background(), StepContext{
		Config: map[string]interface{}{
			"url":     server.URL,
			"method":  "GET",
			"headers": `{"Authorization": "Bearer token123"}`,
		},
		Input: "{}",
	})

	require.NoError(t, err)
	assert.Equal(t, "Bearer token123", receivedAuth)
}

func TestWebhookExecutor_DefaultMethodIsPOST(t *testing.T) {
	var receivedMethod string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		receivedMethod = r.Method
		w.WriteHeader(200)
		w.Write([]byte(`{}`))
	}))
	defer server.Close()

	exec := NewWebhookExecutor()
	_, err := exec.Execute(context.Background(), StepContext{
		Config: map[string]interface{}{
			"url": server.URL,
		},
		Input: "{}",
	})

	require.NoError(t, err)
	assert.Equal(t, "POST", receivedMethod)
}

func TestWebhookExecutor_NonJSONResponse(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain")
		w.WriteHeader(200)
		w.Write([]byte("plain text response"))
	}))
	defer server.Close()

	exec := NewWebhookExecutor()
	result, err := exec.Execute(context.Background(), StepContext{
		Config: map[string]interface{}{
			"url":    server.URL,
			"method": "GET",
		},
		Input: "{}",
	})

	require.NoError(t, err)

	var output map[string]interface{}
	require.NoError(t, json.Unmarshal([]byte(result.OutputData), &output))
	assert.Equal(t, "plain text response", output["body"])
}

func TestWebhookExecutor_ContextCancelled(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(5 * time.Second)
		w.WriteHeader(200)
	}))
	defer server.Close()

	ctx, cancel := context.WithCancel(context.Background())
	cancel() // cancel immediately

	exec := NewWebhookExecutor()
	_, err := exec.Execute(ctx, StepContext{
		Config: map[string]interface{}{
			"url":    server.URL,
			"method": "GET",
		},
		Input: "{}",
	})

	assert.Error(t, err)
}

// ============================================================================
// ScriptExecutor
// ============================================================================

func TestScriptExecutor_Success(t *testing.T) {
	exec := NewScriptExecutor()
	result, err := exec.Execute(context.Background(), StepContext{
		Config: map[string]interface{}{
			"command": "echo hello",
		},
		Input: "{}",
	})

	require.NoError(t, err)

	var output map[string]interface{}
	require.NoError(t, json.Unmarshal([]byte(result.OutputData), &output))
	assert.Contains(t, output["stdout"], "hello")
	assert.Equal(t, float64(0), output["exitCode"])
}

func TestScriptExecutor_MissingCommand(t *testing.T) {
	exec := NewScriptExecutor()
	_, err := exec.Execute(context.Background(), StepContext{
		Config: map[string]interface{}{},
		Input:  "{}",
	})

	assert.Error(t, err)
	assert.Contains(t, err.Error(), "command is required")
}

func TestScriptExecutor_NonZeroExit(t *testing.T) {
	exec := NewScriptExecutor()
	_, err := exec.Execute(context.Background(), StepContext{
		Config: map[string]interface{}{
			"command": "exit 42",
		},
		Input: "{}",
	})

	assert.Error(t, err)
	assert.Contains(t, err.Error(), "42")
}

func TestScriptExecutor_WorkDir(t *testing.T) {
	exec := NewScriptExecutor()
	result, err := exec.Execute(context.Background(), StepContext{
		Config: map[string]interface{}{
			"command": "pwd",
			"workDir": "/tmp",
		},
		Input: "{}",
	})

	require.NoError(t, err)

	var output map[string]interface{}
	require.NoError(t, json.Unmarshal([]byte(result.OutputData), &output))
	// macOS resolves /tmp to /private/tmp
	assert.Contains(t, output["stdout"], "tmp")
}

// ============================================================================
// ConditionalExecutor
// ============================================================================

func TestConditionalExecutor_Equals(t *testing.T) {
	exec := NewConditionalExecutor()

	tests := []struct {
		name     string
		input    string
		field    string
		value    string
		expected bool
	}{
		{"match", `{"status": "ok"}`, "status", "ok", true},
		{"no match", `{"status": "fail"}`, "status", "ok", false},
		{"nested field", `{"data": {"status": "ok"}}`, "data.status", "ok", true},
		{"missing field", `{}`, "missing", "ok", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result, err := exec.Execute(context.Background(), StepContext{
				Config: map[string]interface{}{
					"field":    tt.field,
					"operator": "equals",
					"value":    tt.value,
				},
				Input: tt.input,
			})

			require.NoError(t, err)

			var output map[string]interface{}
			require.NoError(t, json.Unmarshal([]byte(result.OutputData), &output))
			assert.Equal(t, tt.expected, output["result"])
		})
	}
}

func TestConditionalExecutor_NotEquals(t *testing.T) {
	exec := NewConditionalExecutor()
	result, err := exec.Execute(context.Background(), StepContext{
		Config: map[string]interface{}{
			"field":    "status",
			"operator": "not_equals",
			"value":    "ok",
		},
		Input: `{"status": "fail"}`,
	})

	require.NoError(t, err)

	var output map[string]interface{}
	require.NoError(t, json.Unmarshal([]byte(result.OutputData), &output))
	assert.Equal(t, true, output["result"])
}

func TestConditionalExecutor_Contains(t *testing.T) {
	exec := NewConditionalExecutor()
	result, err := exec.Execute(context.Background(), StepContext{
		Config: map[string]interface{}{
			"field":    "message",
			"operator": "contains",
			"value":    "error",
		},
		Input: `{"message": "fatal error occurred"}`,
	})

	require.NoError(t, err)

	var output map[string]interface{}
	require.NoError(t, json.Unmarshal([]byte(result.OutputData), &output))
	assert.Equal(t, true, output["result"])
}

func TestConditionalExecutor_Exists(t *testing.T) {
	exec := NewConditionalExecutor()

	// Field exists
	result, err := exec.Execute(context.Background(), StepContext{
		Config: map[string]interface{}{
			"field":    "status",
			"operator": "exists",
		},
		Input: `{"status": "ok"}`,
	})
	require.NoError(t, err)

	var output map[string]interface{}
	require.NoError(t, json.Unmarshal([]byte(result.OutputData), &output))
	assert.Equal(t, true, output["result"])

	// Field missing
	result2, err := exec.Execute(context.Background(), StepContext{
		Config: map[string]interface{}{
			"field":    "missing",
			"operator": "exists",
		},
		Input: `{"status": "ok"}`,
	})
	require.NoError(t, err)

	var output2 map[string]interface{}
	require.NoError(t, json.Unmarshal([]byte(result2.OutputData), &output2))
	assert.Equal(t, false, output2["result"])
}

func TestConditionalExecutor_GreaterThan(t *testing.T) {
	exec := NewConditionalExecutor()
	result, err := exec.Execute(context.Background(), StepContext{
		Config: map[string]interface{}{
			"field":    "count",
			"operator": "gt",
			"value":    "5",
		},
		Input: `{"count": "9"}`,
	})

	require.NoError(t, err)

	var output map[string]interface{}
	require.NoError(t, json.Unmarshal([]byte(result.OutputData), &output))
	assert.Equal(t, true, output["result"])
}

func TestConditionalExecutor_DefaultOperatorIsEquals(t *testing.T) {
	exec := NewConditionalExecutor()
	result, err := exec.Execute(context.Background(), StepContext{
		Config: map[string]interface{}{
			"field": "status",
			"value": "ok",
			// no operator specified
		},
		Input: `{"status": "ok"}`,
	})

	require.NoError(t, err)

	var output map[string]interface{}
	require.NoError(t, json.Unmarshal([]byte(result.OutputData), &output))
	assert.Equal(t, true, output["result"])
}

func TestConditionalExecutor_InvalidJSON(t *testing.T) {
	exec := NewConditionalExecutor()
	result, err := exec.Execute(context.Background(), StepContext{
		Config: map[string]interface{}{
			"field":    "x",
			"operator": "exists",
		},
		Input: "not json",
	})

	// Should not error, just treat as empty input
	require.NoError(t, err)

	var output map[string]interface{}
	require.NoError(t, json.Unmarshal([]byte(result.OutputData), &output))
	assert.Equal(t, false, output["result"])
}

// ============================================================================
// DelayExecutor
// ============================================================================

func TestDelayExecutor_ShortDelay(t *testing.T) {
	exec := NewDelayExecutor()

	start := time.Now()
	result, err := exec.Execute(context.Background(), StepContext{
		Config: map[string]interface{}{
			"durationSecs": float64(0.01), // 10ms
		},
		Input: `{"pass": "through"}`,
	})

	require.NoError(t, err)
	assert.Less(t, time.Since(start), 500*time.Millisecond) // should finish quickly
	assert.Equal(t, `{"pass": "through"}`, result.OutputData)
}

func TestDelayExecutor_ContextCancelled(t *testing.T) {
	exec := NewDelayExecutor()

	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	_, err := exec.Execute(ctx, StepContext{
		Config: map[string]interface{}{
			"durationSecs": float64(60),
		},
		Input: "{}",
	})

	assert.Error(t, err)
}

func TestDelayExecutor_DefaultDuration(t *testing.T) {
	exec := NewDelayExecutor()

	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()

	// Default is 60s, so context timeout should trigger first
	_, err := exec.Execute(ctx, StepContext{
		Config: map[string]interface{}{},
		Input:  "{}",
	})

	assert.Error(t, err)
}

// ============================================================================
// TransformExecutor
// ============================================================================

func TestTransformExecutor_SimpleTemplate(t *testing.T) {
	exec := NewTransformExecutor()
	result, err := exec.Execute(context.Background(), StepContext{
		Config: map[string]interface{}{
			"template": `{"greeting": "hello"}`,
		},
		Input: `{"name": "world"}`,
	})

	require.NoError(t, err)
	assert.Equal(t, `{"greeting": "hello"}`, result.OutputData)
}

func TestTransformExecutor_PassThrough(t *testing.T) {
	exec := NewTransformExecutor()
	result, err := exec.Execute(context.Background(), StepContext{
		Config: map[string]interface{}{},
		Input:  `{"data": "preserved"}`,
	})

	require.NoError(t, err)
	assert.Equal(t, `{"data": "preserved"}`, result.OutputData)
}

func TestTransformExecutor_InvalidOutputJSON(t *testing.T) {
	exec := NewTransformExecutor()
	_, err := exec.Execute(context.Background(), StepContext{
		Config: map[string]interface{}{
			"template": `{"broken": }`,
		},
		Input: `{}`,
	})

	assert.Error(t, err)
	assert.Contains(t, err.Error(), "not valid JSON")
}

func TestTransformExecutor_NonJSONOutput(t *testing.T) {
	exec := NewTransformExecutor()
	result, err := exec.Execute(context.Background(), StepContext{
		Config: map[string]interface{}{
			"template": "just plain text",
		},
		Input: `{}`,
	})

	// Non-JSON (doesn't start with { or [) should pass through
	require.NoError(t, err)
	assert.Equal(t, "just plain text", result.OutputData)
}

func TestTransformExecutor_InvalidTemplate(t *testing.T) {
	exec := NewTransformExecutor()
	_, err := exec.Execute(context.Background(), StepContext{
		Config: map[string]interface{}{
			"template": "{{.missing.closing",
		},
		Input: `{}`,
	})

	assert.Error(t, err)
}

// ============================================================================
// VariableExecutor
// ============================================================================

func TestVariableExecutor_SetVariable(t *testing.T) {
	exec := NewVariableExecutor()
	result, err := exec.Execute(context.Background(), StepContext{
		Config: map[string]interface{}{
			"name":  "myVar",
			"value": "myValue",
		},
		Input: "{}",
	})

	require.NoError(t, err)

	var output map[string]interface{}
	require.NoError(t, json.Unmarshal([]byte(result.OutputData), &output))
	assert.Equal(t, "myVar", output["name"])
	assert.Equal(t, "myValue", output["value"])
}

func TestVariableExecutor_EmptyConfig(t *testing.T) {
	exec := NewVariableExecutor()
	result, err := exec.Execute(context.Background(), StepContext{
		Config: map[string]interface{}{},
		Input:  "{}",
	})

	require.NoError(t, err)

	var output map[string]interface{}
	require.NoError(t, json.Unmarshal([]byte(result.OutputData), &output))
	assert.Equal(t, "", output["name"])
	assert.Equal(t, "", output["value"])
}

// ============================================================================
// Helper functions
// ============================================================================

func TestRenderTemplate_BasicInterpolation(t *testing.T) {
	result, err := renderTemplate(`Hello {{.input.name}}`, `{"name": "world"}`)
	require.NoError(t, err)
	assert.Equal(t, "Hello world", result)
}

func TestRenderTemplate_NestedAccess(t *testing.T) {
	result, err := renderTemplate(`Status: {{.input.data.status}}`, `{"data": {"status": "ok"}}`)
	require.NoError(t, err)
	assert.Equal(t, "Status: ok", result)
}

func TestRenderTemplate_InvalidJSON(t *testing.T) {
	result, err := renderTemplate(`Raw: {{.input.raw}}`, "not json")
	require.NoError(t, err)
	assert.Equal(t, "Raw: not json", result)
}

func TestRenderTemplate_InvalidTemplate(t *testing.T) {
	_, err := renderTemplate(`{{.broken`, `{}`)
	assert.Error(t, err)
}

func TestExtractField_Simple(t *testing.T) {
	data := map[string]interface{}{
		"status": "ok",
	}
	assert.Equal(t, "ok", extractField(data, "status"))
}

func TestExtractField_Nested(t *testing.T) {
	data := map[string]interface{}{
		"data": map[string]interface{}{
			"nested": map[string]interface{}{
				"value": 42.0,
			},
		},
	}
	assert.Equal(t, 42.0, extractField(data, "data.nested.value"))
}

func TestExtractField_Missing(t *testing.T) {
	data := map[string]interface{}{"a": "b"}
	assert.Nil(t, extractField(data, "missing"))
	assert.Nil(t, extractField(data, "a.b.c"))
}

func TestExtractField_EmptyPath(t *testing.T) {
	data := map[string]interface{}{"": "empty key"}
	assert.Equal(t, "empty key", extractField(data, ""))
}
