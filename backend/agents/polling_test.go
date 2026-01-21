package agents

import (
	"context"
	"testing"

	"github.com/chatml/chatml-backend/models"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestNewPollingManager(t *testing.T) {
	config := &Config{}
	pm := NewPollingManager(config)

	assert.NotNil(t, pm)
	assert.Equal(t, config, pm.config)
	assert.Nil(t, pm.github) // Not configured
	assert.Nil(t, pm.linear) // Not configured
}

func TestNewPollingManager_WithGitHub(t *testing.T) {
	config := &Config{
		GitHubToken: "test-token",
	}
	pm := NewPollingManager(config)

	assert.NotNil(t, pm)
	assert.NotNil(t, pm.github)
	assert.Nil(t, pm.linear)
}

func TestNewPollingManager_WithLinear(t *testing.T) {
	config := &Config{
		LinearAPIKey: "test-api-key",
	}
	pm := NewPollingManager(config)

	assert.NotNil(t, pm)
	assert.Nil(t, pm.github)
	assert.NotNil(t, pm.linear)
}

func TestNewPollingManager_WithBoth(t *testing.T) {
	config := &Config{
		GitHubToken:  "test-github-token",
		LinearAPIKey: "test-linear-key",
	}
	pm := NewPollingManager(config)

	assert.NotNil(t, pm)
	assert.NotNil(t, pm.github)
	assert.NotNil(t, pm.linear)
}

func TestPollingManager_HasGitHub(t *testing.T) {
	config := &Config{}
	pm := NewPollingManager(config)
	assert.False(t, pm.HasGitHub())

	config = &Config{GitHubToken: "token"}
	pm = NewPollingManager(config)
	assert.True(t, pm.HasGitHub())
}

func TestPollingManager_HasLinear(t *testing.T) {
	config := &Config{}
	pm := NewPollingManager(config)
	assert.False(t, pm.HasLinear())

	config = &Config{LinearAPIKey: "key"}
	pm = NewPollingManager(config)
	assert.True(t, pm.HasLinear())
}

func TestPollingManager_Poll_NoConfig(t *testing.T) {
	config := &Config{}
	pm := NewPollingManager(config)

	// Agent without polling config
	agent := &models.OrchestratorAgent{
		ID: "test-agent",
	}

	_, err := pm.Poll(context.Background(), agent)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "no polling configuration")
}

func TestPollingManager_Poll_NilDefinition(t *testing.T) {
	config := &Config{}
	pm := NewPollingManager(config)

	agent := &models.OrchestratorAgent{
		ID:         "test-agent",
		Definition: nil,
	}

	_, err := pm.Poll(context.Background(), agent)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "no polling configuration")
}

func TestPollingManager_Poll_NilPolling(t *testing.T) {
	config := &Config{}
	pm := NewPollingManager(config)

	agent := &models.OrchestratorAgent{
		ID: "test-agent",
		Definition: &models.AgentDefinition{
			Polling: nil,
		},
	}

	_, err := pm.Poll(context.Background(), agent)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "no polling configuration")
}

func TestPollingManager_Poll_UnknownSource(t *testing.T) {
	config := &Config{}
	pm := NewPollingManager(config)

	agent := &models.OrchestratorAgent{
		ID: "test-agent",
		Definition: &models.AgentDefinition{
			Polling: &models.AgentPolling{
				Sources: []models.AgentPollingSource{
					{Type: "unknown-source"},
				},
			},
		},
	}

	results, err := pm.Poll(context.Background(), agent)
	require.NoError(t, err)
	require.Len(t, results, 1)
	assert.Equal(t, "unknown-source", results[0].Source)
	assert.NotNil(t, results[0].Error)
	assert.Contains(t, results[0].Error.Error(), "unknown source type")
}

func TestPollingManager_Poll_GitHubNotConfigured(t *testing.T) {
	config := &Config{} // No GitHub token
	pm := NewPollingManager(config)

	agent := &models.OrchestratorAgent{
		ID: "test-agent",
		Definition: &models.AgentDefinition{
			Polling: &models.AgentPolling{
				Sources: []models.AgentPollingSource{
					{Type: "github", Owner: "test", Repo: "repo"},
				},
			},
		},
	}

	results, err := pm.Poll(context.Background(), agent)
	require.NoError(t, err)
	require.Len(t, results, 1)
	assert.Equal(t, "github", results[0].Source)
	assert.NotNil(t, results[0].Error)
	assert.Contains(t, results[0].Error.Error(), "GitHub not configured")
}

