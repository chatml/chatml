package server

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestGetSessionFileContent_Success(t *testing.T) {
	h, s := setupTestHandlers(t)

	createTestRepo(t, s, "ws-1", "/path/to/repo")
	_, worktreePath := createTestSessionWithWorktree(t, s, "sess-1", "ws-1")

	// Create a test file in the worktree
	writeFile(t, worktreePath, "test.txt", "Hello, World!")

	req := httptest.NewRequest("GET", "/api/sessions/sess-1/file?path=test.txt", nil)
	req = withChiContext(req, map[string]string{"sessionId": "sess-1"})
	w := httptest.NewRecorder()

	h.GetSessionFileContent(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var response FileContentResponse
	err := json.Unmarshal(w.Body.Bytes(), &response)
	require.NoError(t, err)
	assert.Equal(t, "test.txt", response.Path)
	assert.Equal(t, "test.txt", response.Name)
	assert.Equal(t, "Hello, World!", response.Content)
	assert.Equal(t, int64(13), response.Size)
}

func TestGetSessionFileContent_SessionNotFound(t *testing.T) {
	h, _ := setupTestHandlers(t)

	req := httptest.NewRequest("GET", "/api/sessions/nonexistent/file?path=test.txt", nil)
	req = withChiContext(req, map[string]string{"sessionId": "nonexistent"})
	w := httptest.NewRecorder()

	h.GetSessionFileContent(w, req)

	assert.Equal(t, http.StatusNotFound, w.Code)
	assert.Contains(t, w.Body.String(), "session not found")
}

func TestGetSessionFileContent_FileNotFound(t *testing.T) {
	h, s := setupTestHandlers(t)

	createTestRepo(t, s, "ws-1", "/path/to/repo")
	createTestSessionWithWorktree(t, s, "sess-1", "ws-1")

	req := httptest.NewRequest("GET", "/api/sessions/sess-1/file?path=nonexistent.txt", nil)
	req = withChiContext(req, map[string]string{"sessionId": "sess-1"})
	w := httptest.NewRecorder()

	h.GetSessionFileContent(w, req)

	assert.Equal(t, http.StatusNotFound, w.Code)
	assert.Contains(t, w.Body.String(), "file not found")
}

func TestGetSessionFileContent_MissingPathParam(t *testing.T) {
	h, s := setupTestHandlers(t)

	createTestRepo(t, s, "ws-1", "/path/to/repo")
	createTestSessionWithWorktree(t, s, "sess-1", "ws-1")

	req := httptest.NewRequest("GET", "/api/sessions/sess-1/file", nil)
	req = withChiContext(req, map[string]string{"sessionId": "sess-1"})
	w := httptest.NewRecorder()

	h.GetSessionFileContent(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
	assert.Contains(t, w.Body.String(), "path parameter is required")
}

func TestGetSessionFileContent_DirectoryRejected(t *testing.T) {
	h, s := setupTestHandlers(t)

	createTestRepo(t, s, "ws-1", "/path/to/repo")
	_, worktreePath := createTestSessionWithWorktree(t, s, "sess-1", "ws-1")

	// Create a directory
	require.NoError(t, os.Mkdir(filepath.Join(worktreePath, "subdir"), 0755))

	req := httptest.NewRequest("GET", "/api/sessions/sess-1/file?path=subdir", nil)
	req = withChiContext(req, map[string]string{"sessionId": "sess-1"})
	w := httptest.NewRecorder()

	h.GetSessionFileContent(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
	assert.Contains(t, w.Body.String(), "path is a directory")
}

func TestGetSessionFileContent_PathTraversalPrevented(t *testing.T) {
	h, s := setupTestHandlers(t)

	createTestRepo(t, s, "ws-1", "/path/to/repo")
	createTestSessionWithWorktree(t, s, "sess-1", "ws-1")

	req := httptest.NewRequest("GET", "/api/sessions/sess-1/file?path=../../../etc/passwd", nil)
	req = withChiContext(req, map[string]string{"sessionId": "sess-1"})
	w := httptest.NewRecorder()

	h.GetSessionFileContent(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
	assert.Contains(t, w.Body.String(), "invalid path")
}

func TestValidatePath(t *testing.T) {
	basePath := "/home/user/workspace"

	tests := []struct {
		name        string
		path        string
		wantErr     bool
		errContains string
		wantPath    string
	}{
		// Valid paths
		{
			name:     "simple relative path",
			path:     "foo/bar.txt",
			wantErr:  false,
			wantPath: "foo/bar.txt",
		},
		{
			name:     "deeply nested path",
			path:     "src/components/ui/Button.tsx",
			wantErr:  false,
			wantPath: "src/components/ui/Button.tsx",
		},
		{
			name:     "current directory",
			path:     ".",
			wantErr:  false,
			wantPath: ".",
		},
		{
			name:     "explicit current directory prefix",
			path:     "./foo/bar",
			wantErr:  false,
			wantPath: "foo/bar",
		},
		{
			name:     "path with dots in filename",
			path:     "file.test.js",
			wantErr:  false,
			wantPath: "file.test.js",
		},
		{
			name:     "normalized path stays within base",
			path:     "foo/bar/../baz",
			wantErr:  false,
			wantPath: "foo/baz",
		},

		// Directory traversal attacks
		{
			name:        "parent directory escape",
			path:        "../secret",
			wantErr:     true,
			errContains: "path escapes base directory",
		},
		{
			name:        "multi-level traversal",
			path:        "../../etc/passwd",
			wantErr:     true,
			errContains: "path escapes base directory",
		},
		{
			name:        "embedded traversal that escapes",
			path:        "foo/../../../etc/passwd",
			wantErr:     true,
			errContains: "path escapes base directory",
		},
		{
			name:        "deep traversal attack",
			path:        "a/b/c/../../../../etc/passwd",
			wantErr:     true,
			errContains: "path escapes base directory",
		},

		// Absolute path rejection
		{
			name:        "absolute unix path",
			path:        "/etc/passwd",
			wantErr:     true,
			errContains: "absolute paths not allowed",
		},
		{
			name:        "absolute path to sensitive file",
			path:        "/root/.ssh/id_rsa",
			wantErr:     true,
			errContains: "absolute paths not allowed",
		},

		// Edge cases
		{
			name:     "empty path",
			path:     "",
			wantErr:  false,
			wantPath: ".",
		},
		{
			name:     "whitespace only path",
			path:     "   ",
			wantErr:  false,
			wantPath: "   ",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result, err := validatePath(basePath, tt.path)

			if tt.wantErr {
				require.Error(t, err)
				assert.Empty(t, result, "result should be empty on error")
				if tt.errContains != "" {
					assert.Contains(t, err.Error(), tt.errContains)
				}
			} else {
				require.NoError(t, err)
				assert.Equal(t, tt.wantPath, result)
			}
		})
	}
}

func TestValidatePath_SymlinkProtection(t *testing.T) {
	// Use real directories so EvalSymlinks can resolve paths
	baseDir := t.TempDir()

	// Create a file inside the base
	require.NoError(t, os.MkdirAll(filepath.Join(baseDir, "subdir"), 0755))
	writeFile(t, filepath.Join(baseDir, "subdir"), "real.txt", "safe content")

	t.Run("allows normal file within base", func(t *testing.T) {
		result, err := validatePath(baseDir, "subdir/real.txt")
		require.NoError(t, err)
		assert.Equal(t, "subdir/real.txt", result)
	})

	t.Run("rejects symlink pointing outside base", func(t *testing.T) {
		// Create a file outside the base directory
		outsideDir := t.TempDir()
		writeFile(t, outsideDir, "secret.txt", "secret data")

		// Create a symlink inside the base that points outside
		require.NoError(t, os.Symlink(
			filepath.Join(outsideDir, "secret.txt"),
			filepath.Join(baseDir, "evil-link.txt"),
		))

		_, err := validatePath(baseDir, "evil-link.txt")
		require.Error(t, err)
		assert.Contains(t, err.Error(), "path escapes base directory")
	})

	t.Run("rejects symlinked directory pointing outside base", func(t *testing.T) {
		outsideDir := t.TempDir()
		writeFile(t, outsideDir, "secret.txt", "secret data")

		// Create a symlinked directory inside the base that points outside
		require.NoError(t, os.Symlink(outsideDir, filepath.Join(baseDir, "evil-dir")))

		_, err := validatePath(baseDir, "evil-dir/secret.txt")
		require.Error(t, err)
		assert.Contains(t, err.Error(), "path escapes base directory")
	})

	t.Run("allows non-existent path with fallback validation", func(t *testing.T) {
		// Non-existent file can't be a symlink, falls back to Abs check
		result, err := validatePath(baseDir, "does-not-exist.txt")
		require.NoError(t, err)
		assert.Equal(t, "does-not-exist.txt", result)
	})
}

func TestListSessionFiles_Success(t *testing.T) {
	h, s := setupTestHandlers(t)

	createTestRepo(t, s, "ws-1", "/path/to/repo")
	_, worktreePath := createTestSessionWithWorktree(t, s, "sess-1", "ws-1")

	// Create some test files
	writeFile(t, worktreePath, "file1.txt", "content1")
	writeFile(t, worktreePath, "file2.txt", "content2")
	require.NoError(t, os.Mkdir(filepath.Join(worktreePath, "subdir"), 0755))
	writeFile(t, worktreePath, "subdir/file3.txt", "content3")

	req := httptest.NewRequest("GET", "/api/sessions/sess-1/files", nil)
	req = withChiContext(req, map[string]string{"sessionId": "sess-1"})
	w := httptest.NewRecorder()

	h.ListSessionFiles(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var response []map[string]interface{}
	err := json.Unmarshal(w.Body.Bytes(), &response)
	require.NoError(t, err)
	// Should have at least the files/directories we created
	assert.GreaterOrEqual(t, len(response), 2)
}

func TestListSessionFiles_SessionNotFound(t *testing.T) {
	h, _ := setupTestHandlers(t)

	req := httptest.NewRequest("GET", "/api/sessions/nonexistent/files", nil)
	req = withChiContext(req, map[string]string{"sessionId": "nonexistent"})
	w := httptest.NewRecorder()

	h.ListSessionFiles(w, req)

	assert.Equal(t, http.StatusNotFound, w.Code)
	assert.Contains(t, w.Body.String(), "session not found")
}

func TestListSessionFiles_DotfileFiltering(t *testing.T) {
	h, s := setupTestHandlers(t)

	createTestRepo(t, s, "ws-1", "/path/to/repo")
	_, worktreePath := createTestSessionWithWorktree(t, s, "sess-1", "ws-1")

	// Create legitimate config dotfiles that should be shown
	writeFile(t, worktreePath, ".mcp.json", `{"mcpServers":{}}`)
	writeFile(t, worktreePath, ".gitignore", "node_modules")
	writeFile(t, worktreePath, ".env.example", "KEY=value")
	writeFile(t, worktreePath, ".prettierrc", `{}`)
	writeFile(t, worktreePath, ".babelrc", `{}`)
	writeFile(t, worktreePath, ".eslintrc.json", `{}`)

	// Create OS junk files that should be filtered out
	writeFile(t, worktreePath, ".DS_Store", "junk")
	writeFile(t, worktreePath, ".localized", "junk")
	writeFile(t, worktreePath, "._hidden", "junk")

	// Create normal files
	writeFile(t, worktreePath, "README.md", "readme")
	writeFile(t, worktreePath, "package.json", `{}`)

	req := httptest.NewRequest("GET", "/api/sessions/sess-1/files", nil)
	req = withChiContext(req, map[string]string{"sessionId": "sess-1"})
	w := httptest.NewRecorder()

	h.ListSessionFiles(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var response []map[string]interface{}
	err := json.Unmarshal(w.Body.Bytes(), &response)
	require.NoError(t, err)

	// Convert response to map for easier checking
	fileMap := make(map[string]bool)
	for _, file := range response {
		name, ok := file["name"].(string)
		if ok {
			fileMap[name] = true
		}
	}

	// Verify legitimate config dotfiles are included
	assert.True(t, fileMap[".mcp.json"], ".mcp.json should be included")
	assert.True(t, fileMap[".gitignore"], ".gitignore should be included")
	assert.True(t, fileMap[".env.example"], ".env.example should be included")
	assert.True(t, fileMap[".prettierrc"], ".prettierrc should be included")
	assert.True(t, fileMap[".babelrc"], ".babelrc should be included")
	assert.True(t, fileMap[".eslintrc.json"], ".eslintrc.json should be included")

	// Verify OS junk files are excluded
	assert.False(t, fileMap[".DS_Store"], ".DS_Store should be excluded")
	assert.False(t, fileMap[".localized"], ".localized should be excluded")
	assert.False(t, fileMap["._hidden"], "._hidden should be excluded")

	// Verify normal files are included
	assert.True(t, fileMap["README.md"], "README.md should be included")
	assert.True(t, fileMap["package.json"], "package.json should be included")
}
func TestSaveFile_Success(t *testing.T) {
	h, s := setupTestHandlers(t)

	repoPath := createTestGitRepo(t)
	repo := createTestRepo(t, s, "ws-1", repoPath)

	// Create a test file to save to (SaveFile only allows saving existing files)
	writeFile(t, repoPath, "test.txt", "original content")

	body, _ := json.Marshal(SaveFileRequest{
		Path:    "test.txt",
		Content: "updated content",
	})
	req := httptest.NewRequest("POST", "/api/repos/ws-1/file/save", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req = withChiContext(req, map[string]string{"id": repo.ID})
	w := httptest.NewRecorder()

	h.SaveFile(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	// Verify file was updated
	content, err := os.ReadFile(filepath.Join(repoPath, "test.txt"))
	require.NoError(t, err)
	assert.Equal(t, "updated content", string(content))
}

func TestSaveFile_ExceedsMaxSize(t *testing.T) {
	// Set a small max file size for testing via env var BEFORE creating handlers
	t.Setenv("CHATML_MAX_FILE_SIZE_MB", "1") // 1MB limit

	h, s := setupTestHandlers(t)

	repoPath := createTestGitRepo(t)
	repo := createTestRepo(t, s, "ws-1", repoPath)

	// Create a test file to save to
	writeFile(t, repoPath, "test.txt", "original content")

	// Create content larger than 1MB
	largeContent := strings.Repeat("x", 2*1024*1024) // 2MB

	body, _ := json.Marshal(SaveFileRequest{
		Path:    "test.txt",
		Content: largeContent,
	})
	req := httptest.NewRequest("POST", "/api/repos/ws-1/file/save", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req = withChiContext(req, map[string]string{"id": repo.ID})
	w := httptest.NewRecorder()

	h.SaveFile(w, req)

	assert.Equal(t, http.StatusRequestEntityTooLarge, w.Code)

	var apiErr APIError
	err := json.Unmarshal(w.Body.Bytes(), &apiErr)
	require.NoError(t, err)
	assert.Equal(t, ErrCodePayloadTooLarge, apiErr.Code)
	assert.Contains(t, apiErr.Error, "exceeds maximum size")
}

func TestSaveFile_AtExactLimit(t *testing.T) {
	// Set a small max file size for testing BEFORE creating handlers
	t.Setenv("CHATML_MAX_FILE_SIZE_MB", "1") // 1MB limit

	h, s := setupTestHandlers(t)

	repoPath := createTestGitRepo(t)
	repo := createTestRepo(t, s, "ws-1", repoPath)

	// Create a test file to save to
	writeFile(t, repoPath, "test.txt", "original content")

	// Create content exactly at 1MB (should succeed)
	exactContent := strings.Repeat("x", 1*1024*1024) // exactly 1MB

	body, _ := json.Marshal(SaveFileRequest{
		Path:    "test.txt",
		Content: exactContent,
	})
	req := httptest.NewRequest("POST", "/api/repos/ws-1/file/save", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req = withChiContext(req, map[string]string{"id": repo.ID})
	w := httptest.NewRecorder()

	h.SaveFile(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
}

func TestSaveFile_JustOverLimit(t *testing.T) {
	// Set a small max file size for testing BEFORE creating handlers
	t.Setenv("CHATML_MAX_FILE_SIZE_MB", "1") // 1MB limit

	h, s := setupTestHandlers(t)

	repoPath := createTestGitRepo(t)
	repo := createTestRepo(t, s, "ws-1", repoPath)

	// Create a test file to save to
	writeFile(t, repoPath, "test.txt", "original content")

	// Create content just over 1MB (should fail)
	overContent := strings.Repeat("x", 1*1024*1024+1) // 1MB + 1 byte

	body, _ := json.Marshal(SaveFileRequest{
		Path:    "test.txt",
		Content: overContent,
	})
	req := httptest.NewRequest("POST", "/api/repos/ws-1/file/save", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req = withChiContext(req, map[string]string{"id": repo.ID})
	w := httptest.NewRecorder()

	h.SaveFile(w, req)

	assert.Equal(t, http.StatusRequestEntityTooLarge, w.Code)
}
