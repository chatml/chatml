package server

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/chatml/chatml-backend/agent"
	"github.com/go-chi/chi/v5"
)

// MemoryFileInfo represents a memory file's metadata (for listing).
type MemoryFileInfo struct {
	Name string `json:"name"`
	Size int64  `json:"size"`
}

// MemoryFile represents a memory file with its content.
type MemoryFile struct {
	Name    string `json:"name"`
	Content string `json:"content"`
	Size    int64  `json:"size"`
}

// SaveMemoryFileRequest is the request body for creating/updating a memory file.
type SaveMemoryFileRequest struct {
	Name    string `json:"name"`
	Content string `json:"content"`
}

// maxMemoryFileSize is the maximum allowed size for memory files (1MB).
var maxMemoryFileSize int64 = 1 * 1024 * 1024

// ListMemoryFiles returns all .md files in the workspace's Claude memory directory.
func (h *Handlers) ListMemoryFiles(w http.ResponseWriter, r *http.Request) {
	memDir, err := h.resolveMemoryDir(w, r)
	if err != nil {
		return // error already written
	}

	entries, err := os.ReadDir(memDir)
	if err != nil {
		if os.IsNotExist(err) {
			writeJSON(w, []MemoryFileInfo{})
			return
		}
		writeInternalError(w, "failed to read memory directory", err)
		return
	}

	files := []MemoryFileInfo{}
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".md") {
			continue
		}
		if entry.Type()&os.ModeSymlink != 0 {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			continue
		}
		files = append(files, MemoryFileInfo{
			Name: entry.Name(),
			Size: info.Size(),
		})
	}

	writeJSON(w, files)
}

// GetMemoryFile returns the content of a specific memory file.
func (h *Handlers) GetMemoryFile(w http.ResponseWriter, r *http.Request) {
	memDir, err := h.resolveMemoryDir(w, r)
	if err != nil {
		return
	}

	name := r.URL.Query().Get("name")
	if !isValidMemoryFileName(name) {
		writeValidationError(w, "invalid file name: must be a .md file without path separators")
		return
	}

	fullPath := filepath.Join(memDir, name)

	info, err := os.Stat(fullPath)
	if err != nil {
		if os.IsNotExist(err) {
			writeNotFound(w, "memory file")
			return
		}
		writeInternalError(w, "failed to stat memory file", err)
		return
	}

	if info.Size() > maxMemoryFileSize {
		writeValidationError(w, "file exceeds maximum size limit")
		return
	}

	content, err := os.ReadFile(fullPath)
	if err != nil {
		writeInternalError(w, "failed to read memory file", err)
		return
	}

	writeJSON(w, MemoryFile{
		Name:    name,
		Content: string(content),
		Size:    info.Size(),
	})
}

// SaveMemoryFile creates or updates a memory file.
func (h *Handlers) SaveMemoryFile(w http.ResponseWriter, r *http.Request) {
	memDir, err := h.resolveMemoryDir(w, r)
	if err != nil {
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, maxMemoryFileSize+4096)

	var req SaveMemoryFileRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeValidationError(w, "invalid request body")
		return
	}

	if !isValidMemoryFileName(req.Name) {
		writeValidationError(w, "invalid file name: must be a .md file without path separators")
		return
	}

	if int64(len(req.Content)) > maxMemoryFileSize {
		writeValidationError(w, "content exceeds maximum size limit")
		return
	}

	// Create the memory directory if it doesn't exist
	if err := os.MkdirAll(memDir, 0755); err != nil {
		writeInternalError(w, "failed to create memory directory", err)
		return
	}

	fullPath := filepath.Join(memDir, req.Name)

	if err := os.WriteFile(fullPath, []byte(req.Content), 0644); err != nil {
		writeInternalError(w, "failed to write memory file", err)
		return
	}

	writeJSON(w, map[string]bool{"success": true})
}

// DeleteMemoryFile deletes a memory file.
func (h *Handlers) DeleteMemoryFile(w http.ResponseWriter, r *http.Request) {
	memDir, err := h.resolveMemoryDir(w, r)
	if err != nil {
		return
	}

	name := r.URL.Query().Get("name")
	if !isValidMemoryFileName(name) {
		writeValidationError(w, "invalid file name: must be a .md file without path separators")
		return
	}

	fullPath := filepath.Join(memDir, name)

	if _, err := os.Stat(fullPath); err != nil {
		if os.IsNotExist(err) {
			writeNotFound(w, "memory file")
			return
		}
		writeInternalError(w, "failed to stat memory file", err)
		return
	}

	if err := os.Remove(fullPath); err != nil {
		writeInternalError(w, "failed to delete memory file", err)
		return
	}

	writeJSON(w, map[string]bool{"success": true})
}

// resolveMemoryDir looks up the repo from the route and returns the Claude memory directory path.
// On error it writes the HTTP response and returns an error.
func (h *Handlers) resolveMemoryDir(w http.ResponseWriter, r *http.Request) (string, error) {
	ctx := r.Context()
	repoID := chi.URLParam(r, "id")

	repo, err := h.store.GetRepo(ctx, repoID)
	if err != nil {
		writeDBError(w, err)
		return "", err
	}
	if repo == nil {
		writeNotFound(w, "workspace")
		return "", os.ErrNotExist
	}

	memDir, err := agent.ClaudeMemoryDir(repo.Path)
	if err != nil {
		writeInternalError(w, "failed to resolve memory directory", err)
		return "", err
	}

	return memDir, nil
}

// isValidMemoryFileName validates that a file name is safe:
// - must end in .md
// - must not contain path separators or ".."
// - must not be empty
func isValidMemoryFileName(name string) bool {
	if name == "" {
		return false
	}
	if !strings.HasSuffix(name, ".md") {
		return false
	}
	if strings.Contains(name, "/") || strings.Contains(name, "\\") || strings.Contains(name, "..") {
		return false
	}
	// Ensure the name is just a filename, not a path
	if filepath.Base(name) != name {
		return false
	}
	return true
}
