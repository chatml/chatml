package builtin

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/chatml/chatml-backend/tool"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// --- BashTool tests ---

func TestBashTool_Echo(t *testing.T) {
	bash := NewBashTool(t.TempDir())
	result, err := bash.Execute(context.Background(), json.RawMessage(`{"command":"echo hello world"}`))
	require.NoError(t, err)
	assert.False(t, result.IsError)
	assert.Contains(t, result.Content, "hello world")
}

func TestBashTool_EmptyCommand(t *testing.T) {
	bash := NewBashTool(t.TempDir())
	result, err := bash.Execute(context.Background(), json.RawMessage(`{"command":""}`))
	require.NoError(t, err)
	assert.True(t, result.IsError)
	assert.Contains(t, result.Content, "empty")
}

func TestBashTool_ExitCode(t *testing.T) {
	bash := NewBashTool(t.TempDir())
	result, err := bash.Execute(context.Background(), json.RawMessage(`{"command":"exit 42"}`))
	require.NoError(t, err)
	assert.True(t, result.IsError)
	assert.Contains(t, result.Content, "42")
}

func TestBashTool_Stderr(t *testing.T) {
	bash := NewBashTool(t.TempDir())
	result, err := bash.Execute(context.Background(), json.RawMessage(`{"command":"echo err >&2"}`))
	require.NoError(t, err)
	assert.Contains(t, result.Content, "STDERR:")
	assert.Contains(t, result.Content, "err")
}

func TestBashTool_WorkingDirectory(t *testing.T) {
	dir := t.TempDir()
	bash := NewBashTool(dir)
	result, err := bash.Execute(context.Background(), json.RawMessage(`{"command":"pwd"}`))
	require.NoError(t, err)
	assert.Contains(t, result.Content, dir)
}

func TestBashTool_ConcurrencySafe(t *testing.T) {
	bash := NewBashTool("/tmp")
	assert.False(t, bash.IsConcurrentSafe())
}

// --- ReadTool tests ---

func TestReadTool_BasicRead(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "test.txt")
	os.WriteFile(path, []byte("line1\nline2\nline3\n"), 0644)

	read := NewReadTool(dir)
	result, err := read.Execute(context.Background(), json.RawMessage(`{"file_path":"`+path+`"}`))
	require.NoError(t, err)
	assert.False(t, result.IsError)
	assert.Contains(t, result.Content, "line1")
	assert.Contains(t, result.Content, "line2")
	assert.Contains(t, result.Content, "line3")
}

func TestReadTool_WithOffsetAndLimit(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "test.txt")
	os.WriteFile(path, []byte("a\nb\nc\nd\ne\n"), 0644)

	read := NewReadTool(dir)
	result, err := read.Execute(context.Background(), json.RawMessage(`{"file_path":"`+path+`","offset":2,"limit":2}`))
	require.NoError(t, err)
	assert.Contains(t, result.Content, "b")
	assert.Contains(t, result.Content, "c")
	assert.NotContains(t, result.Content, "\t"+"a\n") // line 1 skipped
	assert.NotContains(t, result.Content, "\t"+"d\n") // line 4 beyond limit
}

func TestReadTool_FileNotFound(t *testing.T) {
	read := NewReadTool(t.TempDir())
	result, err := read.Execute(context.Background(), json.RawMessage(`{"file_path":"/nonexistent/file.txt"}`))
	require.NoError(t, err)
	assert.True(t, result.IsError)
	assert.Contains(t, result.Content, "not found")
}

func TestReadTool_Directory(t *testing.T) {
	dir := t.TempDir()
	read := NewReadTool(dir)
	result, err := read.Execute(context.Background(), json.RawMessage(`{"file_path":"`+dir+`"}`))
	require.NoError(t, err)
	assert.True(t, result.IsError)
	assert.Contains(t, result.Content, "directory")
}

func TestReadTool_EmptyFile(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "empty.txt")
	os.WriteFile(path, []byte(""), 0644)

	read := NewReadTool(dir)
	result, err := read.Execute(context.Background(), json.RawMessage(`{"file_path":"`+path+`"}`))
	require.NoError(t, err)
	assert.Contains(t, result.Content, "empty file")
}

func TestReadTool_ConcurrencySafe(t *testing.T) {
	read := NewReadTool("/tmp")
	assert.True(t, read.IsConcurrentSafe())
}

func TestReadTool_LineNumbers(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "test.txt")
	os.WriteFile(path, []byte("first\nsecond\nthird\n"), 0644)

	read := NewReadTool(dir)
	result, err := read.Execute(context.Background(), json.RawMessage(`{"file_path":"`+path+`"}`))
	require.NoError(t, err)
	// Should have line numbers (cat -n format)
	assert.Contains(t, result.Content, "1\t")
	assert.Contains(t, result.Content, "2\t")
}

// --- WriteTool tests ---

func TestWriteTool_CreateNew(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "new.txt")

	write := NewWriteTool(dir)
	result, err := write.Execute(context.Background(), json.RawMessage(`{"file_path":"`+path+`","content":"hello world\n"}`))
	require.NoError(t, err)
	assert.False(t, result.IsError)
	assert.Contains(t, result.Content, "Created")

	data, _ := os.ReadFile(path)
	assert.Equal(t, "hello world\n", string(data))
}

