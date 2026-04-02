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

	// Validate: at most 1 in_progress task
	inProgress := 0
	pending := 0
	completed := 0
	for _, item := range in.Todos {
		switch item.Status {
		case "pending":
			pending++
		case "in_progress":
			inProgress++
		case "completed":
			completed++
		default:
			return tool.ErrorResult(fmt.Sprintf("Invalid status %q — must be pending, in_progress, or completed", item.Status)), nil
		}

		if item.Content == "" {
			return tool.ErrorResult("Each todo must have non-empty content"), nil
		}
	}

	if inProgress > 1 {
		return tool.ErrorResult(fmt.Sprintf("At most 1 task should be in_progress at a time (found %d). Complete the current task before starting another.", inProgress)), nil
	}

	// Emit the todo_update event for the frontend
	if t.emitFn != nil {
		t.emitFn("todo_update", in.Todos)
	}

	return tool.TextResult(fmt.Sprintf("Updated todo list: %d pending, %d in progress, %d completed",
		pending, inProgress, completed)), nil
}

// Prompt implements tool.PromptProvider.
func (t *TodoWriteTool) Prompt() string {
	return `Use this tool to create and manage a structured task list for your current coding session. This helps you track progress, organize complex tasks, and demonstrate thoroughness to the user.
It also helps the user understand the progress of the task and overall progress of their requests.

## When to Use This Tool
Use this tool proactively in these scenarios:

1. Complex multi-step tasks - When a task requires 3 or more distinct steps or actions
2. Non-trivial and complex tasks - Tasks that require careful planning or multiple operations
3. User explicitly requests todo list - When the user directly asks you to use the todo list
4. User provides multiple tasks - When users provide a list of things to be done
5. After receiving new instructions - Immediately capture user requirements as todos
6. When you start working on a task - Mark it as in_progress BEFORE beginning work
7. After completing a task - Mark it as completed and add any new follow-up tasks

## When NOT to Use This Tool

Skip using this tool when:
1. There is only a single, straightforward task
2. The task is trivial and tracking it provides no organizational benefit
3. The task can be completed in less than 3 trivial steps
4. The task is purely conversational or informational

## Task States and Management

1. **Task States**: Use these states to track progress:
   - pending: Task not yet started
   - in_progress: Currently working on (limit to ONE task at a time)
   - completed: Task finished successfully

   **IMPORTANT**: Task descriptions must have two forms:
   - content: The imperative form describing what needs to be done (e.g., "Run tests", "Build the project")
   - activeForm: The present continuous form shown during execution (e.g., "Running tests", "Building the project")

2. **Task Management**:
   - Update task status in real-time as you work
   - Mark tasks complete IMMEDIATELY after finishing (don't batch completions)
   - Exactly ONE task must be in_progress at any time (not less, not more)
   - Complete current tasks before starting new ones
   - Remove tasks that are no longer relevant from the list entirely

3. **Task Completion Requirements**:
   - ONLY mark a task as completed when you have FULLY accomplished it
   - If you encounter errors, blockers, or cannot finish, keep the task as in_progress
   - When blocked, create a new task describing what needs to be resolved
   - Never mark a task as completed if:
     - Tests are failing
     - Implementation is partial
     - You encountered unresolved errors
     - You couldn't find necessary files or dependencies`
}

var _ tool.Tool = (*TodoWriteTool)(nil)
var _ tool.PromptProvider = (*TodoWriteTool)(nil)
