package server

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/go-chi/chi/v5"
)

// FileNode represents a file or directory in the tree
type FileNode struct {
	Name     string      `json:"name"`
	Path     string      `json:"path"`
	IsDir    bool        `json:"isDir"`
	Children []*FileNode `json:"children,omitempty"`
}

// ListRepoFiles returns the file tree for a repository
func (h *Handlers) ListRepoFiles(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	id := chi.URLParam(r, "id")
	repo, err := h.store.GetRepo(ctx, id)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if repo == nil {
		writeNotFound(w, "repo")
		return
	}

	// Get depth parameter (default to 1 level, -1 for unlimited)
	depthStr := r.URL.Query().Get("depth")
	maxDepth := 1
	if depthStr == "all" {
		maxDepth = -1
	}

	// Check cache first
	cacheKey := fmt.Sprintf("repo:%s:depth:%d", repo.Path, maxDepth)
	if cached, ok := h.dirCache.Get(cacheKey); ok {
		writeJSON(w, cached)
		return
	}

	tree, err := buildFileTree(repo.Path, "", maxDepth, 0)
	if err != nil {
		writeInternalError(w, "failed to list files", err)
		return
	}

	// Cache the result
	h.dirCache.Set(cacheKey, tree)
	writeJSON(w, tree)
}

// buildFileTree recursively builds the file tree
func buildFileTree(basePath, relativePath string, maxDepth, currentDepth int) ([]*FileNode, error) {
	fullPath := filepath.Join(basePath, relativePath)
	entries, err := os.ReadDir(fullPath)
	if err != nil {
		return nil, err
	}

	var nodes []*FileNode

	// Separate directories and files
	var dirs, files []os.DirEntry
	for _, entry := range entries {
		name := entry.Name()

		// Skip known junk/cache files and OS-specific hidden files
		blocked := map[string]bool{
			".DS_Store": true, ".localized": true, ".Trash": true,
			".DocumentRevisions-V100": true, ".Spotlight-V100": true,
			".TemporaryItems": true, ".fseventsd": true, ".VolumeIcon.icns": true,
			".AppleDouble": true, ".LSOverride": true, "._*": true,
			"Thumbs.db": true, "desktop.ini": true, ".git": true,
		}
		if blocked[name] || strings.HasPrefix(name, "._") {
			continue
		}

		// Skip large build/dependency directories
		if name == "node_modules" || name == "vendor" ||
			name == "dist" || name == "build" || name == "__pycache__" ||
			name == "target" || name == ".next" || name == "out" {
			continue
		}

		if entry.IsDir() {
			dirs = append(dirs, entry)
		} else {
			files = append(files, entry)
		}
	}

	// Sort directories and files alphabetically (case-insensitive)
	sortEntries := func(entries []os.DirEntry) {
		sort.Slice(entries, func(i, j int) bool {
			return strings.ToLower(entries[i].Name()) < strings.ToLower(entries[j].Name())
		})
	}
	sortEntries(dirs)
	sortEntries(files)

	// Add directories first
	for _, entry := range dirs {
		name := entry.Name()
		nodePath := filepath.Join(relativePath, name)
		node := &FileNode{
			Name:  name,
			Path:  nodePath,
			IsDir: true,
		}

		// Recursively build children if within depth limit
		if maxDepth == -1 || currentDepth < maxDepth {
			children, err := buildFileTree(basePath, nodePath, maxDepth, currentDepth+1)
			if err == nil {
				node.Children = children
			}
		}

		nodes = append(nodes, node)
	}

	// Add files
	for _, entry := range files {
		name := entry.Name()
		nodePath := filepath.Join(relativePath, name)
		nodes = append(nodes, &FileNode{
			Name:  name,
			Path:  nodePath,
			IsDir: false,
		})
	}

	return nodes, nil
}

// FileContentResponse represents a file's content and metadata
type FileContentResponse struct {
	Path    string `json:"path"`
	Name    string `json:"name"`
	Content string `json:"content"`
	Size    int64  `json:"size"`
}

// FileDiffResponse represents a diff between two versions of a file
type FileDiffResponse struct {
	Path        string `json:"path"`
	OldContent  string `json:"oldContent"`
	NewContent  string `json:"newContent"`
	OldFilename string `json:"oldFilename"`
	NewFilename string `json:"newFilename"`
	HasConflict bool   `json:"hasConflict"`
	IsDeleted   bool   `json:"isDeleted"`
}