func TestWriteTool_UpdateExisting(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "existing.txt")
	os.WriteFile(path, []byte("old content"), 0644)

	write := NewWriteTool(dir)
	result, err := write.Execute(context.Background(), json.RawMessage(`{"file_path":"`+path+`","content":"new content"}`))
	require.NoError(t, err)
	assert.Contains(t, result.Content, "Updated")

	data, _ := os.ReadFile(path)
	assert.Equal(t, "new content", string(data))
}

func TestWriteTool_CreatesParentDirs(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "a", "b", "c", "deep.txt")

	write := NewWriteTool(dir)
	result, err := write.Execute(context.Background(), json.RawMessage(`{"file_path":"`+path+`","content":"deep"}`))
	require.NoError(t, err)
	assert.False(t, result.IsError)

	data, _ := os.ReadFile(path)
	assert.Equal(t, "deep", string(data))
}

func TestWriteTool_ConcurrencySafe(t *testing.T) {
	write := NewWriteTool("/tmp")
	assert.False(t, write.IsConcurrentSafe())
}

// --- EditTool tests ---

func TestEditTool_SingleReplacement(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "edit.txt")
	os.WriteFile(path, []byte("hello world"), 0644)

	edit := NewEditTool(dir)
	result, err := edit.Execute(context.Background(), json.RawMessage(`{"file_path":"`+path+`","old_string":"world","new_string":"Go"}`))
	require.NoError(t, err)
	assert.False(t, result.IsError)
	assert.Contains(t, result.Content, "1 occurrence")

	data, _ := os.ReadFile(path)
	assert.Equal(t, "hello Go", string(data))
}

func TestEditTool_ReplaceAll(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "edit.txt")
	os.WriteFile(path, []byte("foo bar foo baz foo"), 0644)

	edit := NewEditTool(dir)
	result, err := edit.Execute(context.Background(), json.RawMessage(`{"file_path":"`+path+`","old_string":"foo","new_string":"qux","replace_all":true}`))
	require.NoError(t, err)
	assert.Contains(t, result.Content, "3 occurrence")

	data, _ := os.ReadFile(path)
	assert.Equal(t, "qux bar qux baz qux", string(data))
}

func TestEditTool_NotFound(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "edit.txt")
	os.WriteFile(path, []byte("hello world"), 0644)

	edit := NewEditTool(dir)
	result, err := edit.Execute(context.Background(), json.RawMessage(`{"file_path":"`+path+`","old_string":"missing","new_string":"x"}`))
	require.NoError(t, err)
	assert.True(t, result.IsError)
	assert.Contains(t, result.Content, "not found")
}

func TestEditTool_MultipleMatchesWithoutReplaceAll(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "edit.txt")
	os.WriteFile(path, []byte("aaa bbb aaa"), 0644)

	edit := NewEditTool(dir)
	result, err := edit.Execute(context.Background(), json.RawMessage(`{"file_path":"`+path+`","old_string":"aaa","new_string":"ccc"}`))
	require.NoError(t, err)
	assert.True(t, result.IsError)
	assert.Contains(t, result.Content, "2 times")
}

func TestEditTool_SameOldNew(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "edit.txt")
	os.WriteFile(path, []byte("hello"), 0644)

	edit := NewEditTool(dir)
	result, err := edit.Execute(context.Background(), json.RawMessage(`{"file_path":"`+path+`","old_string":"hello","new_string":"hello"}`))
	require.NoError(t, err)
	assert.True(t, result.IsError)
	assert.Contains(t, result.Content, "different")
}

func TestEditTool_FileNotFound(t *testing.T) {
	edit := NewEditTool(t.TempDir())
	result, err := edit.Execute(context.Background(), json.RawMessage(`{"file_path":"/nonexistent.txt","old_string":"a","new_string":"b"}`))
	require.NoError(t, err)
	assert.True(t, result.IsError)
}

func TestEditTool_ConcurrencySafe(t *testing.T) {
	edit := NewEditTool("/tmp")
	assert.False(t, edit.IsConcurrentSafe())
}

// --- GlobTool tests ---

func TestGlobTool_FindFiles(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, "a.go"), []byte(""), 0644)
	os.WriteFile(filepath.Join(dir, "b.go"), []byte(""), 0644)
	os.WriteFile(filepath.Join(dir, "c.txt"), []byte(""), 0644)

	glob := NewGlobTool(dir)
	result, err := glob.Execute(context.Background(), json.RawMessage(`{"pattern":"*.go"}`))
	require.NoError(t, err)
	assert.False(t, result.IsError)
	assert.Contains(t, result.Content, "a.go")
	assert.Contains(t, result.Content, "b.go")
	assert.NotContains(t, result.Content, "c.txt")
}

func TestGlobTool_DirectoryNotFound(t *testing.T) {
	glob := NewGlobTool(t.TempDir())
	result, err := glob.Execute(context.Background(), json.RawMessage(`{"pattern":"*.go","path":"/nonexistent"}`))
	require.NoError(t, err)
	assert.True(t, result.IsError)
}

