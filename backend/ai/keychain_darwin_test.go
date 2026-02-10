package ai

import (
	"encoding/json"
	"fmt"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// ============================================================================
// extractKeychainPassword tests
// ============================================================================

func TestExtractKeychainPassword_ValidOutput(t *testing.T) {
	output := `keychain: "/Users/testuser/Library/Keychains/login.keychain-db"
version: 512
class: "genp"
attributes:
    0x00000007 <blob>="Claude Code-credentials"
    "acct"<blob>="testuser"
    "svce"<blob>="Claude Code-credentials"
password: "{"claudeAiOauth":{"accessToken":"sk-ant-oat01-abc123","expiresAt":1770776037151}}"
`
	result := extractKeychainPassword(output)
	assert.Equal(t, `{"claudeAiOauth":{"accessToken":"sk-ant-oat01-abc123","expiresAt":1770776037151}}`, result)
}

func TestExtractKeychainPassword_NoPasswordLine(t *testing.T) {
	output := `keychain: "/Users/testuser/Library/Keychains/login.keychain-db"
version: 512
class: "genp"
attributes:
    0x00000007 <blob>="Claude Code-credentials"
`
	result := extractKeychainPassword(output)
	assert.Empty(t, result)
}

func TestExtractKeychainPassword_EmptyOutput(t *testing.T) {
	result := extractKeychainPassword("")
	assert.Empty(t, result)
}

func TestExtractKeychainPassword_PasswordWithoutQuotes(t *testing.T) {
	output := `password: 0x7B22636C61756465416F41757468223A7B7D7D`
	result := extractKeychainPassword(output)
	assert.Equal(t, "0x7B22636C61756465416F41757468223A7B7D7D", result)
}

func TestExtractKeychainPassword_PasswordLineWithLeadingWhitespace(t *testing.T) {
	output := `attributes:
    "svce"<blob>="Claude Code-credentials"
  password: "{"key":"value"}"
`
	result := extractKeychainPassword(output)
	assert.Equal(t, `{"key":"value"}`, result)
}

func TestExtractKeychainPassword_EmptyQuotedPassword(t *testing.T) {
	output := `password: ""`
	result := extractKeychainPassword(output)
	assert.Empty(t, result)
}

func TestExtractKeychainPassword_ComplexNestedJSON(t *testing.T) {
	output := `password: "{"claudeAiOauth":{"accessToken":"sk-ant-oat01-token","refreshToken":"sk-ant-ort01-refresh","expiresAt":1770776037151,"scopes":["user:inference"],"subscriptionType":"max"}}"`
	result := extractKeychainPassword(output)

	var parsed map[string]interface{}
	err := json.Unmarshal([]byte(result), &parsed)
	require.NoError(t, err)
	assert.Contains(t, parsed, "claudeAiOauth")
}

// ============================================================================
// claudeCodeCredentials JSON parsing tests
// ============================================================================

func TestCredentialsParsing_ValidFull(t *testing.T) {
	jsonStr := `{
		"claudeAiOauth": {
			"accessToken": "sk-ant-oat01-test-token-abc123",
			"refreshToken": "sk-ant-ort01-refresh-xyz789",
			"expiresAt": 1770776037151,
			"scopes": ["user:inference", "user:profile"],
			"subscriptionType": "max"
		},
		"mcpOAuth": {}
	}`

	var creds claudeCodeCredentials
	err := json.Unmarshal([]byte(jsonStr), &creds)
	require.NoError(t, err)
	require.NotNil(t, creds.ClaudeAiOAuth)
	assert.Equal(t, "sk-ant-oat01-test-token-abc123", creds.ClaudeAiOAuth.AccessToken)
	assert.Equal(t, int64(1770776037151), creds.ClaudeAiOAuth.ExpiresAt)
}

func TestCredentialsParsing_MinimalFields(t *testing.T) {
	jsonStr := `{"claudeAiOauth": {"accessToken": "test-token", "expiresAt": 0}}`

	var creds claudeCodeCredentials
	err := json.Unmarshal([]byte(jsonStr), &creds)
	require.NoError(t, err)
	require.NotNil(t, creds.ClaudeAiOAuth)
	assert.Equal(t, "test-token", creds.ClaudeAiOAuth.AccessToken)
	assert.Equal(t, int64(0), creds.ClaudeAiOAuth.ExpiresAt)
}

func TestCredentialsParsing_MissingClaudeAiOAuth(t *testing.T) {
	jsonStr := `{"mcpOAuth": {}}`

	var creds claudeCodeCredentials
	err := json.Unmarshal([]byte(jsonStr), &creds)
	require.NoError(t, err)
	assert.Nil(t, creds.ClaudeAiOAuth)
}

func TestCredentialsParsing_NullClaudeAiOAuth(t *testing.T) {
	jsonStr := `{"claudeAiOauth": null}`

	var creds claudeCodeCredentials
	err := json.Unmarshal([]byte(jsonStr), &creds)
	require.NoError(t, err)
	assert.Nil(t, creds.ClaudeAiOAuth)
}

func TestCredentialsParsing_EmptyAccessToken(t *testing.T) {
	jsonStr := `{"claudeAiOauth": {"accessToken": "", "expiresAt": 1770776037151}}`

	var creds claudeCodeCredentials
	err := json.Unmarshal([]byte(jsonStr), &creds)
	require.NoError(t, err)
	require.NotNil(t, creds.ClaudeAiOAuth)
	assert.Empty(t, creds.ClaudeAiOAuth.AccessToken)
}

func TestCredentialsParsing_InvalidJSON(t *testing.T) {
	var creds claudeCodeCredentials
	err := json.Unmarshal([]byte("not json"), &creds)
	assert.Error(t, err)
}

func TestCredentialsParsing_ExtraFieldsIgnored(t *testing.T) {
	jsonStr := `{
		"claudeAiOauth": {
			"accessToken": "token",
			"expiresAt": 1000,
			"refreshToken": "refresh",
			"scopes": ["user:inference"],
			"subscriptionType": "max",
			"rateLimitTier": "default_claude_max_20x"
		},
		"mcpOAuth": {"linear|abc": {"serverName": "linear"}}
	}`

	var creds claudeCodeCredentials
	err := json.Unmarshal([]byte(jsonStr), &creds)
	require.NoError(t, err)
	assert.Equal(t, "token", creds.ClaudeAiOAuth.AccessToken)
}

func TestCredentialsParsing_RealWorldStructure(t *testing.T) {
	futureMs := time.Now().Add(24 * time.Hour).UnixMilli()
	jsonStr := fmt.Sprintf(`{
		"claudeAiOauth": {
			"accessToken": "sk-ant-oat01-k7-4gjpFXlUkIR1xay-_cuj6Joy9zswYN8Oka47bl0f",
			"refreshToken": "sk-ant-ort01-BQNHb6wnEKO2w2iW7z-xZ1dYkoeySVOURETBjtC",
			"expiresAt": %d,
			"scopes": ["user:inference", "user:mcp_servers", "user:profile", "user:sessions:claude_code"],
			"subscriptionType": "max",
			"rateLimitTier": "default_claude_max_20x"
		},
		"mcpOAuth": {
			"linear|638130d5ab3558f4": {
				"serverName": "linear",
				"serverUrl": "https://mcp.linear.app/mcp",
				"clientId": "Ad4rHyB9lGY2JdKE",
				"accessToken": "some-linear-token",
				"expiresAt": 1771353133778,
				"refreshToken": "some-refresh",
				"scope": ""
			}
		}
	}`, futureMs)

	var creds claudeCodeCredentials
	err := json.Unmarshal([]byte(jsonStr), &creds)
	require.NoError(t, err)
	require.NotNil(t, creds.ClaudeAiOAuth)
	assert.Contains(t, creds.ClaudeAiOAuth.AccessToken, "sk-ant-oat01-")
	assert.Equal(t, futureMs, creds.ClaudeAiOAuth.ExpiresAt)
}

// ============================================================================
// Token expiration logic tests
// ============================================================================

func TestTokenExpiration_NotExpired(t *testing.T) {
	futureMs := time.Now().Add(1 * time.Hour).UnixMilli()
	expiresAt := time.UnixMilli(futureMs)
	assert.True(t, time.Now().Before(expiresAt), "token should not be expired yet")
}

func TestTokenExpiration_Expired(t *testing.T) {
	pastMs := time.Now().Add(-1 * time.Hour).UnixMilli()
	expiresAt := time.UnixMilli(pastMs)
	assert.True(t, time.Now().After(expiresAt), "token should be expired")
}

func TestTokenExpiration_ZeroMeansNoExpiry(t *testing.T) {
	expiresAt := int64(0)
	assert.False(t, expiresAt > 0, "zero expiresAt should skip expiry check")
}

// ============================================================================
// End-to-end credential validation (without keychain access)
// ============================================================================

// validateCredentialJSON mimics the core parsing+validation logic of
// ReadClaudeCodeOAuthToken, but takes raw JSON instead of reading the keychain.
func validateCredentialJSON(password string) (string, error) {
	var creds claudeCodeCredentials
	if err := json.Unmarshal([]byte(password), &creds); err != nil {
		return "", fmt.Errorf("parsing credentials JSON: %w", err)
	}
	if creds.ClaudeAiOAuth == nil {
		return "", fmt.Errorf("no claudeAiOauth field in credentials")
	}
	if creds.ClaudeAiOAuth.AccessToken == "" {
		return "", fmt.Errorf("empty access token in credentials")
	}
	if creds.ClaudeAiOAuth.ExpiresAt > 0 {
		expiresAt := time.UnixMilli(creds.ClaudeAiOAuth.ExpiresAt)
		if time.Now().After(expiresAt) {
			return "", fmt.Errorf("OAuth token expired at %s", expiresAt.Format(time.RFC3339))
		}
	}
	return creds.ClaudeAiOAuth.AccessToken, nil
}

func TestValidateCredentialJSON_ValidNonExpired(t *testing.T) {
	futureMs := time.Now().Add(1 * time.Hour).UnixMilli()
	jsonStr := fmt.Sprintf(`{"claudeAiOauth":{"accessToken":"sk-ant-oat01-valid","expiresAt":%d}}`, futureMs)

	token, err := validateCredentialJSON(jsonStr)
	require.NoError(t, err)
	assert.Equal(t, "sk-ant-oat01-valid", token)
}

func TestValidateCredentialJSON_Expired(t *testing.T) {
	pastMs := time.Now().Add(-1 * time.Hour).UnixMilli()
	jsonStr := fmt.Sprintf(`{"claudeAiOauth":{"accessToken":"sk-ant-oat01-expired","expiresAt":%d}}`, pastMs)

	_, err := validateCredentialJSON(jsonStr)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "expired")
}

