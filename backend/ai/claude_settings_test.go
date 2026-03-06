package ai

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// ---------------------------------------------------------------------------
// ReadClaudeCodeSettings tests
// ---------------------------------------------------------------------------

func TestReadClaudeCodeSettings_ValidBedrock(t *testing.T) {
	dir := t.TempDir()
	claudeDir := filepath.Join(dir, ".claude")
	require.NoError(t, os.MkdirAll(claudeDir, 0o700))

	settings := `{
		"awsAuthRefresh": "aws sso login --profile core-dev",
		"env": {
			"AWS_PROFILE": "core-dev",
			"CLAUDE_CODE_USE_BEDROCK": "true",
			"ANTHROPIC_DEFAULT_SONNET_MODEL": "arn:aws:bedrock:us-east-1:123456:application-inference-profile/abc123"
		},
		"permissions": {"allow": ["Bash(git:*)"]},
		"model": "opus"
	}`
	require.NoError(t, os.WriteFile(filepath.Join(claudeDir, "settings.json"), []byte(settings), 0o600))

	t.Setenv("HOME", dir)

	s, err := ReadClaudeCodeSettings()
	require.NoError(t, err)
	require.NotNil(t, s)

	assert.Equal(t, "aws sso login --profile core-dev", s.AwsAuthRefresh)
	assert.Equal(t, "core-dev", s.Env["AWS_PROFILE"])
	assert.Equal(t, "true", s.Env["CLAUDE_CODE_USE_BEDROCK"])
	assert.Contains(t, s.Env["ANTHROPIC_DEFAULT_SONNET_MODEL"], "arn:aws:bedrock:")
}

func TestReadClaudeCodeSettings_MissingFile(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("HOME", dir)

	s, err := ReadClaudeCodeSettings()
	assert.NoError(t, err)
	assert.Nil(t, s) // nil, not error — file is optional
}

func TestReadClaudeCodeSettings_MissingClaudeDir(t *testing.T) {
	// HOME exists but ~/.claude/ directory doesn't
	dir := t.TempDir()
	t.Setenv("HOME", dir)

	s, err := ReadClaudeCodeSettings()
	assert.NoError(t, err)
	assert.Nil(t, s)
}

func TestReadClaudeCodeSettings_NoBedrock(t *testing.T) {
	dir := t.TempDir()
	claudeDir := filepath.Join(dir, ".claude")
	require.NoError(t, os.MkdirAll(claudeDir, 0o700))

	settings := `{
		"model": "opus",
		"permissions": {"allow": ["Bash(git:*)"]}
	}`
	require.NoError(t, os.WriteFile(filepath.Join(claudeDir, "settings.json"), []byte(settings), 0o600))

	t.Setenv("HOME", dir)

	s, err := ReadClaudeCodeSettings()
	require.NoError(t, err)
	require.NotNil(t, s)
	assert.Empty(t, s.AwsAuthRefresh)
	assert.Nil(t, s.Env)
}

func TestReadClaudeCodeSettings_InvalidJSON(t *testing.T) {
	dir := t.TempDir()
	claudeDir := filepath.Join(dir, ".claude")
	require.NoError(t, os.MkdirAll(claudeDir, 0o700))
	require.NoError(t, os.WriteFile(filepath.Join(claudeDir, "settings.json"), []byte("not-json"), 0o600))

	t.Setenv("HOME", dir)

	_, err := ReadClaudeCodeSettings()
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "parsing Claude settings JSON")
}

func TestReadClaudeCodeSettings_EmptyFile(t *testing.T) {
	dir := t.TempDir()
	claudeDir := filepath.Join(dir, ".claude")
	require.NoError(t, os.MkdirAll(claudeDir, 0o700))
	require.NoError(t, os.WriteFile(filepath.Join(claudeDir, "settings.json"), []byte(""), 0o600))

	t.Setenv("HOME", dir)

	// Empty file is not valid JSON
	_, err := ReadClaudeCodeSettings()
	assert.Error(t, err)
}

