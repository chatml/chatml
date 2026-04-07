package builtin

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/chatml/chatml-core/task"
	"github.com/chatml/chatml-core/tool"
)

// TaskManager is the interface the task tools use to manage tasks.
// Implemented by *task.Manager.
type TaskManager interface {
	Create(subject, description, activeForm string, metadata map[string]interface{}) *task.Task
	Get(id string) *task.Task
	List() []*task.Task
	Update(id string, opts task.UpdateOpts) error
	Delete(id string) bool
	Stop(id string) error
}

// --- TaskCreate ---

type TaskCreateTool struct {
	mgr TaskManager
}

func NewTaskCreateTool(mgr TaskManager) *TaskCreateTool {
	return &TaskCreateTool{mgr: mgr}
}

func (t *TaskCreateTool) Name() string { return "TaskCreate" }
func (t *TaskCreateTool) Description() string {
	return "Create a new background task for tracking work progress. Returns the task ID."
}
func (t *TaskCreateTool) InputSchema() json.RawMessage {
	return json.RawMessage(`{
		"type": "object",
		"properties": {
			"subject": { "type": "string", "description": "Brief title for the task" },
			"description": { "type": "string", "description": "What needs to be done" },
			"activeForm": { "type": "string", "description": "Present continuous form (e.g. 'Running tests')" },
			"metadata": { "type": "object", "description": "Arbitrary metadata" }
		},
		"required": ["subject", "description"]
	}`)
}
func (t *TaskCreateTool) IsConcurrentSafe() bool { return true }
func (t *TaskCreateTool) DeferLoading() bool      { return true }

func (t *TaskCreateTool) Execute(ctx context.Context, input json.RawMessage) (*tool.Result, error) {
	var in struct {
		Subject     string                 `json:"subject"`
		Description string                 `json:"description"`
		ActiveForm  string                 `json:"activeForm"`
		Metadata    map[string]interface{} `json:"metadata"`
	}
	if err := json.Unmarshal(input, &in); err != nil {
		return tool.ErrorResult("Invalid input: " + err.Error()), nil
	}
	if in.Subject == "" || in.Description == "" {
		return tool.ErrorResult("subject and description are required"), nil
	}

	created := t.mgr.Create(in.Subject, in.Description, in.ActiveForm, in.Metadata)

	result, _ := json.Marshal(map[string]interface{}{
		"task": map[string]string{
			"id":      created.ID,
			"subject": created.Subject,
		},
	})
	return tool.TextResult(string(result)), nil
}

// --- TaskGet ---

type TaskGetTool struct {
	mgr TaskManager
}

func NewTaskGetTool(mgr TaskManager) *TaskGetTool {
	return &TaskGetTool{mgr: mgr}
}

func (t *TaskGetTool) Name() string { return "TaskGet" }
func (t *TaskGetTool) Description() string {
	return "Get details of a specific task by ID."
}
func (t *TaskGetTool) InputSchema() json.RawMessage {
	return json.RawMessage(`{
		"type": "object",
		"properties": {
			"taskId": { "type": "string", "description": "Task ID" }
		},
		"required": ["taskId"]
	}`)
}
func (t *TaskGetTool) IsConcurrentSafe() bool { return true }
func (t *TaskGetTool) DeferLoading() bool      { return true }

func (t *TaskGetTool) Execute(ctx context.Context, input json.RawMessage) (*tool.Result, error) {
	var in struct {
		TaskID string `json:"taskId"`
	}
	if err := json.Unmarshal(input, &in); err != nil {
		return tool.ErrorResult("Invalid input: " + err.Error()), nil
	}

	tsk := t.mgr.Get(in.TaskID)
	if tsk == nil {
		return tool.TextResult(`{"task": null}`), nil
	}

	result, _ := json.Marshal(map[string]interface{}{
		"task": tsk,
	})
	return tool.TextResult(string(result)), nil
}

// --- TaskUpdate ---

type TaskUpdateTool struct {
	mgr TaskManager
}

func NewTaskUpdateTool(mgr TaskManager) *TaskUpdateTool {
	return &TaskUpdateTool{mgr: mgr}
}