// GetFileDiff returns the diff between the base branch and current state for a file
func (h *Handlers) GetFileDiff(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	id := chi.URLParam(r, "id")
	repo, err := h.store.GetRepo(ctx, id)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if repo == nil {
		writeNotFound(w, "repo")
		return
	}

	filePath := r.URL.Query().Get("path")
	if filePath == "" {
		writeValidationError(w, "path parameter is required")
		return
	}

	// Get the base branch (usually main or master)
	baseBranch := r.URL.Query().Get("base")
	if baseBranch == "" {
		baseBranch = repo.Branch // default branch
	}

	// Validate and clean the path
	cleanPath, err := validatePath(repo.Path, filePath)
	if err != nil {
		writeValidationError(w, "invalid path")
		return
	}

	fullPath := filepath.Join(repo.Path, cleanPath)

	// Read current file content
	var isDeleted bool
	newContent, err := os.ReadFile(fullPath)
	if err != nil {
		if os.IsNotExist(err) {
			isDeleted = true
		} else {
			writeInternalError(w, "failed to read file", err)
			return
		}
	}

	// Get base branch version using git show
	oldContent, err := h.repoManager.GetFileAtRef(ctx, repo.Path, baseBranch, cleanPath)
	if err != nil {
		// File might not exist in base branch (new file)
		oldContent = ""
	}

	// Check for conflict markers
	hasConflict := strings.Contains(string(newContent), "<<<<<<<") &&
		strings.Contains(string(newContent), "=======") &&
		strings.Contains(string(newContent), ">>>>>>>")

	response := FileDiffResponse{
		Path:        cleanPath,
		OldContent:  oldContent,
		NewContent:  string(newContent),
		OldFilename: cleanPath + " (base)",
		NewFilename: cleanPath,
		HasConflict: hasConflict,
		IsDeleted:   isDeleted,
	}

	writeJSON(w, response)
}

// GetRepoFileContent returns the content of a specific file in the repository
func (h *Handlers) GetRepoFileContent(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	id := chi.URLParam(r, "id")
	repo, err := h.store.GetRepo(ctx, id)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if repo == nil {
		writeNotFound(w, "repo")
		return
	}

	// Get file path from query parameter
	filePath := r.URL.Query().Get("path")
	if filePath == "" {
		writeValidationError(w, "path parameter is required")
		return
	}

	// Validate and clean the path to prevent directory traversal attacks
	cleanPath, err := validatePath(repo.Path, filePath)
	if err != nil {
		writeValidationError(w, "invalid path")
		return
	}

	fullPath := filepath.Join(repo.Path, cleanPath)

	// Check if file exists and is not a directory
	info, err := os.Stat(fullPath)
	if err != nil {
		if os.IsNotExist(err) {
			writeNotFound(w, "file")
		} else {
			writeInternalError(w, "failed to access file", err)
		}
		return
	}
	if info.IsDir() {
		writeValidationError(w, "path is a directory")
		return
	}

	// Read file content
	content, err := os.ReadFile(fullPath)
	if err != nil {
		writeInternalError(w, "failed to read file", err)
		return
	}

	// Return as JSON with metadata
	writeJSON(w, FileContentResponse{
		Path:    cleanPath,
		Name:    filepath.Base(cleanPath),
		Content: string(content),
		Size:    info.Size(),
	})
}

// GetSessionFileContent returns file content from a session's worktree
// This provides complete session isolation - files are read from the worktree, not the main repo
func (h *Handlers) GetSessionFileContent(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	sessionID := chi.URLParam(r, "sessionId")
	session, err := h.store.GetSession(ctx, sessionID)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if session == nil {
		writeNotFound(w, "session")
		return
	}
	if checkWorktreePath(w, session.WorktreePath) {
		return
	}

	// Get file path from query parameter
	filePath := r.URL.Query().Get("path")
	if filePath == "" {
		writeValidationError(w, "path parameter is required")
		return
	}

	// Validate and clean the path to prevent directory traversal attacks
	cleanPath, err := validatePath(session.WorktreePath, filePath)
	if err != nil {
		writeValidationError(w, "invalid path")
		return
	}

	fullPath := filepath.Join(session.WorktreePath, cleanPath)

	// Check if file exists and is not a directory
	info, err := os.Stat(fullPath)
	if err != nil {
		if os.IsNotExist(err) {
			writeNotFound(w, "file")
		} else {
			writeInternalError(w, "failed to access file", err)
		}
		return
	}
	if info.IsDir() {
		writeValidationError(w, "path is a directory")
		return
	}

	// Read file content
	content, err := os.ReadFile(fullPath)
	if err != nil {
		writeInternalError(w, "failed to read file", err)
		return
	}

	// Return as JSON with metadata
	writeJSON(w, FileContentResponse{
		Path:    cleanPath,
		Name:    filepath.Base(cleanPath),
		Content: string(content),
		Size:    info.Size(),
	})
}

