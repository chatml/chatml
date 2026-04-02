package ai

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestReadClaudeCodeCredentialsFile_ValidNonExpired(t *testing.T) {
	dir := t.TempDir()
	claudeDir := filepath.Join(dir, ".claude")
	require.NoError(t, os.MkdirAll(claudeDir, 0o700))

	futureMs := time.Now().Add(1 * time.Hour).UnixMilli()
	creds := fmt.Sprintf(`{"claudeAiOauth":{"accessToken":"sk-ant-oat01-valid","expiresAt":%d}}`, futureMs)
	require.NoError(t, os.WriteFile(filepath.Join(claudeDir, ".credentials.json"), []byte(creds), 0o600))

	// Override HOME so ReadClaudeCodeCredentialsFile resolves to our temp dir
	t.Setenv("HOME", dir)

	token, err := ReadClaudeCodeCredentialsFile()
	require.NoError(t, err)
	assert.Equal(t, "sk-ant-oat01-valid", token)
}

func TestReadClaudeCodeCredentialsFile_Expired(t *testing.T) {
	dir := t.TempDir()
	claudeDir := filepath.Join(dir, ".claude")
	require.NoError(t, os.MkdirAll(claudeDir, 0o700))

	pastMs := time.Now().Add(-1 * time.Hour).UnixMilli()
	creds := fmt.Sprintf(`{"claudeAiOauth":{"accessToken":"sk-ant-oat01-expired","expiresAt":%d}}`, pastMs)
	require.NoError(t, os.WriteFile(filepath.Join(claudeDir, ".credentials.json"), []byte(creds), 0o600))

	t.Setenv("HOME", dir)

	_, err := ReadClaudeCodeCredentialsFile()
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "expired")
}

func TestReadClaudeCodeCredentialsFile_MissingFile(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("HOME", dir)

	_, err := ReadClaudeCodeCredentialsFile()
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "no credentials file found")
}

func TestReadClaudeCodeCredentialsFile_InvalidJSON(t *testing.T) {
	dir := t.TempDir()
	claudeDir := filepath.Join(dir, ".claude")
	require.NoError(t, os.MkdirAll(claudeDir, 0o700))
	require.NoError(t, os.WriteFile(filepath.Join(claudeDir, ".credentials.json"), []byte("not-json"), 0o600))

	t.Setenv("HOME", dir)

	_, err := ReadClaudeCodeCredentialsFile()
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "parsing credentials JSON")
}

func TestReadClaudeCodeCredentialsFile_MissingOAuthField(t *testing.T) {
	dir := t.TempDir()
	claudeDir := filepath.Join(dir, ".claude")
	require.NoError(t, os.MkdirAll(claudeDir, 0o700))
	require.NoError(t, os.WriteFile(filepath.Join(claudeDir, ".credentials.json"), []byte(`{"mcpOAuth":{}}`), 0o600))

	t.Setenv("HOME", dir)

	_, err := ReadClaudeCodeCredentialsFile()
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "no claudeAiOauth")
}

func TestReadClaudeCodeCredentialsFile_EmptyAccessToken(t *testing.T) {
	dir := t.TempDir()
	claudeDir := filepath.Join(dir, ".claude")
	require.NoError(t, os.MkdirAll(claudeDir, 0o700))
	require.NoError(t, os.WriteFile(filepath.Join(claudeDir, ".credentials.json"), []byte(`{"claudeAiOauth":{"accessToken":"","expiresAt":0}}`), 0o600))

	t.Setenv("HOME", dir)

	_, err := ReadClaudeCodeCredentialsFile()
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "empty access token")
}

func TestReadClaudeCodeCredentialsFile_ZeroExpiryMeansNoExpiry(t *testing.T) {
	dir := t.TempDir()
	claudeDir := filepath.Join(dir, ".claude")
	require.NoError(t, os.MkdirAll(claudeDir, 0o700))
	require.NoError(t, os.WriteFile(filepath.Join(claudeDir, ".credentials.json"), []byte(`{"claudeAiOauth":{"accessToken":"sk-ant-oat01-no-expiry","expiresAt":0}}`), 0o600))

	t.Setenv("HOME", dir)

	token, err := ReadClaudeCodeCredentialsFile()
	require.NoError(t, err)
	assert.Equal(t, "sk-ant-oat01-no-expiry", token)
}

func TestReadClaudeCodeCredentialsFile_RealWorldStructure(t *testing.T) {
	dir := t.TempDir()
	claudeDir := filepath.Join(dir, ".claude")
	require.NoError(t, os.MkdirAll(claudeDir, 0o700))

	futureMs := time.Now().Add(24 * time.Hour).UnixMilli()
	creds := fmt.Sprintf(`{
		"claudeAiOauth": {
			"accessToken": "sk-ant-oat01-k7-4gjpFXlUkIR1xay",
			"refreshToken": "sk-ant-ort01-BQNHb6wnEKO2w2iW",
			"expiresAt": %d,
			"scopes": ["user:inference", "user:profile"],
			"subscriptionType": "max"
		},
		"mcpOAuth": {}
	}`, futureMs)
	require.NoError(t, os.WriteFile(filepath.Join(claudeDir, ".credentials.json"), []byte(creds), 0o600))

	t.Setenv("HOME", dir)

	token, err := ReadClaudeCodeCredentialsFile()
	require.NoError(t, err)
	assert.Contains(t, token, "sk-ant-oat01-")

	// Verify the JSON structure was parsed correctly
	var parsed claudeCodeCredentials
	require.NoError(t, json.Unmarshal([]byte(creds), &parsed))
	assert.Equal(t, token, parsed.ClaudeAiOAuth.AccessToken)
}
