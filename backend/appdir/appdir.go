package appdir

import (
	"os"
	"path/filepath"
	"runtime"
	"sync"
)

var (
	once sync.Once
	root string
)

// Init initializes the application directory structure.
// The default data directory is platform-specific:
//   - macOS:   ~/Library/Application Support/ChatML
//   - Windows: %LOCALAPPDATA%/ChatML
//   - Linux:   $XDG_DATA_HOME/ChatML (fallback: ~/.local/share/ChatML)
//
// Set CHATML_DATA_DIR to override the default location.
// It is safe to call multiple times; only the first call has any effect.
// Panics if the directories cannot be created.
func Init() {
	once.Do(func() {
		// Allow overriding the data directory via env var (used by dev builds
		// to isolate state from the production instance).
		if override := os.Getenv("CHATML_DATA_DIR"); override != "" {
			root = override
		} else {
			root = defaultDataDir()
		}

		// Create the directory tree in a single call (MkdirAll is idempotent).
		for _, dir := range []string{
			filepath.Join(root, "state"),
			filepath.Join(root, "workspaces"),
			filepath.Join(root, "tmp"),
		} {
			if err := os.MkdirAll(dir, 0755); err != nil {
				panic("appdir: failed to create directory " + dir + ": " + err.Error())
			}
		}
	})
}

func mustInit() {
	if root == "" {
		panic("appdir: Init() has not been called")
	}
}

// defaultDataDir returns the platform-specific default data directory.
func defaultDataDir() string {
	homeDir, err := os.UserHomeDir()
	if err != nil {
		panic("appdir: failed to get home directory: " + err.Error())
	}

	switch runtime.GOOS {
	case "darwin":
		return filepath.Join(homeDir, "Library", "Application Support", "ChatML")
	case "windows":
		if localAppData := os.Getenv("LOCALAPPDATA"); localAppData != "" {
			return filepath.Join(localAppData, "ChatML")
		}
		return filepath.Join(homeDir, "AppData", "Local", "ChatML")
	default: // linux, freebsd, etc.
		if xdgData := os.Getenv("XDG_DATA_HOME"); xdgData != "" {
			return filepath.Join(xdgData, "ChatML")
		}
		return filepath.Join(homeDir, ".local", "share", "ChatML")
	}
}

// Root returns the application data directory.
func Root() string {
	mustInit()
	return root
}

// StateDir returns Root()/state.
func StateDir() string {
	mustInit()
	return filepath.Join(root, "state")
}

// DBPath returns StateDir()/chatml.db.
func DBPath() string {
	return filepath.Join(StateDir(), "chatml.db")
}

// WorkspacesDir returns Root()/workspaces.
func WorkspacesDir() string {
	mustInit()
	return filepath.Join(root, "workspaces")
}

// TempDir returns Root()/tmp — a dedicated directory for temporary files
// that can be swept on startup to clean up after crashes.
func TempDir() string {
	mustInit()
	return filepath.Join(root, "tmp")
}

// CleanupTempDir removes all entries in TempDir(). It is intended to be called
// once at application startup, before any processes are created, so every entry
// present is an orphan from a previous run. Returns the number of entries
// removed and the number of errors encountered.
func CleanupTempDir() (removed int, failed int, err error) {
	dir := TempDir()
	entries, err := os.ReadDir(dir)
	if err != nil {
		if os.IsNotExist(err) {
			return 0, 0, nil
		}
		return 0, 0, err
	}
	for _, e := range entries {
		p := filepath.Join(dir, e.Name())
		var removeErr error
		if e.IsDir() {
			removeErr = os.RemoveAll(p)
		} else {
			removeErr = os.Remove(p)
		}
		if removeErr != nil {
			failed++
		} else {
			removed++
		}
	}
	return removed, failed, nil
}

// DataPath returns StateDir()/data.json.
func DataPath() string {
	return filepath.Join(StateDir(), "data.json")
}