func TestGlobTool_ConcurrencySafe(t *testing.T) {
	glob := NewGlobTool("/tmp")
	assert.True(t, glob.IsConcurrentSafe())
}

// --- GrepTool tests ---

func TestGrepTool_BasicSearch(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, "main.go"), []byte("func main() {\n\tfmt.Println(\"hello\")\n}\n"), 0644)

	grep := NewGrepTool(dir)
	result, err := grep.Execute(context.Background(), json.RawMessage(`{"pattern":"func main"}`))
	require.NoError(t, err)
	assert.False(t, result.IsError)
	assert.Contains(t, result.Content, "main.go")
}

func TestGrepTool_NoMatches(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, "test.txt"), []byte("hello world"), 0644)

	grep := NewGrepTool(dir)
	result, err := grep.Execute(context.Background(), json.RawMessage(`{"pattern":"zzzznonexistent"}`))
	require.NoError(t, err)
	assert.Contains(t, result.Content, "No matches")
}

func TestGrepTool_ConcurrencySafe(t *testing.T) {
	grep := NewGrepTool("/tmp")
	assert.True(t, grep.IsConcurrentSafe())
}

// --- RegisterAll test ---

// --- BashTool additional tests ---

func TestBashTool_InvalidJSON(t *testing.T) {
	bash := NewBashTool(t.TempDir())
	result, err := bash.Execute(context.Background(), json.RawMessage(`{invalid`))
	require.NoError(t, err)
	assert.True(t, result.IsError)
	assert.Contains(t, result.Content, "Invalid input")
}

func TestBashTool_CustomTimeout(t *testing.T) {
	bash := NewBashTool(t.TempDir())
	// Use a very short timeout — command should be killed
	result, err := bash.Execute(context.Background(), json.RawMessage(`{"command":"sleep 10","timeout":100}`))
	require.NoError(t, err)
	assert.True(t, result.IsError)
	assert.Contains(t, result.Content, "timed out")
}

func TestBashTool_TimeoutCapped(t *testing.T) {
	bash := NewBashTool(t.TempDir())
	// Even if timeout exceeds max, the tool should not error on input — it just caps at max
	result, err := bash.Execute(context.Background(), json.RawMessage(`{"command":"echo ok","timeout":999999999}`))
	require.NoError(t, err)
	assert.False(t, result.IsError)
	assert.Contains(t, result.Content, "ok")
}

func TestBashTool_StdoutAndStderr(t *testing.T) {
	bash := NewBashTool(t.TempDir())
	result, err := bash.Execute(context.Background(), json.RawMessage(`{"command":"echo out && echo err >&2"}`))
	require.NoError(t, err)
	assert.Contains(t, result.Content, "out")
	assert.Contains(t, result.Content, "STDERR:")
	assert.Contains(t, result.Content, "err")
}

func TestBashTool_WhitespaceOnlyCommand(t *testing.T) {
	bash := NewBashTool(t.TempDir())
	result, err := bash.Execute(context.Background(), json.RawMessage(`{"command":"   "}`))
	require.NoError(t, err)
	assert.True(t, result.IsError)
	assert.Contains(t, result.Content, "empty")
}

func TestBashTool_NameAndSchema(t *testing.T) {
	bash := NewBashTool("/tmp")
	assert.Equal(t, "Bash", bash.Name())
	assert.NotEmpty(t, bash.Description())
	assert.True(t, json.Valid(bash.InputSchema()))
}

// --- ReadTool additional tests ---

func TestReadTool_RelativePath(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, "rel.txt"), []byte("content\n"), 0644)

	read := NewReadTool(dir)
	result, err := read.Execute(context.Background(), json.RawMessage(`{"file_path":"rel.txt"}`))
	require.NoError(t, err)
	assert.False(t, result.IsError)
	assert.Contains(t, result.Content, "content")
}

func TestReadTool_OffsetBeyondFile(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "short.txt")
	os.WriteFile(path, []byte("line1\nline2\n"), 0644)

	read := NewReadTool(dir)
	result, err := read.Execute(context.Background(), json.RawMessage(`{"file_path":"`+path+`","offset":999}`))
	require.NoError(t, err)
	assert.Contains(t, result.Content, "No content at offset")
}

func TestReadTool_DefaultLimit(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "test.txt")
	// Write a file with a few lines — all should be read with default limit
	os.WriteFile(path, []byte("a\nb\nc\n"), 0644)

	read := NewReadTool(dir)
	result, err := read.Execute(context.Background(), json.RawMessage(`{"file_path":"`+path+`"}`))
	require.NoError(t, err)
	assert.Contains(t, result.Content, "a")
	assert.Contains(t, result.Content, "b")
	assert.Contains(t, result.Content, "c")
}

func TestReadTool_InvalidJSON(t *testing.T) {
	read := NewReadTool(t.TempDir())
	result, err := read.Execute(context.Background(), json.RawMessage(`{bad`))
	require.NoError(t, err)
	assert.True(t, result.IsError)
	assert.Contains(t, result.Content, "Invalid input")
}

