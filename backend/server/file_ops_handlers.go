package server

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/go-chi/chi/v5"
)

// --- Request types ---

type CreateFileRequest struct {
	Path    string `json:"path"`
	Content string `json:"content"`
}

type CreateFolderRequest struct {
	Path string `json:"path"`
}

type RenameFileRequest struct {
	OldPath string `json:"oldPath"`
	NewPath string `json:"newPath"`
}

type DeleteFileRequest struct {
	Path      string `json:"path"`
	Recursive bool   `json:"recursive"`
}

type DuplicateFileRequest struct {
	SourcePath string `json:"sourcePath"`
	DestPath   string `json:"destPath"`
}

type MoveFileRequest struct {
	SourcePath string `json:"sourcePath"`
	DestPath   string `json:"destPath"`
}

type DiscardChangesRequest struct {
	Path string `json:"path"`
}

// --- Helpers ---

// resolveSessionWorktree extracts the session from the URL and returns the worktree path.
// Writes an error response and returns "" if the session is invalid or worktree is missing.
func (h *Handlers) resolveSessionWorktree(w http.ResponseWriter, r *http.Request) string {
	ctx := r.Context()
	sessionID := chi.URLParam(r, "sessionId")
	session, err := h.store.GetSession(ctx, sessionID)
	if err != nil {
		writeDBError(w, err)
		return ""
	}
	if session == nil {
		writeNotFound(w, "session")
		return ""
	}
	if session.WorktreePath == "" {
		writeValidationError(w, "session has no worktree")
		return ""
	}
	if checkWorktreePath(w, session.WorktreePath) {
		return ""
	}
	return session.WorktreePath
}

// --- Handlers ---

// CreateFile creates a new file in the session's worktree.
// Also creates any necessary parent directories.
func (h *Handlers) CreateFile(w http.ResponseWriter, r *http.Request) {
	worktreePath := h.resolveSessionWorktree(w, r)
	if worktreePath == "" {
		return
	}

	var req CreateFileRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeValidationError(w, "invalid request body")
		return
	}
	if req.Path == "" {
		writeValidationError(w, "path is required")
		return
	}

	cleanPath, err := validatePath(worktreePath, req.Path)
	if err != nil {
		writeValidationError(w, "invalid path")
		return
	}

	fullPath := filepath.Join(worktreePath, cleanPath)

	// Check if file already exists
	if _, err := os.Stat(fullPath); err == nil {
		writeValidationError(w, "file already exists")
		return
	}

	// Create parent directories
	parentDir := filepath.Dir(fullPath)
	if err := os.MkdirAll(parentDir, 0755); err != nil {
		writeInternalError(w, "failed to create parent directories", err)
		return
	}

	// Write file
	if err := os.WriteFile(fullPath, []byte(req.Content), 0644); err != nil {
		writeInternalError(w, "failed to create file", err)
		return
	}

	h.dirCache.InvalidatePath(worktreePath)
	writeJSON(w, map[string]interface{}{"success": true, "path": cleanPath})
}

// CreateFolder creates a new directory in the session's worktree.
func (h *Handlers) CreateFolder(w http.ResponseWriter, r *http.Request) {
	worktreePath := h.resolveSessionWorktree(w, r)
	if worktreePath == "" {
		return
	}

	var req CreateFolderRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeValidationError(w, "invalid request body")
		return
	}
	if req.Path == "" {
		writeValidationError(w, "path is required")
		return
	}

	cleanPath, err := validatePath(worktreePath, req.Path)
	if err != nil {
		writeValidationError(w, "invalid path")
		return
	}

	fullPath := filepath.Join(worktreePath, cleanPath)

	// Check if already exists
	if _, err := os.Stat(fullPath); err == nil {
		writeValidationError(w, "folder already exists")
		return
	}

	if err := os.MkdirAll(fullPath, 0755); err != nil {
		writeInternalError(w, "failed to create folder", err)
		return
	}

	h.dirCache.InvalidatePath(worktreePath)
	writeJSON(w, map[string]interface{}{"success": true, "path": cleanPath})
}

// RenameFile renames a file or folder in the session's worktree.
func (h *Handlers) RenameFile(w http.ResponseWriter, r *http.Request) {
	worktreePath := h.resolveSessionWorktree(w, r)
	if worktreePath == "" {
		return
	}

	var req RenameFileRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeValidationError(w, "invalid request body")
		return
	}
	if req.OldPath == "" || req.NewPath == "" {
		writeValidationError(w, "oldPath and newPath are required")
		return
	}

	oldClean, err := validatePath(worktreePath, req.OldPath)
	if err != nil {
		writeValidationError(w, "invalid old path")
		return
	}
	newClean, err := validatePath(worktreePath, req.NewPath)
	if err != nil {
		writeValidationError(w, "invalid new path")
		return
	}

	oldFull := filepath.Join(worktreePath, oldClean)
	newFull := filepath.Join(worktreePath, newClean)

	// Check source exists
	if _, err := os.Stat(oldFull); os.IsNotExist(err) {
		writeNotFound(w, "file")
		return
	}

	// Check dest doesn't exist
	if _, err := os.Stat(newFull); err == nil {
		writeValidationError(w, "destination already exists")
		return
	}

	// Create parent dirs for destination
	if err := os.MkdirAll(filepath.Dir(newFull), 0755); err != nil {
		writeInternalError(w, "failed to create parent directories", err)
		return
	}

	if err := os.Rename(oldFull, newFull); err != nil {
		writeInternalError(w, "failed to rename", err)
		return
	}

	h.dirCache.InvalidatePath(worktreePath)
	writeJSON(w, map[string]interface{}{"success": true, "oldPath": oldClean, "newPath": newClean})
}

