package agents

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

// LinearAdapter polls Linear for issues
type LinearAdapter struct {
	apiKey     string
	httpClient *http.Client
	cache      *PollingCache
	apiURL     string
}

// LinearIssue represents a Linear issue
type LinearIssue struct {
	ID          string           `json:"id"`
	Identifier  string           `json:"identifier"` // e.g., "ENG-123"
	Title       string           `json:"title"`
	Description string           `json:"description"`
	Priority    int              `json:"priority"`
	State       LinearState      `json:"state"`
	Assignee    *LinearUser      `json:"assignee"`
	Labels      []LinearLabel    `json:"labels"`
	Project     *LinearProject   `json:"project"`
	Team        LinearTeam       `json:"team"`
	URL         string           `json:"url"`
	CreatedAt   time.Time        `json:"createdAt"`
	UpdatedAt   time.Time        `json:"updatedAt"`
}

// LinearState represents an issue state
type LinearState struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Color string `json:"color"`
	Type  string `json:"type"` // backlog, unstarted, started, completed, canceled
}

// LinearUser represents a Linear user
type LinearUser struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Email       string `json:"email"`
	DisplayName string `json:"displayName"`
	AvatarURL   string `json:"avatarUrl"`
}

// LinearLabel represents a Linear label
type LinearLabel struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Color string `json:"color"`
}

// LinearProject represents a Linear project
type LinearProject struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// LinearTeam represents a Linear team
type LinearTeam struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Key  string `json:"key"`
}

// LinearPollResult holds the result of a Linear poll
type LinearPollResult struct {
	Issues      []LinearIssue
	NotModified bool
}

// NewLinearAdapter creates a new Linear polling adapter
func NewLinearAdapter(apiKey string) *LinearAdapter {
	return &LinearAdapter{
		apiKey:     apiKey,
		httpClient: &http.Client{Timeout: 30 * time.Second},
		cache:      NewPollingCache(5 * time.Minute),
		apiURL:     "https://api.linear.app/graphql",
	}
}

// SetAPIKey updates the Linear API key
func (l *LinearAdapter) SetAPIKey(apiKey string) {
	l.apiKey = apiKey
}

// Poll fetches issues from Linear based on filters
func (l *LinearAdapter) Poll(ctx context.Context, filters map[string]interface{}) (*LinearPollResult, error) {
	result := &LinearPollResult{}

	// Build GraphQL query
	query := l.buildIssuesQuery(filters)

	// Execute query
	issues, err := l.executeQuery(ctx, query, filters)
	if err != nil {
		return nil, err
	}

	result.Issues = issues
	return result, nil
}

// buildIssuesQuery constructs the GraphQL query for issues
func (l *LinearAdapter) buildIssuesQuery(filters map[string]interface{}) string {
	return `
		query Issues($filter: IssueFilter, $first: Int) {
			issues(filter: $filter, first: $first, orderBy: updatedAt) {
				nodes {
					id
					identifier
					title
					description
					priority
					url
					createdAt
					updatedAt
					state {
						id
						name
						color
						type
					}
					assignee {
						id
						name
						email
						displayName
						avatarUrl
					}
					labels {
						nodes {
							id
							name
							color
						}
					}
					project {
						id
						name
					}
					team {
						id
						name
						key
					}
				}
			}
		}
	`
}

