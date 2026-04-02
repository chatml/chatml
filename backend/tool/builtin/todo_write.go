package builtin

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/chatml/chatml-backend/tool"
)

// TodoWriteTool manages a structured task list emitted as events.
// The LLM sends the full updated todo list on each call.
type TodoWriteTool struct {
	emitFn func(eventType string, data interface{}) // Callback to emit events
}

// NewTodoWriteTool creates a TodoWrite tool that emits events via the callback.
func NewTodoWriteTool(emitFn func(eventType string, data interface{})) *TodoWriteTool {
	return &TodoWriteTool{emitFn: emitFn}
}

func (t *TodoWriteTool) Name() string { return "TodoWrite" }

func (t *TodoWriteTool) Description() string {
	return `Creates and manages a structured task list for tracking progress. Send the full updated todo list each time.`
}

func (t *TodoWriteTool) InputSchema() json.RawMessage {
	return json.RawMessage(`{
		"type": "object",
		"properties": {
			"todos": {
				"type": "array",
				"description": "The complete todo list",
				"items": {
					"type": "object",
					"properties": {
						"content": { "type": "string", "description": "Task description" },
						"status": { "type": "string", "enum": ["pending", "in_progress", "completed"] },
						"activeForm": { "type": "string", "description": "Present tense form shown during execution" }
					},
					"required": ["content", "status"]
				}
			}
		},
		"required": ["todos"]
	}`)
}

func (t *TodoWriteTool) IsConcurrentSafe() bool { return false }

type todoInput struct {
	Todos []todoItem `json:"todos"`
}

type todoItem struct {
	Content    string `json:"content"`
	Status     string `json:"status"`
	ActiveForm string `json:"activeForm,omitempty"`
}

func (t *TodoWriteTool) Execute(ctx context.Context, input json.RawMessage) (*tool.Result, error) {
	var in todoInput
	if err := json.Unmarshal(input, &in); err != nil {
		return tool.ErrorResult(fmt.Sprintf("Invalid input: %v", err)), nil
	}

	// Emit the todo_update event for the frontend
	if t.emitFn != nil {
		t.emitFn("todo_update", in.Todos)
	}

	pending := 0
	inProgress := 0
	completed := 0
	for _, item := range in.Todos {
		switch item.Status {
		case "pending":
			pending++
		case "in_progress":
			inProgress++
		case "completed":
			completed++
		}
	}

	return tool.TextResult(fmt.Sprintf("Updated todo list: %d pending, %d in progress, %d completed",
		pending, inProgress, completed)), nil
}

var _ tool.Tool = (*TodoWriteTool)(nil)