// DeleteFile deletes a file or folder from the session's worktree.
func (h *Handlers) DeleteFile(w http.ResponseWriter, r *http.Request) {
	worktreePath := h.resolveSessionWorktree(w, r)
	if worktreePath == "" {
		return
	}

	var req DeleteFileRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeValidationError(w, "invalid request body")
		return
	}
	if req.Path == "" {
		writeValidationError(w, "path is required")
		return
	}

	cleanPath, err := validatePath(worktreePath, req.Path)
	if err != nil {
		writeValidationError(w, "invalid path")
		return
	}

	fullPath := filepath.Join(worktreePath, cleanPath)

	info, err := os.Stat(fullPath)
	if os.IsNotExist(err) {
		writeNotFound(w, "file")
		return
	}
	if err != nil {
		writeInternalError(w, "failed to access file", err)
		return
	}

	if info.IsDir() {
		if !req.Recursive {
			writeValidationError(w, "cannot delete directory without recursive flag")
			return
		}
		if err := os.RemoveAll(fullPath); err != nil {
			writeInternalError(w, "failed to delete directory", err)
			return
		}
	} else {
		if err := os.Remove(fullPath); err != nil {
			writeInternalError(w, "failed to delete file", err)
			return
		}
	}

	h.dirCache.InvalidatePath(worktreePath)
	writeJSON(w, map[string]interface{}{"success": true})
}

// DuplicateFile copies a file in the session's worktree.
func (h *Handlers) DuplicateFile(w http.ResponseWriter, r *http.Request) {
	worktreePath := h.resolveSessionWorktree(w, r)
	if worktreePath == "" {
		return
	}

	var req DuplicateFileRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeValidationError(w, "invalid request body")
		return
	}
	if req.SourcePath == "" {
		writeValidationError(w, "sourcePath is required")
		return
	}

	srcClean, err := validatePath(worktreePath, req.SourcePath)
	if err != nil {
		writeValidationError(w, "invalid source path")
		return
	}

	srcFull := filepath.Join(worktreePath, srcClean)

	srcInfo, err := os.Stat(srcFull)
	if os.IsNotExist(err) {
		writeNotFound(w, "source file")
		return
	}
	if err != nil {
		writeInternalError(w, "failed to access source", err)
		return
	}
	if srcInfo.IsDir() {
		writeValidationError(w, "cannot duplicate directories")
		return
	}

	// Determine destination path
	destPath := req.DestPath
	if destPath == "" {
		// Auto-generate: file.txt → file-copy.txt, file → file-copy
		ext := filepath.Ext(srcClean)
		base := strings.TrimSuffix(srcClean, ext)
		destPath = base + "-copy" + ext

		// If that exists, add a number (cap at 999 to prevent unbounded loop)
		for i := 2; i < 1000; i++ {
			destClean, _ := validatePath(worktreePath, destPath)
			if destClean == "" {
				break
			}
			full := filepath.Join(worktreePath, destClean)
			if _, err := os.Stat(full); os.IsNotExist(err) {
				break
			}
			destPath = fmt.Sprintf("%s-copy-%d%s", base, i, ext)
			if i == 999 {
				writeValidationError(w, "too many copies, please specify a destination path")
				return
			}
		}
	}

	destClean, err := validatePath(worktreePath, destPath)
	if err != nil {
		writeValidationError(w, "invalid destination path")
		return
	}

	destFull := filepath.Join(worktreePath, destClean)

	// Check dest doesn't exist
	if _, err := os.Stat(destFull); err == nil {
		writeValidationError(w, "destination already exists")
		return
	}

	// Create parent dirs
	if err := os.MkdirAll(filepath.Dir(destFull), 0755); err != nil {
		writeInternalError(w, "failed to create parent directories", err)
		return
	}

	// Copy file content
	src, err := os.Open(srcFull)
	if err != nil {
		writeInternalError(w, "failed to open source file", err)
		return
	}
	defer src.Close()

	dst, err := os.OpenFile(destFull, os.O_WRONLY|os.O_CREATE|os.O_EXCL, srcInfo.Mode())
	if err != nil {
		writeInternalError(w, "failed to create destination file", err)
		return
	}
	defer dst.Close()

	if _, err := io.Copy(dst, src); err != nil {
		dst.Close() // close before removal
		os.Remove(destFull) // clean up partial file
		writeInternalError(w, "failed to copy file", err)
		return
	}

	h.dirCache.InvalidatePath(worktreePath)
	writeJSON(w, map[string]interface{}{"success": true, "newPath": destClean})
}

