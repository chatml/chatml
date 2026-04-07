package task

import (
	"testing"
)

func TestCreateAndGet(t *testing.T) {
	mgr := NewManager()
	tsk := mgr.Create("Run tests", "Execute the test suite", "Running tests", nil)

	if tsk.ID == "" {
		t.Fatal("expected non-empty task ID")
	}
	if tsk.Subject != "Run tests" {
		t.Errorf("expected subject 'Run tests', got %q", tsk.Subject)
	}
	if tsk.Status != StatusPending {
		t.Errorf("expected status 'pending', got %q", tsk.Status)
	}

	got := mgr.Get(tsk.ID)
	if got == nil {
		t.Fatal("expected to find task by ID")
	}
	if got.ID != tsk.ID {
		t.Errorf("ID mismatch")
	}
}

func TestList(t *testing.T) {
	mgr := NewManager()
	mgr.Create("Task 1", "desc 1", "", nil)
	mgr.Create("Task 2", "desc 2", "", nil)
	mgr.Create("Task 3", "desc 3", "", nil)

	tasks := mgr.List()
	if len(tasks) != 3 {
		t.Fatalf("expected 3 tasks, got %d", len(tasks))
	}
	if tasks[0].Subject != "Task 1" {
		t.Errorf("expected first task 'Task 1', got %q", tasks[0].Subject)
	}
}

func TestUpdate(t *testing.T) {
	mgr := NewManager()
	tsk := mgr.Create("Build", "Run build", "", nil)

	err := mgr.Update(tsk.ID, UpdateOpts{
		Status:  StatusInProgress,
		Owner:   "agent-1",
		Subject: "Build project",
	})
	if err != nil {
		t.Fatalf("update error: %v", err)
	}

	got := mgr.Get(tsk.ID)
	if got.Status != StatusInProgress {
		t.Errorf("expected in_progress, got %q", got.Status)
	}
	if got.Owner != "agent-1" {
		t.Errorf("expected owner 'agent-1', got %q", got.Owner)
	}
	if got.Subject != "Build project" {
		t.Errorf("expected subject 'Build project', got %q", got.Subject)
	}
}

func TestDelete(t *testing.T) {
	mgr := NewManager()
	tsk := mgr.Create("Temp", "temp task", "", nil)

	if !mgr.Delete(tsk.ID) {
		t.Fatal("expected delete to return true")
	}
	if mgr.Get(tsk.ID) != nil {
		t.Error("expected task to be nil after delete")
	}
	if mgr.Delete(tsk.ID) {
		t.Error("expected second delete to return false")
	}
}

func TestStop(t *testing.T) {
	mgr := NewManager()
	tsk := mgr.Create("Long task", "desc", "", nil)
	mgr.Update(tsk.ID, UpdateOpts{Status: StatusInProgress}) //nolint:errcheck

	err := mgr.Stop(tsk.ID)
	if err != nil {
		t.Fatalf("stop error: %v", err)
	}

	got := mgr.Get(tsk.ID)
	if got.Status != StatusStopped {
		t.Errorf("expected stopped, got %q", got.Status)
	}
}

func TestBlockingRelationships(t *testing.T) {
	mgr := NewManager()
	t1 := mgr.Create("Task 1", "desc", "", nil)
	t2 := mgr.Create("Task 2", "desc", "", nil)

	mgr.Update(t1.ID, UpdateOpts{AddBlocks: []string{t2.ID}})    //nolint:errcheck
	mgr.Update(t2.ID, UpdateOpts{AddBlockedBy: []string{t1.ID}}) //nolint:errcheck

	got1 := mgr.Get(t1.ID)
	if len(got1.Blocks) != 1 || got1.Blocks[0] != t2.ID {
		t.Errorf("expected t1 to block t2")
	}

	got2 := mgr.Get(t2.ID)
	if len(got2.BlockedBy) != 1 || got2.BlockedBy[0] != t1.ID {
		t.Errorf("expected t2 blocked by t1")
	}
}

func TestIsTerminal(t *testing.T) {
	mgr := NewManager()
	tsk := mgr.Create("Test", "desc", "", nil)

	if tsk.IsTerminal() {
		t.Error("pending should not be terminal")
	}

	mgr.Update(tsk.ID, UpdateOpts{Status: StatusCompleted}) //nolint:errcheck
	if !tsk.IsTerminal() {
		t.Error("completed should be terminal")
	}
}

func TestFormatList(t *testing.T) {
	mgr := NewManager()
	mgr.Create("Task 1", "desc 1", "", nil)
	t2 := mgr.Create("Task 2", "desc 2", "", nil)
	mgr.Update(t2.ID, UpdateOpts{Status: StatusInProgress}) //nolint:errcheck

	output := FormatList(mgr.List())
	if output == "" {
		t.Error("expected non-empty output")
	}
}

func TestMetadata(t *testing.T) {
	mgr := NewManager()
	tsk := mgr.Create("Task", "desc", "", map[string]interface{}{
		"key1": "value1",
	})

	// Update with new key and nil (delete)
	mgr.Update(tsk.ID, UpdateOpts{
		Metadata: map[string]interface{}{
			"key2": "value2",
			"key1": nil, // Delete key1
		},
	}) //nolint:errcheck

	got := mgr.Get(tsk.ID)
	if _, ok := got.Metadata["key1"]; ok {
		t.Error("key1 should be deleted")
	}
	if got.Metadata["key2"] != "value2" {
		t.Error("key2 should be 'value2'")
	}
}