func TestReadTool_NameAndSchema(t *testing.T) {
	read := NewReadTool("/tmp")
	assert.Equal(t, "Read", read.Name())
	assert.NotEmpty(t, read.Description())
	assert.True(t, json.Valid(read.InputSchema()))
}

// --- WriteTool additional tests ---

func TestWriteTool_EmptyFilePath(t *testing.T) {
	write := NewWriteTool(t.TempDir())
	result, err := write.Execute(context.Background(), json.RawMessage(`{"file_path":"","content":"x"}`))
	require.NoError(t, err)
	assert.True(t, result.IsError)
	assert.Contains(t, result.Content, "file_path is required")
}

func TestWriteTool_Metadata(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "meta.txt")

	write := NewWriteTool(dir)
	result, err := write.Execute(context.Background(), json.RawMessage(`{"file_path":"`+path+`","content":"line1\nline2\n"}`))
	require.NoError(t, err)
	assert.NotNil(t, result.Metadata)
	assert.Equal(t, "Created", result.Metadata["action"])
	assert.Equal(t, path, result.Metadata["file_path"])
}

func TestWriteTool_LineCount(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "lines.txt")

	write := NewWriteTool(dir)
	result, err := write.Execute(context.Background(), json.RawMessage(`{"file_path":"`+path+`","content":"a\nb\nc\n"}`))
	require.NoError(t, err)
	// 3 newlines + trailing = 4 "lines" in the count logic
	assert.Contains(t, result.Content, "4 lines")
}

func TestWriteTool_RelativePath(t *testing.T) {
	dir := t.TempDir()

	write := NewWriteTool(dir)
	result, err := write.Execute(context.Background(), json.RawMessage(`{"file_path":"relative.txt","content":"data"}`))
	require.NoError(t, err)
	assert.False(t, result.IsError)

	data, _ := os.ReadFile(filepath.Join(dir, "relative.txt"))
	assert.Equal(t, "data", string(data))
}

func TestWriteTool_InvalidJSON(t *testing.T) {
	write := NewWriteTool(t.TempDir())
	result, err := write.Execute(context.Background(), json.RawMessage(`{bad`))
	require.NoError(t, err)
	assert.True(t, result.IsError)
	assert.Contains(t, result.Content, "Invalid input")
}

func TestWriteTool_NameAndSchema(t *testing.T) {
	write := NewWriteTool("/tmp")
	assert.Equal(t, "Write", write.Name())
	assert.NotEmpty(t, write.Description())
	assert.True(t, json.Valid(write.InputSchema()))
}

// --- EditTool additional tests ---

func TestEditTool_EmptyFilePath(t *testing.T) {
	edit := NewEditTool(t.TempDir())
	result, err := edit.Execute(context.Background(), json.RawMessage(`{"file_path":"","old_string":"a","new_string":"b"}`))
	require.NoError(t, err)
	assert.True(t, result.IsError)
	assert.Contains(t, result.Content, "file_path is required")
}

func TestEditTool_InvalidJSON(t *testing.T) {
	edit := NewEditTool(t.TempDir())
	result, err := edit.Execute(context.Background(), json.RawMessage(`{bad`))
	require.NoError(t, err)
	assert.True(t, result.IsError)
	assert.Contains(t, result.Content, "Invalid input")
}

func TestEditTool_Metadata(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "meta.txt")
	os.WriteFile(path, []byte("foo bar"), 0644)

	edit := NewEditTool(dir)
	result, err := edit.Execute(context.Background(), json.RawMessage(`{"file_path":"`+path+`","old_string":"foo","new_string":"baz"}`))
	require.NoError(t, err)
	assert.NotNil(t, result.Metadata)
	assert.Equal(t, 1, result.Metadata["replacements"])
	assert.Equal(t, path, result.Metadata["file_path"])
}

func TestEditTool_RelativePath(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, "rel.txt"), []byte("old"), 0644)

	edit := NewEditTool(dir)
	result, err := edit.Execute(context.Background(), json.RawMessage(`{"file_path":"rel.txt","old_string":"old","new_string":"new"}`))
	require.NoError(t, err)
	assert.False(t, result.IsError)

	data, _ := os.ReadFile(filepath.Join(dir, "rel.txt"))
	assert.Equal(t, "new", string(data))
}

func TestEditTool_MultilineReplacement(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "multi.txt")
	os.WriteFile(path, []byte("line1\nline2\nline3\n"), 0644)

	edit := NewEditTool(dir)
	result, err := edit.Execute(context.Background(), json.RawMessage(`{"file_path":"`+path+`","old_string":"line1\nline2","new_string":"replaced"}`))
	require.NoError(t, err)
	assert.False(t, result.IsError)

	data, _ := os.ReadFile(path)
	assert.Equal(t, "replaced\nline3\n", string(data))
}

func TestEditTool_NameAndSchema(t *testing.T) {
	edit := NewEditTool("/tmp")
	assert.Equal(t, "Edit", edit.Name())
	assert.NotEmpty(t, edit.Description())
	assert.True(t, json.Valid(edit.InputSchema()))
}

// --- GlobTool additional tests ---

