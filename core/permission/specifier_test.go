package permission

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestBuildSpecifier_Bash(t *testing.T) {
	input := json.RawMessage(`{"command":"npm run build","description":"Build project"}`)
	assert.Equal(t, "npm run build", BuildSpecifier("Bash", input))
}

func TestBuildSpecifier_Read(t *testing.T) {
	input := json.RawMessage(`{"file_path":"/src/main.go","offset":10}`)
	assert.Equal(t, "/src/main.go", BuildSpecifier("Read", input))
}

func TestBuildSpecifier_Write(t *testing.T) {
	input := json.RawMessage(`{"file_path":"/src/output.go","content":"package main"}`)
	assert.Equal(t, "/src/output.go", BuildSpecifier("Write", input))
}

func TestBuildSpecifier_Edit(t *testing.T) {
	input := json.RawMessage(`{"file_path":"app.go","old_string":"foo","new_string":"bar"}`)
	assert.Equal(t, "app.go", BuildSpecifier("Edit", input))
}

func TestBuildSpecifier_NotebookEdit(t *testing.T) {
	input := json.RawMessage(`{"notebook_path":"notebook.ipynb"}`)
	assert.Equal(t, "notebook.ipynb", BuildSpecifier("NotebookEdit", input))
}

func TestBuildSpecifier_WebFetch(t *testing.T) {
	input := json.RawMessage(`{"url":"https://api.example.com/v1/data"}`)
	assert.Equal(t, "domain:api.example.com", BuildSpecifier("WebFetch", input))
}

func TestBuildSpecifier_WebFetch_NoHost(t *testing.T) {
	input := json.RawMessage(`{"url":"not-a-url"}`)
	assert.Equal(t, "", BuildSpecifier("WebFetch", input))
}

func TestBuildSpecifier_WebFetch_EmptyURL(t *testing.T) {
	input := json.RawMessage(`{"url":""}`)
	assert.Equal(t, "", BuildSpecifier("WebFetch", input))
}

func TestBuildSpecifier_Glob(t *testing.T) {
	input := json.RawMessage(`{"pattern":"**/*.go"}`)
	assert.Equal(t, "**/*.go", BuildSpecifier("Glob", input))
}

func TestBuildSpecifier_Grep(t *testing.T) {
	input := json.RawMessage(`{"pattern":"func main","path":"src/"}`)
	assert.Equal(t, "func main", BuildSpecifier("Grep", input))
}

func TestBuildSpecifier_MCP(t *testing.T) {
	input := json.RawMessage(`{"some":"input"}`)
	assert.Equal(t, "mcp__server__tool", BuildSpecifier("mcp__server__tool", input))
}

func TestBuildSpecifier_Unknown(t *testing.T) {
	input := json.RawMessage(`{"anything":"here"}`)
	assert.Equal(t, "", BuildSpecifier("UnknownTool", input))
}

func TestBuildSpecifier_EmptyInput(t *testing.T) {
	assert.Equal(t, "", BuildSpecifier("Bash", json.RawMessage(``)))
	assert.Equal(t, "", BuildSpecifier("Bash", json.RawMessage(`{}`)))
}

func TestBuildSpecifier_InvalidJSON(t *testing.T) {
	assert.Equal(t, "", BuildSpecifier("Bash", json.RawMessage(`{bad`)))
}

func TestBuildSpecifier_MissingField(t *testing.T) {
	input := json.RawMessage(`{"description":"test"}`)
	assert.Equal(t, "", BuildSpecifier("Bash", input))
}