func TestReadClaudeCodeSettings_EmptyJSONObject(t *testing.T) {
	dir := t.TempDir()
	claudeDir := filepath.Join(dir, ".claude")
	require.NoError(t, os.MkdirAll(claudeDir, 0o700))
	require.NoError(t, os.WriteFile(filepath.Join(claudeDir, "settings.json"), []byte("{}"), 0o600))

	t.Setenv("HOME", dir)

	s, err := ReadClaudeCodeSettings()
	require.NoError(t, err)
	require.NotNil(t, s)
	assert.Empty(t, s.AwsAuthRefresh)
	assert.Nil(t, s.Env)
}

func TestReadClaudeCodeSettings_OnlyAwsAuthRefresh(t *testing.T) {
	dir := t.TempDir()
	claudeDir := filepath.Join(dir, ".claude")
	require.NoError(t, os.MkdirAll(claudeDir, 0o700))

	settings := `{"awsAuthRefresh": "aws sso login"}`
	require.NoError(t, os.WriteFile(filepath.Join(claudeDir, "settings.json"), []byte(settings), 0o600))

	t.Setenv("HOME", dir)

	s, err := ReadClaudeCodeSettings()
	require.NoError(t, err)
	require.NotNil(t, s)
	assert.Equal(t, "aws sso login", s.AwsAuthRefresh)
	assert.Nil(t, s.Env)
}

func TestReadClaudeCodeSettings_OnlyEnv(t *testing.T) {
	dir := t.TempDir()
	claudeDir := filepath.Join(dir, ".claude")
	require.NoError(t, os.MkdirAll(claudeDir, 0o700))

	settings := `{"env": {"FOO": "bar"}}`
	require.NoError(t, os.WriteFile(filepath.Join(claudeDir, "settings.json"), []byte(settings), 0o600))

	t.Setenv("HOME", dir)

	s, err := ReadClaudeCodeSettings()
	require.NoError(t, err)
	require.NotNil(t, s)
	assert.Empty(t, s.AwsAuthRefresh)
	assert.Equal(t, "bar", s.Env["FOO"])
}

func TestReadClaudeCodeSettings_FullRealWorldBedrock(t *testing.T) {
	dir := t.TempDir()
	claudeDir := filepath.Join(dir, ".claude")
	require.NoError(t, os.MkdirAll(claudeDir, 0o700))

	// Realistic settings matching the customer's setup
	settings := `{
		"awsAuthRefresh": "aws sso login --profile core-dev",
		"env": {
			"AWS_PROFILE": "core-dev",
			"CLAUDE_CODE_USE_BEDROCK": "true",
			"ANTHROPIC_DEFAULT_OPUS_MODEL": "arn:aws:bedrock:us-east-1:451348473281:application-inference-profile/6atmd50rvy0c",
			"ANTHROPIC_DEFAULT_SONNET_MODEL": "arn:aws:bedrock:us-east-1:451348473281:application-inference-profile/7btne61swz1d",
			"ANTHROPIC_DEFAULT_HAIKU_MODEL": "arn:aws:bedrock:us-east-1:451348473281:application-inference-profile/8cuof72txa2e"
		},
		"permissions": {
			"allow": ["Bash(git:*)", "Read", "Write"],
			"deny": ["Bash(rm -rf:*)"]
		},
		"model": "opus",
		"plugins": ["@anthropic-ai/claude-code-memory"]
	}`
	require.NoError(t, os.WriteFile(filepath.Join(claudeDir, "settings.json"), []byte(settings), 0o600))

	t.Setenv("HOME", dir)

	s, err := ReadClaudeCodeSettings()
	require.NoError(t, err)
	require.NotNil(t, s)

	// Verify all Bedrock-related env vars
	assert.Equal(t, "aws sso login --profile core-dev", s.AwsAuthRefresh)
	assert.Equal(t, "core-dev", s.Env["AWS_PROFILE"])
	assert.Equal(t, "true", s.Env["CLAUDE_CODE_USE_BEDROCK"])

	// Verify all three model ARNs
	assert.Contains(t, s.Env["ANTHROPIC_DEFAULT_OPUS_MODEL"], "application-inference-profile/6atmd50rvy0c")
	assert.Contains(t, s.Env["ANTHROPIC_DEFAULT_SONNET_MODEL"], "application-inference-profile/7btne61swz1d")
	assert.Contains(t, s.Env["ANTHROPIC_DEFAULT_HAIKU_MODEL"], "application-inference-profile/8cuof72txa2e")

	// Extra fields (permissions, model, plugins) are ignored by our struct
	assert.Len(t, s.Env, 5) // only 5 env vars
}