func TestGlobTool_DoubleStarPattern(t *testing.T) {
	dir := t.TempDir()
	os.MkdirAll(filepath.Join(dir, "src", "pkg"), 0755)
	os.WriteFile(filepath.Join(dir, "src", "main.go"), []byte(""), 0644)
	os.WriteFile(filepath.Join(dir, "src", "pkg", "util.go"), []byte(""), 0644)
	os.WriteFile(filepath.Join(dir, "src", "pkg", "data.txt"), []byte(""), 0644)

	glob := NewGlobTool(dir)
	result, err := glob.Execute(context.Background(), json.RawMessage(`{"pattern":"**/*.go"}`))
	require.NoError(t, err)
	assert.False(t, result.IsError)
	assert.Contains(t, result.Content, "main.go")
	assert.Contains(t, result.Content, "util.go")
	assert.NotContains(t, result.Content, "data.txt")
}

func TestGlobTool_EmptyPattern(t *testing.T) {
	glob := NewGlobTool(t.TempDir())
	result, err := glob.Execute(context.Background(), json.RawMessage(`{"pattern":""}`))
	require.NoError(t, err)
	assert.True(t, result.IsError)
	assert.Contains(t, result.Content, "pattern is required")
}

func TestGlobTool_RelativePath(t *testing.T) {
	dir := t.TempDir()
	os.MkdirAll(filepath.Join(dir, "sub"), 0755)
	os.WriteFile(filepath.Join(dir, "sub", "a.txt"), []byte(""), 0644)

	glob := NewGlobTool(dir)
	result, err := glob.Execute(context.Background(), json.RawMessage(`{"pattern":"*.txt","path":"sub"}`))
	require.NoError(t, err)
	assert.False(t, result.IsError)
	assert.Contains(t, result.Content, "a.txt")
}

func TestGlobTool_NotADirectory(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "file.txt")
	os.WriteFile(path, []byte(""), 0644)

	glob := NewGlobTool(dir)
	result, err := glob.Execute(context.Background(), json.RawMessage(`{"pattern":"*.go","path":"`+path+`"}`))
	require.NoError(t, err)
	assert.True(t, result.IsError)
	assert.Contains(t, result.Content, "not a directory")
}

func TestGlobTool_SkipsHiddenDirs(t *testing.T) {
	dir := t.TempDir()
	os.MkdirAll(filepath.Join(dir, ".hidden"), 0755)
	os.WriteFile(filepath.Join(dir, ".hidden", "secret.go"), []byte(""), 0644)
	os.WriteFile(filepath.Join(dir, "visible.go"), []byte(""), 0644)

	glob := NewGlobTool(dir)
	result, err := glob.Execute(context.Background(), json.RawMessage(`{"pattern":"**/*.go"}`))
	require.NoError(t, err)
	assert.Contains(t, result.Content, "visible.go")
	assert.NotContains(t, result.Content, "secret.go")
}

func TestGlobTool_NoMatches(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, "a.txt"), []byte(""), 0644)

	glob := NewGlobTool(dir)
	result, err := glob.Execute(context.Background(), json.RawMessage(`{"pattern":"*.go"}`))
	require.NoError(t, err)
	assert.Contains(t, result.Content, "Found 0 file(s)")
}

func TestGlobTool_SkipsDirectoriesInResults(t *testing.T) {
	dir := t.TempDir()
	os.MkdirAll(filepath.Join(dir, "subdir"), 0755)
	os.WriteFile(filepath.Join(dir, "file.go"), []byte(""), 0644)

	glob := NewGlobTool(dir)
	result, err := glob.Execute(context.Background(), json.RawMessage(`{"pattern":"*"}`))
	require.NoError(t, err)
	assert.Contains(t, result.Content, "file.go")
	// subdir should not appear in results (glob skips directories)
	assert.NotContains(t, result.Content, "subdir")
}

func TestGlobTool_InvalidJSON(t *testing.T) {
	glob := NewGlobTool(t.TempDir())
	result, err := glob.Execute(context.Background(), json.RawMessage(`{bad`))
	require.NoError(t, err)
	assert.True(t, result.IsError)
	assert.Contains(t, result.Content, "Invalid input")
}

func TestGlobTool_NameAndSchema(t *testing.T) {
	glob := NewGlobTool("/tmp")
	assert.Equal(t, "Glob", glob.Name())
	assert.NotEmpty(t, glob.Description())
	assert.True(t, json.Valid(glob.InputSchema()))
}

// --- GrepTool additional tests ---

func TestGrepTool_EmptyPattern(t *testing.T) {
	grep := NewGrepTool(t.TempDir())
	result, err := grep.Execute(context.Background(), json.RawMessage(`{"pattern":""}`))
	require.NoError(t, err)
	assert.True(t, result.IsError)
	assert.Contains(t, result.Content, "pattern is required")
}

func TestGrepTool_InvalidOutputMode(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, "a.txt"), []byte("hello"), 0644)

	grep := NewGrepTool(dir)
	result, err := grep.Execute(context.Background(), json.RawMessage(`{"pattern":"hello","output_mode":"bogus"}`))
	require.NoError(t, err)
	assert.True(t, result.IsError)
	assert.Contains(t, result.Content, "Invalid output_mode")
}

