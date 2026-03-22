package server

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/chatml/chatml-backend/logger"
)

// gstackRepoURL is the default gstack repository URL. Override via GSTACK_REPO_URL env var.
var gstackRepoURL = getEnvOrDefault("GSTACK_REPO_URL", "https://github.com/garrytan/gstack.git")

// gstackPinnedCommit pins the gstack clone to a known-good commit for supply chain safety.
// Set GSTACK_PINNED_COMMIT="" to disable pinning and track HEAD.
var gstackPinnedCommit = getEnvOrDefault("GSTACK_PINNED_COMMIT", "")

func getEnvOrDefault(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// gstackGitTimeout is the maximum duration for git clone/pull operations.
const gstackGitTimeout = 60 * time.Second

// gstackCacheDir returns the shared cache directory for the gstack clone.
func gstackCacheDir() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("cannot determine home directory: %w", err)
	}
	return filepath.Join(home, ".chatml", "cache", "gstack"), nil
}

// gstackMu serializes gstack clone/pull operations to avoid conflicts.
var gstackMu sync.Mutex

// ensureGstackClone clones or pulls the gstack repo to the cache directory.
// The provided context controls the timeout of git operations.
func ensureGstackClone(ctx context.Context) error {
	gstackMu.Lock()
	defer gstackMu.Unlock()

	ctx, cancel := context.WithTimeout(ctx, gstackGitTimeout)
	defer cancel()

	dir, err := gstackCacheDir()
	if err != nil {
		return err
	}
	if _, err := os.Stat(filepath.Join(dir, ".git")); err == nil {
		// Already cloned — pull latest (best-effort)
		cmd := exec.CommandContext(ctx, "git", "-C", dir, "pull", "--ff-only")
		cmd.Stdout = nil
		cmd.Stderr = nil
		if pullErr := cmd.Run(); pullErr != nil {
			logger.Manager.Debugf("gstack pull failed (non-fatal): %v", pullErr)
		}
		return nil
	}

	// Clone fresh (shallow). Use "--" to prevent argument injection if gstackRepoURL starts with "-".
	if err := os.MkdirAll(filepath.Dir(dir), 0755); err != nil {
		return fmt.Errorf("failed to create cache dir: %w", err)
	}
	cmd := exec.CommandContext(ctx, "git", "clone", "--depth", "1", "--", gstackRepoURL, dir)
	if out, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("git clone failed: %s: %w", string(out), err)
	}

	// If a pinned commit is set, check it out for supply chain safety.
	if gstackPinnedCommit != "" {
		checkout := exec.CommandContext(ctx, "git", "-C", dir, "fetch", "--depth", "1", "origin", gstackPinnedCommit)
		if out, err := checkout.CombinedOutput(); err != nil {
			return fmt.Errorf("git fetch pinned commit failed: %s: %w", string(out), err)
		}
		reset := exec.CommandContext(ctx, "git", "-C", dir, "checkout", gstackPinnedCommit)
		if out, err := reset.CombinedOutput(); err != nil {
			return fmt.Errorf("git checkout pinned commit failed: %s: %w", string(out), err)
		}
	}

	return nil
}

// copyGstackSkills copies gstack skill .md files into the workspace's .claude/commands/gstack/ directory.
// Uses a temp directory + atomic rename to avoid TOCTOU race conditions.
func copyGstackSkills(workspacePath string) error {
	srcDir, err := gstackCacheDir()
	if err != nil {
		return err
	}
	dstDir := filepath.Join(workspacePath, ".claude", "commands", "gstack")

	// Write to a temp directory first, then atomically rename to avoid TOCTOU races.
	tmpDir, err := os.MkdirTemp(filepath.Join(workspacePath, ".claude", "commands"), "gstack-tmp-*")
	if err != nil {
		return fmt.Errorf("failed to create temp dir: %w", err)
	}
	// Clean up temp dir on failure
	defer func() {
		if tmpDir != "" {
			_ = os.RemoveAll(tmpDir)
		}
	}()

	// Walk the gstack commands directory and copy .md files
	// gstack puts commands in its root-level commands/ or skills/ directory
	for _, subdir := range []string{"commands", "skills"} {
		skillsDir := filepath.Join(srcDir, subdir)
		if _, err := os.Stat(skillsDir); err != nil {
			continue
		}
		err := filepath.Walk(skillsDir, func(path string, info os.FileInfo, err error) error {
			if err != nil {
				return err
			}
			// Skip symlinks to prevent traversal attacks from a compromised upstream repo.
			// filepath.Walk resolves symlinks, so we must use os.Lstat to detect them.
			linfo, lstatErr := os.Lstat(path)
			if lstatErr != nil || linfo.Mode()&os.ModeSymlink != 0 {
				return nil
			}
			if info.IsDir() || !strings.HasSuffix(info.Name(), ".md") {
				return nil
			}
			// Preserve relative path structure to avoid name collisions across subdirs
			relPath, relErr := filepath.Rel(skillsDir, path)
			if relErr != nil {
				relPath = info.Name()
			}
			dstFile := filepath.Join(tmpDir, relPath)
			if mkErr := os.MkdirAll(filepath.Dir(dstFile), 0755); mkErr != nil {
				return mkErr
			}
			data, readErr := os.ReadFile(path)
			if readErr != nil {
				return readErr
			}
			return os.WriteFile(dstFile, data, 0644)
		})
		if err != nil {
			return fmt.Errorf("copy skills from %s: %w", subdir, err)
		}
	}

	// Atomic swap: remove old dir, rename temp dir into place
	_ = os.RemoveAll(dstDir)
	if err := os.Rename(tmpDir, dstDir); err != nil {
		return fmt.Errorf("failed to rename temp dir to target: %w", err)
	}
	tmpDir = "" // Prevent deferred cleanup since rename succeeded

	return nil
}