// ListSessionFiles returns the file tree for a session's worktree
// This ensures the file tree shows files from the worktree, not the main repo
func (h *Handlers) ListSessionFiles(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	sessionID := chi.URLParam(r, "sessionId")
	session, err := h.store.GetSession(ctx, sessionID)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if session == nil {
		writeNotFound(w, "session")
		return
	}
	if checkWorktreePath(w, session.WorktreePath) {
		return
	}

	// Parse max depth from query params
	maxDepth := 10
	if depthParam := r.URL.Query().Get("maxDepth"); depthParam != "" {
		var parsedDepth int
		if _, err := fmt.Sscanf(depthParam, "%d", &parsedDepth); err == nil && parsedDepth > 0 {
			maxDepth = parsedDepth
		}
	}

	// Check cache first
	cacheKey := fmt.Sprintf("session:%s:depth:%d", session.WorktreePath, maxDepth)
	if cached, ok := h.dirCache.Get(cacheKey); ok {
		writeJSON(w, cached)
		return
	}

	// Build file tree from worktree path
	tree, err := buildFileTree(session.WorktreePath, "", maxDepth, 0)
	if err != nil {
		writeInternalError(w, "failed to list files", err)
		return
	}

	// Cache the result
	h.dirCache.Set(cacheKey, tree)
	writeJSON(w, tree)
}

// SaveFileRequest represents a request to save file content
type SaveFileRequest struct {
	Path    string `json:"path"`
	Content string `json:"content"`
}

// SaveFile saves content to a specific file in the repository or session worktree.
// Design decision: Only allows saving to existing files, not creating new ones.
// This is intentional to prevent accidental file creation through the save API.
// File creation should be done through agent actions or explicit "create file" endpoints.
func (h *Handlers) SaveFile(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	workspaceID := chi.URLParam(r, "id")
	repo, err := h.store.GetRepo(ctx, workspaceID)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if repo == nil {
		writeNotFound(w, "workspace")
		return
	}

	var req SaveFileRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeValidationError(w, "invalid request body")
		return
	}

	// Check file size limit
	maxSize := h.fileSizeConfig.MaxFileSizeBytes
	if int64(len(req.Content)) > maxSize {
		writePayloadTooLarge(w, fmt.Sprintf("file content exceeds maximum size of %d MB", maxSize/(1024*1024)))
		return
	}

	if req.Path == "" {
		writeValidationError(w, "path is required")
		return
	}

	// Determine the base path - check if this is a session-scoped save
	basePath := repo.Path
	sessionID := r.URL.Query().Get("sessionId")
	if sessionID != "" {
		session, err := h.store.GetSession(ctx, sessionID)
		if err != nil {
			writeDBError(w, err)
			return
		}
		if session == nil {
			writeNotFound(w, "session")
			return
		}
		if session.WorktreePath != "" {
			if checkWorktreePath(w, session.WorktreePath) {
				return
			}
			basePath = session.WorktreePath
		}
	}

	// Validate and clean the path to prevent directory traversal attacks
	cleanPath, err := validatePath(basePath, req.Path)
	if err != nil {
		writeValidationError(w, "invalid path")
		return
	}

	fullPath := filepath.Join(basePath, cleanPath)

	// Check if file exists (we only allow saving existing files, not creating new ones)
	info, err := os.Stat(fullPath)
	if err != nil {
		if os.IsNotExist(err) {
			writeNotFound(w, "file")
		} else {
			writeInternalError(w, "failed to access file", err)
		}
		return
	}
	if info.IsDir() {
		writeValidationError(w, "path is a directory")
		return
	}

	// Preserve file permissions
	mode := info.Mode()

	// Write file content
	if err := os.WriteFile(fullPath, []byte(req.Content), mode); err != nil {
		writeInternalError(w, "failed to save file", err)
		return
	}

	// Invalidate directory listing cache for this path
	h.dirCache.InvalidatePath(basePath)

	writeJSON(w, map[string]bool{"success": true})
}