func TestGrepTool_ContentMode(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, "test.go"), []byte("func main() {\n\tfmt.Println(\"hello\")\n}\n"), 0644)

	grep := NewGrepTool(dir)
	result, err := grep.Execute(context.Background(), json.RawMessage(`{"pattern":"Println","output_mode":"content"}`))
	require.NoError(t, err)
	assert.False(t, result.IsError)
	assert.Contains(t, result.Content, "Println")
	assert.Contains(t, result.Content, "hello")
}

func TestGrepTool_CountMode(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, "count.txt"), []byte("aaa\naab\naac\nbbb\n"), 0644)

	grep := NewGrepTool(dir)
	result, err := grep.Execute(context.Background(), json.RawMessage(`{"pattern":"aa","output_mode":"count"}`))
	require.NoError(t, err)
	assert.False(t, result.IsError)
	assert.Contains(t, result.Content, "3")
}

func TestGrepTool_CaseInsensitive(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, "case.txt"), []byte("Hello World\n"), 0644)

	grep := NewGrepTool(dir)
	result, err := grep.Execute(context.Background(), json.RawMessage(`{"pattern":"hello","-i":true}`))
	require.NoError(t, err)
	assert.False(t, result.IsError)
	assert.Contains(t, result.Content, "case.txt")
}

func TestGrepTool_GlobFilter(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, "match.go"), []byte("target\n"), 0644)
	os.WriteFile(filepath.Join(dir, "skip.txt"), []byte("target\n"), 0644)

	grep := NewGrepTool(dir)
	result, err := grep.Execute(context.Background(), json.RawMessage(`{"pattern":"target","glob":"*.go"}`))
	require.NoError(t, err)
	assert.Contains(t, result.Content, "match.go")
	assert.NotContains(t, result.Content, "skip.txt")
}

func TestGrepTool_TypeFilter(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, "code.go"), []byte("package main\n"), 0644)
	os.WriteFile(filepath.Join(dir, "notes.txt"), []byte("package notes\n"), 0644)

	grep := NewGrepTool(dir)
	result, err := grep.Execute(context.Background(), json.RawMessage(`{"pattern":"package","type":"go"}`))
	require.NoError(t, err)
	assert.Contains(t, result.Content, "code.go")
	assert.NotContains(t, result.Content, "notes.txt")
}

func TestGrepTool_SubdirectoryPath(t *testing.T) {
	dir := t.TempDir()
	os.MkdirAll(filepath.Join(dir, "sub"), 0755)
	os.WriteFile(filepath.Join(dir, "sub", "target.txt"), []byte("findme\n"), 0644)
	os.WriteFile(filepath.Join(dir, "root.txt"), []byte("findme\n"), 0644)

	grep := NewGrepTool(dir)
	result, err := grep.Execute(context.Background(), json.RawMessage(`{"pattern":"findme","path":"sub"}`))
	require.NoError(t, err)
	assert.Contains(t, result.Content, "target.txt")
	assert.NotContains(t, result.Content, "root.txt")
}

func TestGrepTool_InvalidJSON(t *testing.T) {
	grep := NewGrepTool(t.TempDir())
	result, err := grep.Execute(context.Background(), json.RawMessage(`{bad`))
	require.NoError(t, err)
	assert.True(t, result.IsError)
	assert.Contains(t, result.Content, "Invalid input")
}

func TestGrepTool_NameAndSchema(t *testing.T) {
	grep := NewGrepTool("/tmp")
	assert.Equal(t, "Grep", grep.Name())
	assert.NotEmpty(t, grep.Description())
	assert.True(t, json.Valid(grep.InputSchema()))
}

func TestGrepTool_Metadata(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, "m.txt"), []byte("hello\n"), 0644)

	grep := NewGrepTool(dir)
	result, err := grep.Execute(context.Background(), json.RawMessage(`{"pattern":"hello"}`))
	require.NoError(t, err)
	assert.NotNil(t, result.Metadata)
	assert.Equal(t, "files_with_matches", result.Metadata["mode"])
}

// --- RegisterAll test ---

func TestRegisterAll(t *testing.T) {
	reg := tool.NewRegistry()
	RegisterAll(reg, "/tmp")
	assert.Equal(t, 12, reg.Count())
	assert.NotNil(t, reg.Get("Bash"))
	assert.NotNil(t, reg.Get("Read"))
	assert.NotNil(t, reg.Get("Write"))
	assert.NotNil(t, reg.Get("Edit"))
	assert.NotNil(t, reg.Get("Glob"))
	assert.NotNil(t, reg.Get("Grep"))
	assert.NotNil(t, reg.Get("WebFetch"))
	assert.NotNil(t, reg.Get("WebSearch"))
	assert.NotNil(t, reg.Get("TodoWrite"))
	assert.NotNil(t, reg.Get("AskUserQuestion"))
	assert.NotNil(t, reg.Get("ExitPlanMode"))
	assert.NotNil(t, reg.Get("EnterPlanMode"))
}

