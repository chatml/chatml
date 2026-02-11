package appdir

import (
	"os"
	"path/filepath"
	"sync"
	"testing"
)

// resetForTest clears the package-level state so Init() can run again.
func resetForTest() {
	once = sync.Once{}
	root = ""
}

func TestInit_CreatesDirectories(t *testing.T) {
	resetForTest()

	tmp := t.TempDir()
	t.Setenv("HOME", tmp)

	Init()

	expected := filepath.Join(tmp, "Library", "Application Support", "ChatML")
	if root != expected {
		t.Fatalf("root = %q, want %q", root, expected)
	}

	for _, sub := range []string{"state", "workspaces"} {
		info, err := os.Stat(filepath.Join(expected, sub))
		if err != nil {
			t.Fatalf("expected directory %s to exist: %v", sub, err)
		}
		if !info.IsDir() {
			t.Fatalf("%s is not a directory", sub)
		}
	}
}

func TestInit_Idempotent(t *testing.T) {
	resetForTest()

	tmp := t.TempDir()
	t.Setenv("HOME", tmp)

	Init()
	first := root

	Init() // second call is a no-op
	if root != first {
		t.Fatalf("root changed after second Init(): %q vs %q", root, first)
	}
}

func TestAccessors(t *testing.T) {
	resetForTest()

	tmp := t.TempDir()
	t.Setenv("HOME", tmp)

	Init()

	base := filepath.Join(tmp, "Library", "Application Support", "ChatML")

	tests := []struct {
		name string
		fn   func() string
		want string
	}{
		{"Root", Root, base},
		{"StateDir", StateDir, filepath.Join(base, "state")},
		{"DBPath", DBPath, filepath.Join(base, "state", "chatml.db")},
		{"WorkspacesDir", WorkspacesDir, filepath.Join(base, "workspaces")},
		{"DataPath", DataPath, filepath.Join(base, "state", "data.json")},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := tt.fn(); got != tt.want {
				t.Errorf("%s() = %q, want %q", tt.name, got, tt.want)
			}
		})
	}
}

func TestAccessors_PanicWithoutInit(t *testing.T) {
	resetForTest()

	fns := []struct {
		name string
		fn   func() string
	}{
		{"Root", Root},
		{"StateDir", StateDir},
		{"DBPath", DBPath},
		{"WorkspacesDir", WorkspacesDir},
		{"DataPath", DataPath},
	}

	for _, tt := range fns {
		t.Run(tt.name, func(t *testing.T) {
			defer func() {
				if r := recover(); r == nil {
					t.Errorf("%s() did not panic without Init()", tt.name)
				}
			}()
			tt.fn()
		})
	}
}
