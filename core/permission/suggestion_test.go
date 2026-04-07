package permission

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestSuggestWildcard_Bash_SingleCommand(t *testing.T) {
	s := SuggestWildcard("Bash", "git")
	assert.NotNil(t, s)
	assert.Equal(t, "git", s.Specifier)
	assert.Contains(t, s.Label, "git")
}

func TestSuggestWildcard_Bash_CommandWithArgs(t *testing.T) {
	s := SuggestWildcard("Bash", "git status")
	assert.NotNil(t, s)
	assert.Equal(t, "git *", s.Specifier)
	assert.Contains(t, s.Label, "git")
}

func TestSuggestWildcard_Bash_NpmRun(t *testing.T) {
	s := SuggestWildcard("Bash", "npm run build")
	assert.NotNil(t, s)
	assert.Equal(t, "npm *", s.Specifier)
	assert.Contains(t, s.Label, "npm")
}

func TestSuggestWildcard_Bash_Curl(t *testing.T) {
	s := SuggestWildcard("Bash", "curl http://example.com")
	assert.NotNil(t, s)
	assert.Equal(t, "curl *", s.Specifier)
	assert.Contains(t, s.Label, "curl")
}

func TestSuggestWildcard_Bash_EmptySpecifier(t *testing.T) {
	s := SuggestWildcard("Bash", "")
	assert.Nil(t, s)
}

func TestSuggestWildcard_Write_FileInDir(t *testing.T) {
	s := SuggestWildcard("Write", "/home/user/project/src/main.go")
	assert.NotNil(t, s)
	assert.Equal(t, "/home/user/project/src/*", s.Specifier)
	assert.Contains(t, s.Label, "src/")
}

func TestSuggestWildcard_Edit_FileInDir(t *testing.T) {
	s := SuggestWildcard("Edit", "src/components/App.tsx")
	assert.NotNil(t, s)
	assert.Equal(t, "src/components/*", s.Specifier)
	assert.Contains(t, s.Label, "components/")
}

func TestSuggestWildcard_Write_FileInRoot(t *testing.T) {
	s := SuggestWildcard("Write", "main.go")
	assert.NotNil(t, s)
	assert.Equal(t, "*.go", s.Specifier)
	assert.Contains(t, s.Label, "*.go")
}

func TestSuggestWildcard_Write_FileInRootNoExt(t *testing.T) {
	s := SuggestWildcard("Write", "Makefile")
	assert.Nil(t, s)
}

func TestSuggestWildcard_WebFetch_Domain(t *testing.T) {
	s := SuggestWildcard("WebFetch", "domain:api.example.com")
	assert.NotNil(t, s)
	assert.Equal(t, "domain:api.example.com", s.Specifier)
	assert.Contains(t, s.Label, "api.example.com")
}

func TestSuggestWildcard_UnknownTool(t *testing.T) {
	s := SuggestWildcard("UnknownTool", "anything")
	assert.Nil(t, s)
}

func TestSuggestWildcard_EmptySpecifier(t *testing.T) {
	s := SuggestWildcard("Write", "")
	assert.Nil(t, s)
}