func TestRegisterAll_ToolDefsValid(t *testing.T) {
	reg := tool.NewRegistry()
	RegisterAll(reg, "/tmp")

	defs := reg.ToolDefs()
	assert.Len(t, defs, 12)
	for _, def := range defs {
		assert.NotEmpty(t, def.Name)
		assert.NotEmpty(t, def.Description)
		assert.True(t, json.Valid(def.InputSchema), "invalid schema for tool %s", def.Name)
	}
}

func TestRegisterAll_ConcurrencyFlags(t *testing.T) {
	reg := tool.NewRegistry()
	RegisterAll(reg, "/tmp")

	// Read-only tools should be concurrent-safe
	assert.True(t, reg.Get("Read").IsConcurrentSafe())
	assert.True(t, reg.Get("Glob").IsConcurrentSafe())
	assert.True(t, reg.Get("Grep").IsConcurrentSafe())

	// Write tools should NOT be concurrent-safe
	assert.False(t, reg.Get("Bash").IsConcurrentSafe())
	assert.False(t, reg.Get("Write").IsConcurrentSafe())
	assert.False(t, reg.Get("Edit").IsConcurrentSafe())
}

// --- TodoWriteTool tests ---

func TestTodoWriteTool_Basic(t *testing.T) {
	var emittedType string
	var emittedData interface{}
	emitFn := func(eventType string, data interface{}) {
		emittedType = eventType
		emittedData = data
	}

	tw := NewTodoWriteTool(emitFn)
	assert.Equal(t, "TodoWrite", tw.Name())
	assert.False(t, tw.IsConcurrentSafe())

	result, err := tw.Execute(context.Background(), json.RawMessage(`{
		"todos": [
			{"content": "Write tests", "status": "in_progress", "activeForm": "Writing tests"},
			{"content": "Deploy", "status": "pending"}
		]
	}`))
	require.NoError(t, err)
	assert.False(t, result.IsError)
	assert.Contains(t, result.Content, "1 pending")
	assert.Contains(t, result.Content, "1 in progress")
	assert.Equal(t, "todo_update", emittedType)
	assert.NotNil(t, emittedData)
}

func TestTodoWriteTool_InvalidJSON(t *testing.T) {
	tw := NewTodoWriteTool(nil)
	result, err := tw.Execute(context.Background(), json.RawMessage(`{bad`))
	require.NoError(t, err)
	assert.True(t, result.IsError)
}

func TestTodoWriteTool_NilEmit(t *testing.T) {
	tw := NewTodoWriteTool(nil)
	result, err := tw.Execute(context.Background(), json.RawMessage(`{"todos":[]}`))
	require.NoError(t, err)
	assert.False(t, result.IsError)
}

func TestTodoWriteTool_NameAndSchema(t *testing.T) {
	tw := NewTodoWriteTool(nil)
	assert.NotEmpty(t, tw.Description())
	assert.True(t, json.Valid(tw.InputSchema()))
}

// --- WebFetchTool tests ---

func TestWebFetchTool_NameAndSchema(t *testing.T) {
	wf := NewWebFetchTool()
	assert.Equal(t, "WebFetch", wf.Name())
	assert.True(t, wf.IsConcurrentSafe())
	assert.NotEmpty(t, wf.Description())
	assert.True(t, json.Valid(wf.InputSchema()))
}

func TestWebFetchTool_EmptyURL(t *testing.T) {
	wf := NewWebFetchTool()
	result, err := wf.Execute(context.Background(), json.RawMessage(`{"url":""}`))
	require.NoError(t, err)
	assert.True(t, result.IsError)
	assert.Contains(t, result.Content, "url is required")
}

func TestWebFetchTool_InvalidScheme(t *testing.T) {
	wf := NewWebFetchTool()
	result, err := wf.Execute(context.Background(), json.RawMessage(`{"url":"ftp://example.com"}`))
	require.NoError(t, err)
	assert.True(t, result.IsError)
	assert.Contains(t, result.Content, "http")
}

func TestWebFetchTool_InvalidJSON(t *testing.T) {
	wf := NewWebFetchTool()
	result, err := wf.Execute(context.Background(), json.RawMessage(`{bad`))
	require.NoError(t, err)
	assert.True(t, result.IsError)
}

// --- WebSearchTool tests ---

func TestWebSearchTool_NameAndSchema(t *testing.T) {
	ws := NewWebSearchTool()
	assert.Equal(t, "WebSearch", ws.Name())
	assert.True(t, ws.IsConcurrentSafe())
	assert.NotEmpty(t, ws.Description())
	assert.True(t, json.Valid(ws.InputSchema()))
}

func TestWebSearchTool_EmptyQuery(t *testing.T) {
	ws := NewWebSearchTool()
	result, err := ws.Execute(context.Background(), json.RawMessage(`{"query":""}`))
	require.NoError(t, err)
	assert.True(t, result.IsError)
}

func TestWebSearchTool_NotConfigured(t *testing.T) {
	ws := NewWebSearchTool()
	result, err := ws.Execute(context.Background(), json.RawMessage(`{"query":"test"}`))
	require.NoError(t, err)
	assert.True(t, result.IsError)
	assert.Contains(t, result.Content, "not yet configured")
}