func TestValidateCredentialJSON_NoExpirySet(t *testing.T) {
	jsonStr := `{"claudeAiOauth":{"accessToken":"sk-ant-oat01-no-expiry","expiresAt":0}}`

	token, err := validateCredentialJSON(jsonStr)
	require.NoError(t, err)
	assert.Equal(t, "sk-ant-oat01-no-expiry", token)
}

func TestValidateCredentialJSON_MissingOAuthField(t *testing.T) {
	_, err := validateCredentialJSON(`{"mcpOAuth":{}}`)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "no claudeAiOauth")
}

func TestValidateCredentialJSON_EmptyToken(t *testing.T) {
	_, err := validateCredentialJSON(`{"claudeAiOauth":{"accessToken":"","expiresAt":0}}`)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "empty access token")
}

func TestValidateCredentialJSON_InvalidJSON(t *testing.T) {
	_, err := validateCredentialJSON("not-json")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "parsing credentials JSON")
}

func TestValidateCredentialJSON_JustBarelyCurrent(t *testing.T) {
	// Token expires 1 second from now — should still be valid
	nearFutureMs := time.Now().Add(1 * time.Second).UnixMilli()
	jsonStr := fmt.Sprintf(`{"claudeAiOauth":{"accessToken":"sk-ant-oat01-almost","expiresAt":%d}}`, nearFutureMs)

	token, err := validateCredentialJSON(jsonStr)
	require.NoError(t, err)
	assert.Equal(t, "sk-ant-oat01-almost", token)
}