func (t *TaskUpdateTool) Name() string { return "TaskUpdate" }
func (t *TaskUpdateTool) Description() string {
	return "Update a task's fields (subject, description, status, owner, blocking relationships, metadata)."
}
func (t *TaskUpdateTool) InputSchema() json.RawMessage {
	return json.RawMessage(`{
		"type": "object",
		"properties": {
			"taskId": { "type": "string", "description": "Task ID" },
			"subject": { "type": "string" },
			"description": { "type": "string" },
			"activeForm": { "type": "string" },
			"status": { "type": "string", "enum": ["pending", "in_progress", "completed", "failed", "stopped", "deleted"] },
			"owner": { "type": "string" },
			"addBlocks": { "type": "array", "items": { "type": "string" }, "description": "Task IDs this task blocks" },
			"addBlockedBy": { "type": "array", "items": { "type": "string" }, "description": "Task IDs blocking this task" },
			"metadata": { "type": "object" }
		},
		"required": ["taskId"]
	}`)
}
func (t *TaskUpdateTool) IsConcurrentSafe() bool { return true }
func (t *TaskUpdateTool) DeferLoading() bool      { return true }

func (t *TaskUpdateTool) Execute(ctx context.Context, input json.RawMessage) (*tool.Result, error) {
	var in struct {
		TaskID       string                 `json:"taskId"`
		Subject      string                 `json:"subject"`
		Description  string                 `json:"description"`
		ActiveForm   string                 `json:"activeForm"`
		Status       string                 `json:"status"`
		Owner        string                 `json:"owner"`
		AddBlocks    []string               `json:"addBlocks"`
		AddBlockedBy []string               `json:"addBlockedBy"`
		Metadata     map[string]interface{} `json:"metadata"`
	}
	if err := json.Unmarshal(input, &in); err != nil {
		return tool.ErrorResult("Invalid input: " + err.Error()), nil
	}

	if in.TaskID == "" {
		return tool.ErrorResult("taskId is required"), nil
	}

	// Handle "deleted" as a special status
	if in.Status == "deleted" {
		if t.mgr.Delete(in.TaskID) {
			return tool.TextResult(fmt.Sprintf(`{"success": true, "taskId": %q, "deleted": true}`, in.TaskID)), nil
		}
		return tool.ErrorResult(fmt.Sprintf("task %q not found", in.TaskID)), nil
	}

	opts := task.UpdateOpts{
		Subject:      in.Subject,
		Description:  in.Description,
		ActiveForm:   in.ActiveForm,
		Owner:        in.Owner,
		AddBlocks:    in.AddBlocks,
		AddBlockedBy: in.AddBlockedBy,
		Metadata:     in.Metadata,
	}
	if in.Status != "" {
		opts.Status = task.Status(in.Status)
	}

	if err := t.mgr.Update(in.TaskID, opts); err != nil {
		return tool.ErrorResult(err.Error()), nil
	}

	var updatedFields []string
	if in.Subject != "" {
		updatedFields = append(updatedFields, "subject")
	}
	if in.Description != "" {
		updatedFields = append(updatedFields, "description")
	}
	if in.Status != "" {
		updatedFields = append(updatedFields, "status")
	}
	if in.Owner != "" {
		updatedFields = append(updatedFields, "owner")
	}

	result, _ := json.Marshal(map[string]interface{}{
		"success":       true,
		"taskId":        in.TaskID,
		"updatedFields": updatedFields,
	})
	return tool.TextResult(string(result)), nil
}

// --- TaskList ---

type TaskListTool struct {
	mgr TaskManager
}

func NewTaskListTool(mgr TaskManager) *TaskListTool {
	return &TaskListTool{mgr: mgr}
}

func (t *TaskListTool) Name() string { return "TaskList" }
func (t *TaskListTool) Description() string {
	return "List all tasks and their current status."
}
func (t *TaskListTool) InputSchema() json.RawMessage {
	return json.RawMessage(`{"type": "object", "properties": {}}`)
}
func (t *TaskListTool) IsConcurrentSafe() bool { return true }
func (t *TaskListTool) DeferLoading() bool      { return true }

func (t *TaskListTool) Execute(ctx context.Context, input json.RawMessage) (*tool.Result, error) {
	tasks := t.mgr.List()

	result, _ := json.Marshal(map[string]interface{}{
		"tasks": tasks,
	})
	return tool.TextResult(string(result)), nil
}

// --- TaskStop ---

type TaskStopTool struct {
	mgr TaskManager
}

func NewTaskStopTool(mgr TaskManager) *TaskStopTool {
	return &TaskStopTool{mgr: mgr}
}

