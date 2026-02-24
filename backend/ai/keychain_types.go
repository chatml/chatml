package ai

// claudeCodeCredentials represents the JSON structure stored in the OS credential store
// under the "Claude Code-credentials" service.
type claudeCodeCredentials struct {
	ClaudeAiOAuth *claudeOAuth `json:"claudeAiOauth"`
}

type claudeOAuth struct {
	AccessToken string `json:"accessToken"`
	ExpiresAt   int64  `json:"expiresAt"` // Unix milliseconds
}
