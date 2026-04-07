package builtin

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/chatml/chatml-core/tool"
)

// CronStore persists scheduled cron jobs to a JSON file.
type CronStore struct {
	mu   sync.RWMutex
	path string
	jobs []CronJob
}

// CronJob represents a scheduled task.
type CronJob struct {
	ID          string `json:"id"`
	Schedule    string `json:"schedule"`    // Cron expression (e.g., "*/5 * * * *")
	Prompt      string `json:"prompt"`      // Task prompt to execute
	Description string `json:"description"` // Human-readable description
	Enabled     bool   `json:"enabled"`
}

// NewCronStore creates a store at the given path.
func NewCronStore(workdir string) *CronStore {
	path := filepath.Join(workdir, ".claude", "cron.json")
	store := &CronStore{path: path}
	store.load()
	return store
}

func (s *CronStore) load() {
	data, err := os.ReadFile(s.path)
	if err != nil {
		return // File doesn't exist yet — OK
	}
	if err := json.Unmarshal(data, &s.jobs); err != nil {
		log.Printf("cron: corrupt %s, starting with empty jobs: %v", s.path, err)
	}
}

func (s *CronStore) save() error {
	os.MkdirAll(filepath.Dir(s.path), 0755) //nolint:errcheck
	data, err := json.MarshalIndent(s.jobs, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(s.path, data, 0644)
}

func (s *CronStore) Add(job CronJob) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.jobs = append(s.jobs, job)
	return s.save()
}

func (s *CronStore) List() []CronJob {
	s.mu.RLock()
	defer s.mu.RUnlock()
	result := make([]CronJob, len(s.jobs))
	copy(result, s.jobs)
	return result
}

func (s *CronStore) Delete(id string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i, j := range s.jobs {
		if j.ID == id {
			s.jobs = append(s.jobs[:i], s.jobs[i+1:]...)
			s.save() //nolint:errcheck
			return true
		}
	}
	return false
}

// --- CronCreate Tool ---

type CronCreateTool struct {
	store *CronStore
}

func NewCronCreateTool(store *CronStore) *CronCreateTool {
	return &CronCreateTool{store: store}
}

func (t *CronCreateTool) Name() string        { return "CronCreate" }
func (t *CronCreateTool) IsConcurrentSafe() bool { return true }
func (t *CronCreateTool) DeferLoading() bool   { return true }

func (t *CronCreateTool) Description() string {
	return "Create a scheduled cron job that runs a prompt on a recurring schedule."
}

func (t *CronCreateTool) InputSchema() json.RawMessage {
	return json.RawMessage(`{
		"type": "object",
		"properties": {
			"schedule": { "type": "string", "description": "Cron expression (e.g., '*/5 * * * *' for every 5 minutes)" },
			"prompt": { "type": "string", "description": "The prompt to execute on each run" },
			"description": { "type": "string", "description": "Human-readable description" }
		},
		"required": ["schedule", "prompt"]
	}`)
}

func (t *CronCreateTool) Execute(ctx context.Context, input json.RawMessage) (*tool.Result, error) {
	var in struct {
		Schedule    string `json:"schedule"`
		Prompt      string `json:"prompt"`
		Description string `json:"description"`
	}
	if err := json.Unmarshal(input, &in); err != nil {
		return tool.ErrorResult("Invalid input: " + err.Error()), nil
	}

	if in.Schedule == "" || in.Prompt == "" {
		return tool.ErrorResult("schedule and prompt are required"), nil
	}

	id := fmt.Sprintf("cron-%d", time.Now().UnixNano())
	job := CronJob{
		ID:          id,
		Schedule:    in.Schedule,
		Prompt:      in.Prompt,
		Description: in.Description,
		Enabled:     true,
	}

	if err := t.store.Add(job); err != nil {
		return tool.ErrorResult("Failed to save cron job: " + err.Error()), nil
	}

	result, _ := json.Marshal(map[string]interface{}{
		"id":       id,
		"schedule": in.Schedule,
		"message":  "Cron job created",
	})
	return tool.TextResult(string(result)), nil
}

// --- CronList Tool ---

type CronListTool struct {
	store *CronStore
}

func NewCronListTool(store *CronStore) *CronListTool {
	return &CronListTool{store: store}
}

func (t *CronListTool) Name() string        { return "CronList" }
func (t *CronListTool) IsConcurrentSafe() bool { return true }
func (t *CronListTool) DeferLoading() bool   { return true }

func (t *CronListTool) Description() string {
	return "List all scheduled cron jobs."
}

func (t *CronListTool) InputSchema() json.RawMessage {
	return json.RawMessage(`{"type": "object", "properties": {}}`)
}

func (t *CronListTool) Execute(ctx context.Context, input json.RawMessage) (*tool.Result, error) {
	jobs := t.store.List()
	result, _ := json.Marshal(map[string]interface{}{"jobs": jobs})
	return tool.TextResult(string(result)), nil
}

// --- CronDelete Tool ---

type CronDeleteTool struct {
	store *CronStore
}

func NewCronDeleteTool(store *CronStore) *CronDeleteTool {
	return &CronDeleteTool{store: store}
}

func (t *CronDeleteTool) Name() string        { return "CronDelete" }
func (t *CronDeleteTool) IsConcurrentSafe() bool { return true }
func (t *CronDeleteTool) DeferLoading() bool   { return true }

func (t *CronDeleteTool) Description() string {
	return "Delete a scheduled cron job by ID."
}

func (t *CronDeleteTool) InputSchema() json.RawMessage {
	return json.RawMessage(`{
		"type": "object",
		"properties": {
			"id": { "type": "string", "description": "Cron job ID to delete" }
		},
		"required": ["id"]
	}`)
}

func (t *CronDeleteTool) Execute(ctx context.Context, input json.RawMessage) (*tool.Result, error) {
	var in struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(input, &in); err != nil {
		return tool.ErrorResult("Invalid input: " + err.Error()), nil
	}

	if in.ID == "" {
		return tool.ErrorResult("id is required"), nil
	}

	if !t.store.Delete(in.ID) {
		return tool.ErrorResult(fmt.Sprintf("Cron job %q not found", in.ID)), nil
	}

	return tool.TextResult(fmt.Sprintf(`{"message": "Cron job %s deleted", "id": %q}`, in.ID, in.ID)), nil
}