func TestValidateCredentialJSON_JustBarelyExpired(t *testing.T) {
	// Token expired 1 millisecond ago — should be rejected
	justPastMs := time.Now().Add(-1 * time.Millisecond).UnixMilli()
	jsonStr := fmt.Sprintf(`{"claudeAiOauth":{"accessToken":"sk-ant-oat01-stale","expiresAt":%d}}`, justPastMs)

	_, err := validateCredentialJSON(jsonStr)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "expired")
}

// ============================================================================
// Full pipeline: extractKeychainPassword → validateCredentialJSON
// ============================================================================

func TestFullPipeline_ExtractAndValidate(t *testing.T) {
	futureMs := time.Now().Add(1 * time.Hour).UnixMilli()

	// Simulate security command output
	keychainOutput := fmt.Sprintf(`keychain: "/Users/testuser/Library/Keychains/login.keychain-db"
version: 512
class: "genp"
attributes:
    0x00000007 <blob>="Claude Code-credentials"
    "acct"<blob>="testuser"
password: "{"claudeAiOauth":{"accessToken":"sk-ant-oat01-pipeline-test","expiresAt":%d}}"`, futureMs)

	password := extractKeychainPassword(keychainOutput)
	require.NotEmpty(t, password)

	token, err := validateCredentialJSON(password)
	require.NoError(t, err)
	assert.Equal(t, "sk-ant-oat01-pipeline-test", token)
}

func TestFullPipeline_ExtractAndValidate_ExpiredToken(t *testing.T) {
	pastMs := time.Now().Add(-1 * time.Hour).UnixMilli()

	keychainOutput := fmt.Sprintf(`password: "{"claudeAiOauth":{"accessToken":"sk-ant-oat01-old","expiresAt":%d}}"`, pastMs)

	password := extractKeychainPassword(keychainOutput)
	require.NotEmpty(t, password)

	_, err := validateCredentialJSON(password)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "expired")
}

func TestFullPipeline_NoPassword(t *testing.T) {
	keychainOutput := `keychain: "/Users/testuser/Library/Keychains/login.keychain-db"
attributes:
    "svce"<blob>="Claude Code-credentials"`

	password := extractKeychainPassword(keychainOutput)
	assert.Empty(t, password)
}