// MoveFile moves a file or folder within the session's worktree.
func (h *Handlers) MoveFile(w http.ResponseWriter, r *http.Request) {
	worktreePath := h.resolveSessionWorktree(w, r)
	if worktreePath == "" {
		return
	}

	var req MoveFileRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeValidationError(w, "invalid request body")
		return
	}
	if req.SourcePath == "" || req.DestPath == "" {
		writeValidationError(w, "sourcePath and destPath are required")
		return
	}

	srcClean, err := validatePath(worktreePath, req.SourcePath)
	if err != nil {
		writeValidationError(w, "invalid source path")
		return
	}
	destClean, err := validatePath(worktreePath, req.DestPath)
	if err != nil {
		writeValidationError(w, "invalid destination path")
		return
	}

	srcFull := filepath.Join(worktreePath, srcClean)
	destFull := filepath.Join(worktreePath, destClean)

	// Check source exists
	if _, err := os.Stat(srcFull); os.IsNotExist(err) {
		writeNotFound(w, "source")
		return
	}

	// Check dest doesn't exist
	if _, err := os.Stat(destFull); err == nil {
		writeValidationError(w, "destination already exists")
		return
	}

	// Prevent moving a directory into itself
	if strings.HasPrefix(destClean+"/", srcClean+"/") {
		writeValidationError(w, "cannot move directory into itself")
		return
	}

	// Create parent dirs for destination
	if err := os.MkdirAll(filepath.Dir(destFull), 0755); err != nil {
		writeInternalError(w, "failed to create parent directories", err)
		return
	}

	if err := os.Rename(srcFull, destFull); err != nil {
		writeInternalError(w, "failed to move", err)
		return
	}

	h.dirCache.InvalidatePath(worktreePath)
	writeJSON(w, map[string]interface{}{"success": true, "oldPath": srcClean, "newPath": destClean})
}

// DiscardChanges discards changes for a file or folder in the session's worktree.
// For files: tries `git checkout -- <path>`, falls back to removing untracked files.
// For folders: runs `git checkout -- <path>` to restore tracked files, then
// `git clean -fd <path>` to remove untracked files.
func (h *Handlers) DiscardChanges(w http.ResponseWriter, r *http.Request) {
	worktreePath := h.resolveSessionWorktree(w, r)
	if worktreePath == "" {
		return
	}

	var req DiscardChangesRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeValidationError(w, "invalid request body")
		return
	}
	if req.Path == "" {
		writeValidationError(w, "path is required")
		return
	}

	cleanPath, err := validatePath(worktreePath, req.Path)
	if err != nil {
		writeValidationError(w, "invalid path")
		return
	}

	ctx := r.Context()
	fullPath := filepath.Join(worktreePath, cleanPath)

	info, statErr := os.Stat(fullPath)
	if statErr != nil && os.IsNotExist(statErr) {
		// Path doesn't exist on disk — may be a deleted tracked file, try checkout
		cmd := exec.CommandContext(ctx, "git", "checkout", "--", cleanPath)
		cmd.Dir = worktreePath
		if output, err := cmd.CombinedOutput(); err != nil {
			writeInternalError(w, fmt.Sprintf("git checkout failed: %s", strings.TrimSpace(string(output))), err)
			return
		}
		h.dirCache.InvalidatePath(worktreePath)
		writeJSON(w, map[string]interface{}{"success": true})
		return
	}
	if statErr != nil {
		writeInternalError(w, "failed to access path", statErr)
		return
	}

	if info.IsDir() {
		// For directories: restore tracked changes, then clean untracked files.
		// git checkout may fail if there are no tracked changes — that's OK.
		checkoutCmd := exec.CommandContext(ctx, "git", "checkout", "--", cleanPath)
		checkoutCmd.Dir = worktreePath
		_ = checkoutCmd.Run() // ignore error — may have no tracked changes

		// Remove untracked files in the directory
		cleanCmd := exec.CommandContext(ctx, "git", "clean", "-fd", cleanPath)
		cleanCmd.Dir = worktreePath
		if output, err := cleanCmd.CombinedOutput(); err != nil {
			writeInternalError(w, fmt.Sprintf("git clean failed: %s", strings.TrimSpace(string(output))), err)
			return
		}
	} else {
		// For files: try git checkout first (tracked files)
		cmd := exec.CommandContext(ctx, "git", "checkout", "--", cleanPath)
		cmd.Dir = worktreePath
		if _, err := cmd.CombinedOutput(); err != nil {
			// If git checkout fails, the file is untracked — remove it
			if err := os.Remove(fullPath); err != nil {
				writeInternalError(w, "failed to remove untracked file", err)
				return
			}
		}
	}

	h.dirCache.InvalidatePath(worktreePath)
	writeJSON(w, map[string]interface{}{"success": true})
}
