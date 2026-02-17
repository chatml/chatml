package automation

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"text/template"
	"time"

	"github.com/chatml/chatml-backend/logger"
)

// ============================================================================
// Webhook executor
// ============================================================================

type WebhookExecutor struct {
	client *http.Client
}

func NewWebhookExecutor() *WebhookExecutor {
	return &WebhookExecutor{
		client: &http.Client{Timeout: 30 * time.Second},
	}
}

func (e *WebhookExecutor) Execute(ctx context.Context, step StepContext) (*StepResult, error) {
	method, _ := step.Config["method"].(string)
	if method == "" {
		method = "POST"
	}
	url, _ := step.Config["url"].(string)
	if url == "" {
		return nil, fmt.Errorf("webhook URL is required")
	}

	// Template interpolation on body
	bodyTemplate, _ := step.Config["bodyTemplate"].(string)
	var body string
	if bodyTemplate != "" {
		rendered, err := renderTemplate(bodyTemplate, step.Input)
		if err != nil {
			return nil, fmt.Errorf("render body template: %w", err)
		}
		body = rendered
	}

	// Also interpolate the URL
	renderedURL, err := renderTemplate(url, step.Input)
	if err != nil {
		renderedURL = url
	}

	req, err := http.NewRequestWithContext(ctx, method, renderedURL, strings.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}

	// Parse headers
	headersStr, _ := step.Config["headers"].(string)
	if headersStr != "" {
		var headers map[string]string
		if err := json.Unmarshal([]byte(headersStr), &headers); err == nil {
			for k, v := range headers {
				req.Header.Set(k, v)
			}
		}
	}
	if req.Header.Get("Content-Type") == "" && body != "" {
		req.Header.Set("Content-Type", "application/json")
	}

	resp, err := e.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("webhook request failed: %w", err)
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20)) // 1MB limit

	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("webhook returned status %d: %s", resp.StatusCode, string(respBody))
	}

	output := map[string]interface{}{
		"statusCode": resp.StatusCode,
		"body":       json.RawMessage(respBody),
	}
	// If body isn't valid JSON, store as string
	if !json.Valid(respBody) {
		output["body"] = string(respBody)
	}
	outputJSON, _ := json.Marshal(output)

	return &StepResult{OutputData: string(outputJSON)}, nil
}

// ============================================================================
// Script executor
// ============================================================================

type ScriptExecutor struct{}

func NewScriptExecutor() *ScriptExecutor {
	return &ScriptExecutor{}
}

func (e *ScriptExecutor) Execute(ctx context.Context, step StepContext) (*StepResult, error) {
	command, _ := step.Config["command"].(string)
	if command == "" {
		return nil, fmt.Errorf("script command is required")
	}

	workDir, _ := step.Config["workDir"].(string)

	logger.Automation.Infof("Executing script: %s (workDir=%s)", command, workDir)

	// Execute via os/exec
	cmd := execCommandContext(ctx, "sh", "-c", command)
	if workDir != "" {
		cmd.Dir = workDir
	}

	out, err := cmd.CombinedOutput()
	exitCode := 0
	if err != nil {
		// Try to extract exit code
		exitCode = 1
		if exitErr, ok := err.(*execExitError); ok {
			exitCode = exitErr.ExitCode()
		}
	}

	output := map[string]interface{}{
		"stdout":   string(out),
		"exitCode": exitCode,
	}
	outputJSON, _ := json.Marshal(output)

	if exitCode != 0 {
		return nil, fmt.Errorf("script exited with code %d: %s", exitCode, string(out))
	}

	return &StepResult{OutputData: string(outputJSON)}, nil
}

// ============================================================================
// Conditional executor
// ============================================================================

type ConditionalExecutor struct{}

func NewConditionalExecutor() *ConditionalExecutor {
	return &ConditionalExecutor{}
}