// gstackCommandsDir returns the path to the gstack commands directory within a workspace.
func gstackCommandsDir(workspacePath string) string {
	return filepath.Join(workspacePath, ".claude", "commands", "gstack")
}

type GstackStatusResponse struct {
	Enabled  bool   `json:"enabled"`
	Version  string `json:"version,omitempty"`
	LastSync string `json:"lastSync,omitempty"`
}

func (h *Handlers) GetGstackStatus(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	repoID := chi.URLParam(r, "id")

	repo, err := h.store.GetRepo(ctx, repoID)
	if err != nil {
		writeInternalError(w, "failed to get repo", err)
		return
	}
	if repo == nil {
		writeNotFound(w, "repo")
		return
	}

	dir := gstackCommandsDir(repo.Path)
	info, statErr := os.Stat(dir)
	if statErr != nil || !info.IsDir() {
		writeJSON(w, GstackStatusResponse{Enabled: false})
		return
	}

	resp := GstackStatusResponse{
		Enabled:  true,
		LastSync: info.ModTime().Format(time.RFC3339),
	}

	// Try to get version from the cached clone (with timeout to avoid hanging on corrupt repos)
	cacheDir, _ := gstackCacheDir() // best-effort: version is optional
	versionCtx, versionCancel := context.WithTimeout(ctx, 5*time.Second)
	defer versionCancel()
	versionCmd := exec.CommandContext(versionCtx, "git", "-C", cacheDir, "log", "-1", "--format=%h")
	if out, err := versionCmd.Output(); err == nil {
		resp.Version = strings.TrimSpace(string(out))
	}

	writeJSON(w, resp)
}

// syncGstackForRepo clones/pulls gstack and copies skills into the workspace.
// Shared by EnableGstack and SyncGstack.
func (h *Handlers) syncGstackForRepo(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	repoID := chi.URLParam(r, "id")

	repo, err := h.store.GetRepo(ctx, repoID)
	if err != nil {
		writeInternalError(w, "failed to get repo", err)
		return
	}
	if repo == nil {
		writeNotFound(w, "repo")
		return
	}

	if err := ensureGstackClone(ctx); err != nil {
		logger.Error.Errorf("Failed to sync gstack: %v", err)
		writeInternalError(w, "failed to sync gstack repository", err)
		return
	}

	if err := copyGstackSkills(repo.Path); err != nil {
		logger.Error.Errorf("Failed to copy gstack skills: %v", err)
		writeInternalError(w, "failed to copy gstack skills", err)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

func (h *Handlers) EnableGstack(w http.ResponseWriter, r *http.Request) {
	h.syncGstackForRepo(w, r)
}

func (h *Handlers) DisableGstack(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	repoID := chi.URLParam(r, "id")

	repo, err := h.store.GetRepo(ctx, repoID)
	if err != nil {
		writeInternalError(w, "failed to get repo", err)
		return
	}
	if repo == nil {
		writeNotFound(w, "repo")
		return
	}

	dir := gstackCommandsDir(repo.Path)
	if err := os.RemoveAll(dir); err != nil {
		logger.Error.Errorf("Failed to remove gstack commands: %v", err)
		writeInternalError(w, "failed to remove gstack commands", err)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

func (h *Handlers) SyncGstack(w http.ResponseWriter, r *http.Request) {
	h.syncGstackForRepo(w, r)
}
