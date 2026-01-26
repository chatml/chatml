package agents

import (
	"context"
	"fmt"
	"strings"

	"github.com/chatml/chatml-backend/logger"
	"github.com/chatml/chatml-backend/models"
)

// PollingManager coordinates polling adapters for agents
type PollingManager struct {
	config  *Config
	github  *GitHubAdapter
	linear  *LinearAdapter
}

// PollResult holds the unified result of polling
type PollResult struct {
	Source       string        // "github" or "linear"
	HasChanges   bool          // Whether new items were found
	Items        []PollItem    // The items found
	NotModified  bool          // 304 response (no changes)
	Error        error         // Any error that occurred
	RateLimited  bool          // Whether we're rate limited
}

// PollItem represents a single item from any source
type PollItem struct {
	Source      string                 // "github" or "linear"
	Type        string                 // "issue", "pull_request"
	ID          string                 // Unique identifier
	Number      int                    // Issue/PR number (GitHub)
	Identifier  string                 // Human-readable ID (e.g., "ENG-123")
	Title       string
	Description string
	State       string
	URL         string
	Labels      []string
	Assignee    string
	CreatedAt   string
	UpdatedAt   string
	Raw         interface{}            // Original item for detailed access
}

// NewPollingManager creates a new polling manager
func NewPollingManager(config *Config) *PollingManager {
	pm := &PollingManager{
		config: config,
	}

	if config.HasGitHub() {
		pm.github = NewGitHubAdapter(config.GitHubToken)
	}

	if config.HasLinear() {
		pm.linear = NewLinearAdapter(config.LinearAPIKey)
	}

	return pm
}

// Poll executes polling for an agent based on its definition
func (pm *PollingManager) Poll(ctx context.Context, agent *models.OrchestratorAgent) ([]PollResult, error) {
	if agent.Definition == nil || agent.Definition.Polling == nil {
		return nil, fmt.Errorf("agent %s has no polling configuration", agent.ID)
	}

	var results []PollResult

	for _, source := range agent.Definition.Polling.Sources {
		result := pm.pollSource(ctx, source)
		results = append(results, result)
	}

	return results, nil
}

// pollSource polls a single source
func (pm *PollingManager) pollSource(ctx context.Context, source models.AgentPollingSource) PollResult {
	switch source.Type {
	case "github":
		return pm.pollGitHub(ctx, source)
	case "linear":
		return pm.pollLinear(ctx, source)
	default:
		return PollResult{
			Source: source.Type,
			Error:  fmt.Errorf("unknown source type: %s", source.Type),
		}
	}
}

// pollGitHub polls GitHub for issues/PRs
func (pm *PollingManager) pollGitHub(ctx context.Context, source models.AgentPollingSource) PollResult {
	result := PollResult{Source: "github"}

	if pm.github == nil {
		result.Error = fmt.Errorf("GitHub not configured (set GITHUB_TOKEN)")
		return result
	}

	// Resolve template variables (basic implementation)
	owner := resolveTemplate(source.Owner)
	repo := resolveTemplate(source.Repo)

	if owner == "" || repo == "" {
		result.Error = fmt.Errorf("GitHub owner/repo not configured")
		return result
	}

	// Poll GitHub
	ghResult, err := pm.github.Poll(ctx, owner, repo, source.Filters)
	if err != nil {
		result.Error = err
		return result
	}

	result.NotModified = ghResult.NotModified

	if pm.github.IsRateLimited(ghResult.RateLimit) {
		result.RateLimited = true
		logger.Polling.Warnf("GitHub rate limited, reset at %v", ghResult.RateLimit.Reset)
		return result
	}

	// Convert issues to PollItems
	for _, issue := range ghResult.Issues {
		item := PollItem{
			Source:      "github",
			Type:        "issue",
			ID:          fmt.Sprintf("github-issue-%d", issue.Number),
			Number:      issue.Number,
			Identifier:  fmt.Sprintf("#%d", issue.Number),
			Title:       issue.Title,
			Description: issue.Body,
			State:       issue.State,
			URL:         issue.HTMLURL,
			Assignee:    getUserName(issue.Assignees),
			CreatedAt:   issue.CreatedAt.Format("2006-01-02T15:04:05Z"),
			UpdatedAt:   issue.UpdatedAt.Format("2006-01-02T15:04:05Z"),
			Raw:         issue,
		}
		for _, label := range issue.Labels {
			item.Labels = append(item.Labels, label.Name)
		}
		result.Items = append(result.Items, item)
	}

	// Convert PRs to PollItems
	for _, pr := range ghResult.PullRequests {
		item := PollItem{
			Source:      "github",
			Type:        "pull_request",
			ID:          fmt.Sprintf("github-pr-%d", pr.Number),
			Number:      pr.Number,
			Identifier:  fmt.Sprintf("#%d", pr.Number),
			Title:       pr.Title,
			Description: pr.Body,
			State:       pr.State,
			URL:         pr.HTMLURL,
			Assignee:    getUserName(pr.Assignees),
			CreatedAt:   pr.CreatedAt.Format("2006-01-02T15:04:05Z"),
			UpdatedAt:   pr.UpdatedAt.Format("2006-01-02T15:04:05Z"),
			Raw:         pr,
		}
		for _, label := range pr.Labels {
			item.Labels = append(item.Labels, label.Name)
		}
		result.Items = append(result.Items, item)
	}

	result.HasChanges = len(result.Items) > 0
	return result
}