func TestPollingManager_Poll_LinearNotConfigured(t *testing.T) {
	config := &Config{} // No Linear API key
	pm := NewPollingManager(config)

	agent := &models.OrchestratorAgent{
		ID: "test-agent",
		Definition: &models.AgentDefinition{
			Polling: &models.AgentPolling{
				Sources: []models.AgentPollingSource{
					{Type: "linear"},
				},
			},
		},
	}

	results, err := pm.Poll(context.Background(), agent)
	require.NoError(t, err)
	require.Len(t, results, 1)
	assert.Equal(t, "linear", results[0].Source)
	assert.NotNil(t, results[0].Error)
	assert.Contains(t, results[0].Error.Error(), "Linear not configured")
}

func TestPollingManager_Poll_MultipleSources(t *testing.T) {
	config := &Config{} // Neither configured
	pm := NewPollingManager(config)

	agent := &models.OrchestratorAgent{
		ID: "test-agent",
		Definition: &models.AgentDefinition{
			Polling: &models.AgentPolling{
				Sources: []models.AgentPollingSource{
					{Type: "github", Owner: "test", Repo: "repo"},
					{Type: "linear"},
				},
			},
		},
	}

	results, err := pm.Poll(context.Background(), agent)
	require.NoError(t, err)
	assert.Len(t, results, 2)

	// Both should have errors since neither is configured
	for _, result := range results {
		assert.NotNil(t, result.Error)
	}
}

func TestPollingManager_UpdateGitHubToken(t *testing.T) {
	config := &Config{}
	pm := NewPollingManager(config)

	assert.False(t, pm.HasGitHub())

	// Add token
	pm.UpdateGitHubToken("new-token")
	assert.True(t, pm.HasGitHub())

	// Update existing
	pm.UpdateGitHubToken("updated-token")
	assert.True(t, pm.HasGitHub())

	// Remove token
	pm.UpdateGitHubToken("")
	assert.False(t, pm.HasGitHub())
}

func TestPollingManager_UpdateLinearAPIKey(t *testing.T) {
	config := &Config{}
	pm := NewPollingManager(config)

	assert.False(t, pm.HasLinear())

	// Add key
	pm.UpdateLinearAPIKey("new-key")
	assert.True(t, pm.HasLinear())

	// Update existing
	pm.UpdateLinearAPIKey("updated-key")
	assert.True(t, pm.HasLinear())

	// Remove key
	pm.UpdateLinearAPIKey("")
	assert.False(t, pm.HasLinear())
}

func TestResolveTemplate(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected string
	}{
		{"plain value", "test-value", "test-value"},
		{"empty string", "", ""},
		{"template variable", "{{ workspace.owner }}", ""},
		{"template with spaces", "{{  workspace.repo  }}", ""},
		{"partial template", "{{ partial", "partial"},
		{"workspace prefix only", "workspace.test", ""},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := resolveTemplate(tt.input)
			assert.Equal(t, tt.expected, result)
		})
	}
}

func TestGetUserName(t *testing.T) {
	// Empty assignees
	result := getUserName(nil)
	assert.Empty(t, result)

	result = getUserName([]GitHubUser{})
	assert.Empty(t, result)

	// With assignees
	result = getUserName([]GitHubUser{
		{Login: "user1"},
		{Login: "user2"},
	})
	assert.Equal(t, "user1", result)
}

func TestPollResult_Fields(t *testing.T) {
	result := PollResult{
		Source:      "github",
		HasChanges:  true,
		Items:       []PollItem{{ID: "1"}, {ID: "2"}},
		NotModified: false,
		Error:       nil,
		RateLimited: false,
	}

	assert.Equal(t, "github", result.Source)
	assert.True(t, result.HasChanges)
	assert.Len(t, result.Items, 2)
	assert.False(t, result.NotModified)
	assert.Nil(t, result.Error)
	assert.False(t, result.RateLimited)
}

func TestPollItem_Fields(t *testing.T) {
	item := PollItem{
		Source:      "github",
		Type:        "issue",
		ID:          "github-issue-123",
		Number:      123,
		Identifier:  "#123",
		Title:       "Test Issue",
		Description: "Test description",
		State:       "open",
		URL:         "https://github.com/test/repo/issues/123",
		Labels:      []string{"bug", "help wanted"},
		Assignee:    "testuser",
		CreatedAt:   "2024-01-01T00:00:00Z",
		UpdatedAt:   "2024-01-02T00:00:00Z",
		Raw:         map[string]string{"key": "value"},
	}

	assert.Equal(t, "github", item.Source)
	assert.Equal(t, "issue", item.Type)
	assert.Equal(t, "github-issue-123", item.ID)
	assert.Equal(t, 123, item.Number)
	assert.Equal(t, "#123", item.Identifier)
	assert.Equal(t, "Test Issue", item.Title)
	assert.Equal(t, "Test description", item.Description)
	assert.Equal(t, "open", item.State)
	assert.Equal(t, "https://github.com/test/repo/issues/123", item.URL)
	assert.Equal(t, []string{"bug", "help wanted"}, item.Labels)
	assert.Equal(t, "testuser", item.Assignee)
	assert.NotNil(t, item.Raw)
}