// executeQuery executes a GraphQL query against Linear
func (l *LinearAdapter) executeQuery(ctx context.Context, query string, filters map[string]interface{}) ([]LinearIssue, error) {
	// Build filter variables
	variables := map[string]interface{}{
		"first": 50,
	}

	// Build issue filter
	issueFilter := make(map[string]interface{})

	// State filter
	if state, ok := filters["state"].(string); ok {
		switch state {
		case "in_progress", "started":
			issueFilter["state"] = map[string]interface{}{
				"type": map[string]interface{}{"eq": "started"},
			}
		case "backlog":
			issueFilter["state"] = map[string]interface{}{
				"type": map[string]interface{}{"eq": "backlog"},
			}
		case "done", "completed":
			issueFilter["state"] = map[string]interface{}{
				"type": map[string]interface{}{"eq": "completed"},
			}
		}
	}

	// Assignee filter
	if assignee, ok := filters["assignee"].(string); ok {
		if assignee == "me" {
			issueFilter["assignee"] = map[string]interface{}{
				"isMe": map[string]interface{}{"eq": true},
			}
		} else {
			issueFilter["assignee"] = map[string]interface{}{
				"email": map[string]interface{}{"eq": assignee},
			}
		}
	}

	// Team filter
	if team, ok := filters["team"].(string); ok {
		issueFilter["team"] = map[string]interface{}{
			"key": map[string]interface{}{"eq": team},
		}
	}

	if len(issueFilter) > 0 {
		variables["filter"] = issueFilter
	}

	// Build request body
	body := map[string]interface{}{
		"query":     query,
		"variables": variables,
	}

	jsonBody, err := json.Marshal(body)
	if err != nil {
		return nil, fmt.Errorf("marshal request: %w", err)
	}

	// Create request
	req, err := http.NewRequestWithContext(ctx, "POST", l.apiURL, bytes.NewReader(jsonBody))
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", l.apiKey)

	// Execute request
	resp, err := l.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		bodyBytes, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("Linear API error %d: %s", resp.StatusCode, bodyBytes)
	}

	// Parse response
	var result struct {
		Data struct {
			Issues struct {
				Nodes []struct {
					ID          string    `json:"id"`
					Identifier  string    `json:"identifier"`
					Title       string    `json:"title"`
					Description string    `json:"description"`
					Priority    int       `json:"priority"`
					URL         string    `json:"url"`
					CreatedAt   time.Time `json:"createdAt"`
					UpdatedAt   time.Time `json:"updatedAt"`
					State       struct {
						ID    string `json:"id"`
						Name  string `json:"name"`
						Color string `json:"color"`
						Type  string `json:"type"`
					} `json:"state"`
					Assignee *struct {
						ID          string `json:"id"`
						Name        string `json:"name"`
						Email       string `json:"email"`
						DisplayName string `json:"displayName"`
						AvatarURL   string `json:"avatarUrl"`
					} `json:"assignee"`
					Labels struct {
						Nodes []struct {
							ID    string `json:"id"`
							Name  string `json:"name"`
							Color string `json:"color"`
						} `json:"nodes"`
					} `json:"labels"`
					Project *struct {
						ID   string `json:"id"`
						Name string `json:"name"`
					} `json:"project"`
					Team struct {
						ID   string `json:"id"`
						Name string `json:"name"`
						Key  string `json:"key"`
					} `json:"team"`
				} `json:"nodes"`
			} `json:"issues"`
		} `json:"data"`
		Errors []struct {
			Message string `json:"message"`
		} `json:"errors"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("decode response: %w", err)
	}

	if len(result.Errors) > 0 {
		return nil, fmt.Errorf("Linear GraphQL error: %s", result.Errors[0].Message)
	}

	// Convert to LinearIssue slice
	issues := make([]LinearIssue, len(result.Data.Issues.Nodes))
	for i, node := range result.Data.Issues.Nodes {
		issue := LinearIssue{
			ID:          node.ID,
			Identifier:  node.Identifier,
			Title:       node.Title,
			Description: node.Description,
			Priority:    node.Priority,
			URL:         node.URL,
			CreatedAt:   node.CreatedAt,
			UpdatedAt:   node.UpdatedAt,
			State: LinearState{
				ID:    node.State.ID,
				Name:  node.State.Name,
				Color: node.State.Color,
				Type:  node.State.Type,
			},
			Team: LinearTeam{
				ID:   node.Team.ID,
				Name: node.Team.Name,
				Key:  node.Team.Key,
			},
		}

		if node.Assignee != nil {
			issue.Assignee = &LinearUser{
				ID:          node.Assignee.ID,
				Name:        node.Assignee.Name,
				Email:       node.Assignee.Email,
				DisplayName: node.Assignee.DisplayName,
				AvatarURL:   node.Assignee.AvatarURL,
			}
		}

		if node.Project != nil {
			issue.Project = &LinearProject{
				ID:   node.Project.ID,
				Name: node.Project.Name,
			}
		}

		for _, label := range node.Labels.Nodes {
			issue.Labels = append(issue.Labels, LinearLabel{
				ID:    label.ID,
				Name:  label.Name,
				Color: label.Color,
			})
		}

		issues[i] = issue
	}

	return issues, nil
}

// GetViewer fetches the authenticated user info
func (l *LinearAdapter) GetViewer(ctx context.Context) (*LinearUser, error) {
	query := `
		query {
			viewer {
				id
				name
				email
				displayName
				avatarUrl
			}
		}
	`

	body := map[string]interface{}{
		"query": query,
	}

	jsonBody, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequestWithContext(ctx, "POST", l.apiURL, bytes.NewReader(jsonBody))
	if err != nil {
		return nil, err
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", l.apiKey)

	resp, err := l.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var result struct {
		Data struct {
			Viewer struct {
				ID          string `json:"id"`
				Name        string `json:"name"`
				Email       string `json:"email"`
				DisplayName string `json:"displayName"`
				AvatarURL   string `json:"avatarUrl"`
			} `json:"viewer"`
		} `json:"data"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, err
	}

	return &LinearUser{
		ID:          result.Data.Viewer.ID,
		Name:        result.Data.Viewer.Name,
		Email:       result.Data.Viewer.Email,
		DisplayName: result.Data.Viewer.DisplayName,
		AvatarURL:   result.Data.Viewer.AvatarURL,
	}, nil
}