func (t *TaskStopTool) Name() string { return "TaskStop" }
func (t *TaskStopTool) Description() string {
	return "Stop a running background task."
}
func (t *TaskStopTool) InputSchema() json.RawMessage {
	return json.RawMessage(`{
		"type": "object",
		"properties": {
			"task_id": { "type": "string", "description": "Task ID to stop" }
		},
		"required": ["task_id"]
	}`)
}
func (t *TaskStopTool) IsConcurrentSafe() bool { return true }
func (t *TaskStopTool) DeferLoading() bool      { return true }

func (t *TaskStopTool) Execute(ctx context.Context, input json.RawMessage) (*tool.Result, error) {
	var in struct {
		TaskID string `json:"task_id"`
	}
	if err := json.Unmarshal(input, &in); err != nil {
		return tool.ErrorResult("Invalid input: " + err.Error()), nil
	}

	if in.TaskID == "" {
		return tool.ErrorResult("task_id is required"), nil
	}

	if err := t.mgr.Stop(in.TaskID); err != nil {
		return tool.ErrorResult(err.Error()), nil
	}

	return tool.TextResult(fmt.Sprintf(`{"message": "Task %s stopped", "task_id": %q}`, in.TaskID, in.TaskID)), nil
}

// --- TaskOutput ---

type TaskOutputTool struct {
	mgr TaskManager
}

func NewTaskOutputTool(mgr TaskManager) *TaskOutputTool {
	return &TaskOutputTool{mgr: mgr}
}

func (t *TaskOutputTool) Name() string { return "TaskOutput" }
func (t *TaskOutputTool) Description() string {
	return "Get the output of a task. Can block until completion or return current state."
}
func (t *TaskOutputTool) InputSchema() json.RawMessage {
	return json.RawMessage(`{
		"type": "object",
		"properties": {
			"task_id": { "type": "string", "description": "Task ID" },
			"block": { "type": "boolean", "description": "Wait for completion (default: true)" },
			"timeout": { "type": "number", "description": "Max wait in milliseconds (0-600000, default: 30000)" }
		},
		"required": ["task_id"]
	}`)
}
func (t *TaskOutputTool) IsConcurrentSafe() bool { return true }
func (t *TaskOutputTool) DeferLoading() bool      { return true }

func (t *TaskOutputTool) Execute(ctx context.Context, input json.RawMessage) (*tool.Result, error) {
	var in struct {
		TaskID  string `json:"task_id"`
		Block   *bool  `json:"block"`
		Timeout *int   `json:"timeout"`
	}
	if err := json.Unmarshal(input, &in); err != nil {
		return tool.ErrorResult("Invalid input: " + err.Error()), nil
	}

	if in.TaskID == "" {
		return tool.ErrorResult("task_id is required"), nil
	}

	// Note: Get() returns a shared pointer — task state is updated in place by the manager.
	// Re-fetching on each poll tick would be safer but adds overhead; the current contract
	// is that task fields are updated atomically by the manager goroutine.
	tsk := t.mgr.Get(in.TaskID)
	if tsk == nil {
		return tool.TextResult(`{"retrieval_status": "not_found", "task": null}`), nil
	}

	// Default: block with 30s timeout
	shouldBlock := true
	if in.Block != nil {
		shouldBlock = *in.Block
	}
	timeoutMs := 30000
	if in.Timeout != nil {
		timeoutMs = *in.Timeout
		if timeoutMs < 0 {
			timeoutMs = 0
		}
		if timeoutMs > 600000 {
			timeoutMs = 600000
		}
	}

	if shouldBlock && !tsk.IsTerminal() {
		// Poll until terminal or timeout
		deadline := time.After(time.Duration(timeoutMs) * time.Millisecond)
		ticker := time.NewTicker(100 * time.Millisecond)
		defer ticker.Stop()

	waitLoop:
		for {
			select {
			case <-ctx.Done():
				break waitLoop
			case <-deadline:
				break waitLoop
			case <-ticker.C:
				if tsk.IsTerminal() {
					break waitLoop
				}
			}
		}
	}

	status := "success"
	if !tsk.IsTerminal() {
		if shouldBlock {
			status = "timeout"
		} else {
			status = "not_ready"
		}
	}

	result, _ := json.Marshal(map[string]interface{}{
		"retrieval_status": status,
		"task": map[string]interface{}{
			"task_id":     tsk.ID,
			"status":      tsk.Status,
			"subject":     tsk.Subject,
			"description": tsk.Description,
			"output":      tsk.Output,
			"error":       tsk.Error,
		},
	})
	return tool.TextResult(string(result)), nil
}