func (e *ConditionalExecutor) Execute(ctx context.Context, step StepContext) (*StepResult, error) {
	field, _ := step.Config["field"].(string)
	operator, _ := step.Config["operator"].(string)
	value, _ := step.Config["value"].(string)

	if operator == "" {
		operator = "equals"
	}

	// Extract field value from input data
	var inputData map[string]interface{}
	if err := json.Unmarshal([]byte(step.Input), &inputData); err != nil {
		inputData = make(map[string]interface{})
	}

	fieldValue := extractField(inputData, field)
	fieldStr := fmt.Sprintf("%v", fieldValue)

	result := false
	switch operator {
	case "equals":
		result = fieldStr == value
	case "not_equals":
		result = fieldStr != value
	case "contains":
		result = strings.Contains(fieldStr, value)
	case "exists":
		result = fieldValue != nil
	case "gt":
		if fNum, fErr := strconv.ParseFloat(fieldStr, 64); fErr == nil {
			if vNum, vErr := strconv.ParseFloat(value, 64); vErr == nil {
				result = fNum > vNum
				break
			}
		}
		result = fieldStr > value
	case "lt":
		if fNum, fErr := strconv.ParseFloat(fieldStr, 64); fErr == nil {
			if vNum, vErr := strconv.ParseFloat(value, 64); vErr == nil {
				result = fNum < vNum
				break
			}
		}
		result = fieldStr < value
	}

	output := map[string]interface{}{
		"result": result,
		"field":  field,
		"value":  fieldStr,
	}
	outputJSON, _ := json.Marshal(output)

	return &StepResult{OutputData: string(outputJSON)}, nil
}

// ============================================================================
// Delay executor
// ============================================================================

type DelayExecutor struct{}

func NewDelayExecutor() *DelayExecutor {
	return &DelayExecutor{}
}

func (e *DelayExecutor) Execute(ctx context.Context, step StepContext) (*StepResult, error) {
	durationSecs := 60.0
	if v, ok := step.Config["durationSecs"].(float64); ok {
		durationSecs = v
	}

	duration := time.Duration(durationSecs) * time.Second
	logger.Automation.Infof("Delay node: waiting %v", duration)

	select {
	case <-time.After(duration):
		return &StepResult{OutputData: step.Input}, nil
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

// ============================================================================
// Transform executor
// ============================================================================

type TransformExecutor struct{}

func NewTransformExecutor() *TransformExecutor {
	return &TransformExecutor{}
}

func (e *TransformExecutor) Execute(ctx context.Context, step StepContext) (*StepResult, error) {
	tmpl, _ := step.Config["template"].(string)
	if tmpl == "" {
		// Pass through
		return &StepResult{OutputData: step.Input}, nil
	}

	rendered, err := renderTemplate(tmpl, step.Input)
	if err != nil {
		return nil, fmt.Errorf("render transform template: %w", err)
	}

	// Validate it's valid JSON if it looks like JSON
	if strings.HasPrefix(strings.TrimSpace(rendered), "{") || strings.HasPrefix(strings.TrimSpace(rendered), "[") {
		if !json.Valid([]byte(rendered)) {
			return nil, fmt.Errorf("transform output is not valid JSON")
		}
	}

	return &StepResult{OutputData: rendered}, nil
}

// ============================================================================
// Variable executor (set/get)
// ============================================================================

type VariableExecutor struct{}

func NewVariableExecutor() *VariableExecutor {
	return &VariableExecutor{}
}

func (e *VariableExecutor) Execute(ctx context.Context, step StepContext) (*StepResult, error) {
	name, _ := step.Config["name"].(string)
	value, _ := step.Config["value"].(string)

	output := map[string]interface{}{
		"name":  name,
		"value": value,
	}
	outputJSON, _ := json.Marshal(output)
	return &StepResult{OutputData: string(outputJSON)}, nil
}

// ============================================================================
// Helpers
// ============================================================================

// renderTemplate applies Go text/template to the given template string,
// parsing the inputJSON as the template data.
func renderTemplate(tmplStr, inputJSON string) (string, error) {
	var data interface{}
	if err := json.Unmarshal([]byte(inputJSON), &data); err != nil {
		data = map[string]interface{}{"raw": inputJSON}
	}

	// Wrap in a map with "input" key for convenient access
	templateData := map[string]interface{}{
		"input": data,
	}

	t, err := template.New("step").Parse(tmplStr)
	if err != nil {
		return "", fmt.Errorf("parse template: %w", err)
	}

	var buf bytes.Buffer
	if err := t.Execute(&buf, templateData); err != nil {
		return "", fmt.Errorf("execute template: %w", err)
	}

	return buf.String(), nil
}

// extractField gets a value from a nested map using dot notation (e.g. "input.status").
func extractField(data map[string]interface{}, path string) interface{} {
	parts := strings.Split(path, ".")
	var current interface{} = data
	for _, part := range parts {
		if m, ok := current.(map[string]interface{}); ok {
			current = m[part]
		} else {
			return nil
		}
	}
	return current
}