func TestReadClaudeCodeSettings_EmptyEnvMap(t *testing.T) {
	dir := t.TempDir()
	claudeDir := filepath.Join(dir, ".claude")
	require.NoError(t, os.MkdirAll(claudeDir, 0o700))

	settings := `{"env": {}}`
	require.NoError(t, os.WriteFile(filepath.Join(claudeDir, "settings.json"), []byte(settings), 0o600))

	t.Setenv("HOME", dir)

	s, err := ReadClaudeCodeSettings()
	require.NoError(t, err)
	require.NotNil(t, s)
	assert.NotNil(t, s.Env) // empty map, not nil
	assert.Len(t, s.Env, 0)
}

func TestReadClaudeCodeSettings_EnvWithSpecialCharacters(t *testing.T) {
	dir := t.TempDir()
	claudeDir := filepath.Join(dir, ".claude")
	require.NoError(t, os.MkdirAll(claudeDir, 0o700))

	settings := `{
		"env": {
			"COMPLEX_VAR": "value with spaces and = signs",
			"PATH_VAR": "/usr/local/bin:/usr/bin",
			"QUOTED_VAR": "he said \"hello\""
		}
	}`
	require.NoError(t, os.WriteFile(filepath.Join(claudeDir, "settings.json"), []byte(settings), 0o600))

	t.Setenv("HOME", dir)

	s, err := ReadClaudeCodeSettings()
	require.NoError(t, err)
	require.NotNil(t, s)
	assert.Equal(t, "value with spaces and = signs", s.Env["COMPLEX_VAR"])
	assert.Equal(t, "/usr/local/bin:/usr/bin", s.Env["PATH_VAR"])
	assert.Equal(t, `he said "hello"`, s.Env["QUOTED_VAR"])
}

func TestReadClaudeCodeSettings_TrailingCommaInvalid(t *testing.T) {
	dir := t.TempDir()
	claudeDir := filepath.Join(dir, ".claude")
	require.NoError(t, os.MkdirAll(claudeDir, 0o700))

	// Standard JSON doesn't allow trailing commas
	settings := `{"awsAuthRefresh": "cmd",}`
	require.NoError(t, os.WriteFile(filepath.Join(claudeDir, "settings.json"), []byte(settings), 0o600))

	t.Setenv("HOME", dir)

	_, err := ReadClaudeCodeSettings()
	assert.Error(t, err)
}

// ---------------------------------------------------------------------------
// IsBedRockConfigured tests
// ---------------------------------------------------------------------------

func TestIsBedRockConfigured(t *testing.T) {
	tests := []struct {
		name     string
		settings *ClaudeCodeSettings
		want     bool
	}{
		{"nil settings", nil, false},
		{"nil env", &ClaudeCodeSettings{}, false},
		{"empty env", &ClaudeCodeSettings{Env: map[string]string{}}, false},
		{"bedrock false", &ClaudeCodeSettings{Env: map[string]string{"CLAUDE_CODE_USE_BEDROCK": "false"}}, false},
		{"bedrock true", &ClaudeCodeSettings{Env: map[string]string{"CLAUDE_CODE_USE_BEDROCK": "true"}}, true},
		{"bedrock TRUE (case sensitive)", &ClaudeCodeSettings{Env: map[string]string{"CLAUDE_CODE_USE_BEDROCK": "TRUE"}}, false},
		{"bedrock 1", &ClaudeCodeSettings{Env: map[string]string{"CLAUDE_CODE_USE_BEDROCK": "1"}}, false},
		{"bedrock yes", &ClaudeCodeSettings{Env: map[string]string{"CLAUDE_CODE_USE_BEDROCK": "yes"}}, false},
		{"bedrock empty string", &ClaudeCodeSettings{Env: map[string]string{"CLAUDE_CODE_USE_BEDROCK": ""}}, false},
		{"other env vars present but no bedrock flag", &ClaudeCodeSettings{Env: map[string]string{
			"AWS_PROFILE":                   "dev",
			"ANTHROPIC_DEFAULT_SONNET_MODEL": "arn:aws:bedrock:us-east-1:123:model",
		}}, false},
		{"bedrock true with other env vars", &ClaudeCodeSettings{Env: map[string]string{
			"CLAUDE_CODE_USE_BEDROCK": "true",
			"AWS_PROFILE":            "production",
		}}, true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.want, IsBedRockConfigured(tt.settings))
		})
	}
}