// pollLinear polls Linear for issues
func (pm *PollingManager) pollLinear(ctx context.Context, source models.AgentPollingSource) PollResult {
	result := PollResult{Source: "linear"}

	if pm.linear == nil {
		result.Error = fmt.Errorf("Linear not configured (set LINEAR_API_KEY)")
		return result
	}

	// Poll Linear
	linResult, err := pm.linear.Poll(ctx, source.Filters)
	if err != nil {
		result.Error = err
		return result
	}

	result.NotModified = linResult.NotModified

	// Convert issues to PollItems
	for _, issue := range linResult.Issues {
		item := PollItem{
			Source:      "linear",
			Type:        "issue",
			ID:          fmt.Sprintf("linear-%s", issue.ID),
			Identifier:  issue.Identifier,
			Title:       issue.Title,
			Description: issue.Description,
			State:       issue.State.Name,
			URL:         issue.URL,
			CreatedAt:   issue.CreatedAt.Format("2006-01-02T15:04:05Z"),
			UpdatedAt:   issue.UpdatedAt.Format("2006-01-02T15:04:05Z"),
			Raw:         issue,
		}
		if issue.Assignee != nil {
			item.Assignee = issue.Assignee.Name
		}
		for _, label := range issue.Labels {
			item.Labels = append(item.Labels, label.Name)
		}
		result.Items = append(result.Items, item)
	}

	result.HasChanges = len(result.Items) > 0
	return result
}

// resolveTemplate resolves simple template variables
// For now, just strips the template syntax - full implementation would use workspace context
func resolveTemplate(value string) string {
	// Remove {{ and }} and return the variable name for manual resolution
	value = strings.TrimPrefix(value, "{{")
	value = strings.TrimSuffix(value, "}}")
	value = strings.TrimSpace(value)

	// If it's a template variable, return empty (would need context to resolve)
	if strings.HasPrefix(value, "workspace.") {
		return ""
	}

	return value
}

// getUserName extracts username from assignees
func getUserName(assignees []GitHubUser) string {
	if len(assignees) == 0 {
		return ""
	}
	return assignees[0].Login
}

// HasGitHub returns whether GitHub adapter is available
func (pm *PollingManager) HasGitHub() bool {
	return pm.github != nil
}

// HasLinear returns whether Linear adapter is available
func (pm *PollingManager) HasLinear() bool {
	return pm.linear != nil
}

// UpdateGitHubToken updates the GitHub token
func (pm *PollingManager) UpdateGitHubToken(token string) {
	if token == "" {
		pm.github = nil
		return
	}
	if pm.github == nil {
		pm.github = NewGitHubAdapter(token)
	} else {
		pm.github.SetToken(token)
	}
}

// UpdateLinearAPIKey updates the Linear API key
func (pm *PollingManager) UpdateLinearAPIKey(apiKey string) {
	if apiKey == "" {
		pm.linear = nil
		return
	}
	if pm.linear == nil {
		pm.linear = NewLinearAdapter(apiKey)
	} else {
		pm.linear.SetAPIKey(apiKey)
	}
}