// --- AskUserQuestionTool tests ---

func TestAskUserQuestionTool_NameAndSchema(t *testing.T) {
	ask := NewAskUserQuestionTool(nil)
	assert.Equal(t, "AskUserQuestion", ask.Name())
	assert.False(t, ask.IsConcurrentSafe())
	assert.NotEmpty(t, ask.Description())
	assert.True(t, json.Valid(ask.InputSchema()))
}

func TestAskUserQuestionTool_NoCallback(t *testing.T) {
	ask := NewAskUserQuestionTool(nil)
	result, err := ask.Execute(context.Background(), json.RawMessage(`{"questions":[{"id":"q1","text":"What?"}]}`))
	require.NoError(t, err)
	assert.True(t, result.IsError)
	assert.Contains(t, result.Content, "not available")
}

func TestAskUserQuestionTool_EmptyQuestions(t *testing.T) {
	ask := NewAskUserQuestionTool(nil)
	result, err := ask.Execute(context.Background(), json.RawMessage(`{"questions":[]}`))
	require.NoError(t, err)
	assert.True(t, result.IsError)
	assert.Contains(t, result.Content, "At least one question")
}

func TestAskUserQuestionTool_InvalidJSON(t *testing.T) {
	ask := NewAskUserQuestionTool(nil)
	result, err := ask.Execute(context.Background(), json.RawMessage(`{bad`))
	require.NoError(t, err)
	assert.True(t, result.IsError)
}

// --- PlanMode tool tests ---

func TestExitPlanModeTool_NameAndSchema(t *testing.T) {
	epm := NewExitPlanModeTool(nil)
	assert.Equal(t, "ExitPlanMode", epm.Name())
	assert.False(t, epm.IsConcurrentSafe())
	assert.NotEmpty(t, epm.Description())
	assert.True(t, json.Valid(epm.InputSchema()))
}

func TestExitPlanModeTool_NoCallback(t *testing.T) {
	epm := NewExitPlanModeTool(nil)
	result, err := epm.Execute(context.Background(), json.RawMessage(`{}`))
	require.NoError(t, err)
	assert.True(t, result.IsError)
	assert.Contains(t, result.Content, "not available")
}

func TestEnterPlanModeTool_NameAndSchema(t *testing.T) {
	epm := NewEnterPlanModeTool(nil)
	assert.Equal(t, "EnterPlanMode", epm.Name())
	assert.False(t, epm.IsConcurrentSafe())
	assert.NotEmpty(t, epm.Description())
	assert.True(t, json.Valid(epm.InputSchema()))
}

func TestEnterPlanModeTool_NoCallback(t *testing.T) {
	epm := NewEnterPlanModeTool(nil)
	result, err := epm.Execute(context.Background(), json.RawMessage(`{}`))
	require.NoError(t, err)
	assert.True(t, result.IsError)
	assert.Contains(t, result.Content, "not available")
}

// --- RegisterAllWithCallbacks tests ---

func TestRegisterAllWithCallbacks(t *testing.T) {
	reg := tool.NewRegistry()
	RegisterAllWithCallbacks(reg, "/tmp", nil)

	// Should have all original tools + new ones
	assert.NotNil(t, reg.Get("Bash"))
	assert.NotNil(t, reg.Get("Read"))
	assert.NotNil(t, reg.Get("Write"))
	assert.NotNil(t, reg.Get("Edit"))
	assert.NotNil(t, reg.Get("Glob"))
	assert.NotNil(t, reg.Get("Grep"))
	assert.NotNil(t, reg.Get("WebFetch"))
	assert.NotNil(t, reg.Get("WebSearch"))
	assert.NotNil(t, reg.Get("TodoWrite"))
	assert.NotNil(t, reg.Get("AskUserQuestion"))
	assert.NotNil(t, reg.Get("ExitPlanMode"))
	assert.NotNil(t, reg.Get("EnterPlanMode"))
	assert.Equal(t, 12, reg.Count())
}

func TestRegisterAll_BackwardsCompat(t *testing.T) {
	// RegisterAll (without callbacks) should register all tools with nil callbacks
	reg := tool.NewRegistry()
	RegisterAll(reg, "/tmp")
	assert.Equal(t, 12, reg.Count())
}

// --- stripHTML tests ---

func TestStripHTML_Basic(t *testing.T) {
	html := "<html><body><p>Hello world</p></body></html>"
	text := stripHTML(html)
	assert.Contains(t, text, "Hello world")
	assert.NotContains(t, text, "<")
}

func TestStripHTML_Scripts(t *testing.T) {
	html := "<p>text</p><script>alert('xss')</script><p>more</p>"
	text := stripHTML(html)
	assert.Contains(t, text, "text")
	assert.Contains(t, text, "more")
	assert.NotContains(t, text, "alert")
}

func TestStripHTML_Styles(t *testing.T) {
	html := "<style>.foo{color:red}</style><p>content</p>"
	text := stripHTML(html)
	assert.Contains(t, text, "content")
	assert.NotContains(t, text, "color")
}