// ---------------------------------------------------------------------------
// Integration: ReadClaudeCodeSettings + IsBedRockConfigured
// ---------------------------------------------------------------------------

func TestReadAndCheckBedrock_FullPipeline(t *testing.T) {
	t.Run("bedrock configured", func(t *testing.T) {
		dir := t.TempDir()
		claudeDir := filepath.Join(dir, ".claude")
		require.NoError(t, os.MkdirAll(claudeDir, 0o700))

		settings := `{
			"env": {
				"CLAUDE_CODE_USE_BEDROCK": "true",
				"ANTHROPIC_DEFAULT_SONNET_MODEL": "arn:aws:bedrock:us-east-1:123:application-inference-profile/abc"
			}
		}`
		require.NoError(t, os.WriteFile(filepath.Join(claudeDir, "settings.json"), []byte(settings), 0o600))
		t.Setenv("HOME", dir)

		s, err := ReadClaudeCodeSettings()
		require.NoError(t, err)
		assert.True(t, IsBedRockConfigured(s))
	})

	t.Run("bedrock not configured", func(t *testing.T) {
		dir := t.TempDir()
		claudeDir := filepath.Join(dir, ".claude")
		require.NoError(t, os.MkdirAll(claudeDir, 0o700))

		settings := `{"model": "opus"}`
		require.NoError(t, os.WriteFile(filepath.Join(claudeDir, "settings.json"), []byte(settings), 0o600))
		t.Setenv("HOME", dir)

		s, err := ReadClaudeCodeSettings()
		require.NoError(t, err)
		assert.False(t, IsBedRockConfigured(s))
	})

	t.Run("no settings file", func(t *testing.T) {
		dir := t.TempDir()
		t.Setenv("HOME", dir)

		s, err := ReadClaudeCodeSettings()
		require.NoError(t, err)
		assert.False(t, IsBedRockConfigured(s)) // nil settings → false
	})
}

// ---------------------------------------------------------------------------
// Region extraction from settings env vars (integration test)
// ---------------------------------------------------------------------------

func TestSettingsEnv_ExtractRegionFromModelARN(t *testing.T) {
	dir := t.TempDir()
	claudeDir := filepath.Join(dir, ".claude")
	require.NoError(t, os.MkdirAll(claudeDir, 0o700))

	settings := `{
		"env": {
			"CLAUDE_CODE_USE_BEDROCK": "true",
			"ANTHROPIC_DEFAULT_SONNET_MODEL": "arn:aws:bedrock:eu-west-1:999:application-inference-profile/xyz",
			"ANTHROPIC_DEFAULT_HAIKU_MODEL": "arn:aws:bedrock:eu-west-1:999:application-inference-profile/abc"
		}
	}`
	require.NoError(t, os.WriteFile(filepath.Join(claudeDir, "settings.json"), []byte(settings), 0o600))
	t.Setenv("HOME", dir)

	s, err := ReadClaudeCodeSettings()
	require.NoError(t, err)

	// Verify region can be extracted from model ARN (as manager.go does)
	region := ExtractRegionFromARN(s.Env["ANTHROPIC_DEFAULT_SONNET_MODEL"])
	assert.Equal(t, "eu-west-1", region)

	// Both models should be in the same region
	haikuRegion := ExtractRegionFromARN(s.Env["ANTHROPIC_DEFAULT_HAIKU_MODEL"])
	assert.Equal(t, region, haikuRegion)
}
