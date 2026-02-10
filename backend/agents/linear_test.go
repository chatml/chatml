package agents

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

// ============================================================================
// Constructor Tests
// ============================================================================

func TestNewLinearAdapter(t *testing.T) {
	adapter := NewLinearAdapter("lin_api_key")

	require.NotNil(t, adapter)
	require.Equal(t, "lin_api_key", adapter.apiKey)
	require.Equal(t, "https://api.linear.app/graphql", adapter.apiURL)
	require.NotNil(t, adapter.httpClient)
	require.NotNil(t, adapter.cache)
}

func TestLinearAdapter_SetAPIKey(t *testing.T) {
	adapter := NewLinearAdapter("initial-key")
	require.Equal(t, "initial-key", adapter.apiKey)

	adapter.SetAPIKey("new-key")
	require.Equal(t, "new-key", adapter.apiKey)
}

// ============================================================================
// Poll Tests
// ============================================================================

func TestLinearAdapter_Poll_Success(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		require.Equal(t, "POST", r.Method)
		require.Equal(t, "Bearer lin_api_key", r.Header.Get("Authorization"))
		require.Equal(t, "application/json", r.Header.Get("Content-Type"))

		response := map[string]interface{}{
			"data": map[string]interface{}{
				"issues": map[string]interface{}{
					"nodes": []map[string]interface{}{
						{
							"id":          "issue-1",
							"identifier":  "ENG-123",
							"title":       "Test Issue",
							"description": "Description",
							"priority":    1,
							"url":         "https://linear.app/team/issue/ENG-123",
							"createdAt":   time.Now().Format(time.RFC3339),
							"updatedAt":   time.Now().Format(time.RFC3339),
							"state": map[string]interface{}{
								"id":    "state-1",
								"name":  "In Progress",
								"color": "#ff0000",
								"type":  "started",
							},
							"team": map[string]interface{}{
								"id":   "team-1",
								"name": "Engineering",
								"key":  "ENG",
							},
							"labels": map[string]interface{}{
								"nodes": []map[string]interface{}{},
							},
						},
					},
				},
			},
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(response)
	}))
	defer server.Close()

	adapter := NewLinearAdapter("lin_api_key")
	adapter.apiURL = server.URL

	result, err := adapter.Poll(context.Background(), nil)

	require.NoError(t, err)
	require.NotNil(t, result)
	require.Len(t, result.Issues, 1)
	require.Equal(t, "ENG-123", result.Issues[0].Identifier)
	require.Equal(t, "Test Issue", result.Issues[0].Title)
	require.Equal(t, "In Progress", result.Issues[0].State.Name)
}

func TestLinearAdapter_Poll_WithFilters_State_InProgress(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]interface{}
		json.NewDecoder(r.Body).Decode(&body)

		variables := body["variables"].(map[string]interface{})
		filter := variables["filter"].(map[string]interface{})
		stateFilter := filter["state"].(map[string]interface{})
		typeFilter := stateFilter["type"].(map[string]interface{})

		require.Equal(t, "started", typeFilter["eq"])

		response := map[string]interface{}{
			"data": map[string]interface{}{
				"issues": map[string]interface{}{
					"nodes": []map[string]interface{}{},
				},
			},
		}
		json.NewEncoder(w).Encode(response)
	}))
	defer server.Close()

	adapter := NewLinearAdapter("lin_api_key")
	adapter.apiURL = server.URL

	_, err := adapter.Poll(context.Background(), map[string]interface{}{
		"state": "in_progress",
	})

	require.NoError(t, err)
}

func TestLinearAdapter_Poll_WithFilters_State_Backlog(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]interface{}
		json.NewDecoder(r.Body).Decode(&body)

		variables := body["variables"].(map[string]interface{})
		filter := variables["filter"].(map[string]interface{})
		stateFilter := filter["state"].(map[string]interface{})
		typeFilter := stateFilter["type"].(map[string]interface{})

		require.Equal(t, "backlog", typeFilter["eq"])

		response := map[string]interface{}{
			"data": map[string]interface{}{
				"issues": map[string]interface{}{
					"nodes": []map[string]interface{}{},
				},
			},
		}
		json.NewEncoder(w).Encode(response)
	}))
	defer server.Close()

	adapter := NewLinearAdapter("lin_api_key")
	adapter.apiURL = server.URL

	_, err := adapter.Poll(context.Background(), map[string]interface{}{
		"state": "backlog",
	})

	require.NoError(t, err)
}

func TestLinearAdapter_Poll_WithFilters_State_Done(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]interface{}
		json.NewDecoder(r.Body).Decode(&body)

		variables := body["variables"].(map[string]interface{})
		filter := variables["filter"].(map[string]interface{})
		stateFilter := filter["state"].(map[string]interface{})
		typeFilter := stateFilter["type"].(map[string]interface{})

		require.Equal(t, "completed", typeFilter["eq"])

		response := map[string]interface{}{
			"data": map[string]interface{}{
				"issues": map[string]interface{}{
					"nodes": []map[string]interface{}{},
				},
			},
		}
		json.NewEncoder(w).Encode(response)
	}))
	defer server.Close()

	adapter := NewLinearAdapter("lin_api_key")
	adapter.apiURL = server.URL

	_, err := adapter.Poll(context.Background(), map[string]interface{}{
		"state": "done",
	})

	require.NoError(t, err)
}

func TestLinearAdapter_Poll_WithFilters_Assignee_Me(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]interface{}
		json.NewDecoder(r.Body).Decode(&body)

		variables := body["variables"].(map[string]interface{})
		filter := variables["filter"].(map[string]interface{})
		assigneeFilter := filter["assignee"].(map[string]interface{})
		isMeFilter := assigneeFilter["isMe"].(map[string]interface{})

		require.True(t, isMeFilter["eq"].(bool))

		response := map[string]interface{}{
			"data": map[string]interface{}{
				"issues": map[string]interface{}{
					"nodes": []map[string]interface{}{},
				},
			},
		}
		json.NewEncoder(w).Encode(response)
	}))
	defer server.Close()

	adapter := NewLinearAdapter("lin_api_key")
	adapter.apiURL = server.URL

	_, err := adapter.Poll(context.Background(), map[string]interface{}{
		"assignee": "me",
	})

	require.NoError(t, err)
}

func TestLinearAdapter_Poll_WithFilters_Assignee_Email(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]interface{}
		json.NewDecoder(r.Body).Decode(&body)

		variables := body["variables"].(map[string]interface{})
		filter := variables["filter"].(map[string]interface{})
		assigneeFilter := filter["assignee"].(map[string]interface{})
		emailFilter := assigneeFilter["email"].(map[string]interface{})

		require.Equal(t, "john@example.com", emailFilter["eq"])

		response := map[string]interface{}{
			"data": map[string]interface{}{
				"issues": map[string]interface{}{
					"nodes": []map[string]interface{}{},
				},
			},
		}
		json.NewEncoder(w).Encode(response)
	}))
	defer server.Close()

	adapter := NewLinearAdapter("lin_api_key")
	adapter.apiURL = server.URL

	_, err := adapter.Poll(context.Background(), map[string]interface{}{
		"assignee": "john@example.com",
	})

	require.NoError(t, err)
}

func TestLinearAdapter_Poll_WithFilters_Team(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]interface{}
		json.NewDecoder(r.Body).Decode(&body)

		variables := body["variables"].(map[string]interface{})
		filter := variables["filter"].(map[string]interface{})
		teamFilter := filter["team"].(map[string]interface{})
		keyFilter := teamFilter["key"].(map[string]interface{})

		require.Equal(t, "ENG", keyFilter["eq"])

		response := map[string]interface{}{
			"data": map[string]interface{}{
				"issues": map[string]interface{}{
					"nodes": []map[string]interface{}{},
				},
			},
		}
		json.NewEncoder(w).Encode(response)
	}))
	defer server.Close()

	adapter := NewLinearAdapter("lin_api_key")
	adapter.apiURL = server.URL

	_, err := adapter.Poll(context.Background(), map[string]interface{}{
		"team": "ENG",
	})

	require.NoError(t, err)
}

func TestLinearAdapter_Poll_APIError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		w.Write([]byte(`{"error": "Invalid API key"}`))
	}))
	defer server.Close()

	adapter := NewLinearAdapter("invalid-key")
	adapter.apiURL = server.URL

	_, err := adapter.Poll(context.Background(), nil)

	require.Error(t, err)
	require.Contains(t, err.Error(), "401")
}

func TestLinearAdapter_Poll_GraphQLError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		response := map[string]interface{}{
			"data":   nil,
			"errors": []map[string]interface{}{{"message": "Invalid query"}},
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(response)
	}))
	defer server.Close()

	adapter := NewLinearAdapter("lin_api_key")
	adapter.apiURL = server.URL

	_, err := adapter.Poll(context.Background(), nil)

	require.Error(t, err)
	require.Contains(t, err.Error(), "GraphQL")
}

func TestLinearAdapter_Poll_NetworkError(t *testing.T) {
	adapter := NewLinearAdapter("lin_api_key")
	adapter.apiURL = "http://localhost:99999" // Invalid port

	_, err := adapter.Poll(context.Background(), nil)

	require.Error(t, err)
}

func TestLinearAdapter_Poll_InvalidJSON(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte("not valid json"))
	}))
	defer server.Close()

	adapter := NewLinearAdapter("lin_api_key")
	adapter.apiURL = server.URL

	_, err := adapter.Poll(context.Background(), nil)

	require.Error(t, err)
	require.Contains(t, err.Error(), "decode")
}

func TestLinearAdapter_Poll_ContextCancellation(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(100 * time.Millisecond)
		json.NewEncoder(w).Encode(map[string]interface{}{})
	}))
	defer server.Close()

	adapter := NewLinearAdapter("lin_api_key")
	adapter.apiURL = server.URL

	ctx, cancel := context.WithCancel(context.Background())
	cancel() // Cancel immediately

	_, err := adapter.Poll(ctx, nil)

	require.Error(t, err)
}

func TestLinearAdapter_Poll_WithAssignee(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		response := map[string]interface{}{
			"data": map[string]interface{}{
				"issues": map[string]interface{}{
					"nodes": []map[string]interface{}{
						{
							"id":         "issue-1",
							"identifier": "ENG-123",
							"title":      "Test Issue",
							"priority":   1,
							"url":        "https://linear.app/issue/ENG-123",
							"createdAt":  time.Now().Format(time.RFC3339),
							"updatedAt":  time.Now().Format(time.RFC3339),
							"state": map[string]interface{}{
								"id": "state-1", "name": "Todo", "color": "#ccc", "type": "unstarted",
							},
							"assignee": map[string]interface{}{
								"id":          "user-1",
								"name":        "John Doe",
								"email":       "john@example.com",
								"displayName": "johnd",
								"avatarUrl":   "https://example.com/avatar",
							},
							"team": map[string]interface{}{
								"id": "team-1", "name": "Engineering", "key": "ENG",
							},
							"labels": map[string]interface{}{"nodes": []map[string]interface{}{}},
						},
					},
				},
			},
		}
		json.NewEncoder(w).Encode(response)
	}))
	defer server.Close()

	adapter := NewLinearAdapter("lin_api_key")
	adapter.apiURL = server.URL

	result, err := adapter.Poll(context.Background(), nil)

	require.NoError(t, err)
	require.Len(t, result.Issues, 1)
	require.NotNil(t, result.Issues[0].Assignee)
	require.Equal(t, "John Doe", result.Issues[0].Assignee.Name)
	require.Equal(t, "john@example.com", result.Issues[0].Assignee.Email)
}

func TestLinearAdapter_Poll_WithProject(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		response := map[string]interface{}{
			"data": map[string]interface{}{
				"issues": map[string]interface{}{
					"nodes": []map[string]interface{}{
						{
							"id":         "issue-1",
							"identifier": "ENG-123",
							"title":      "Test Issue",
							"priority":   1,
							"url":        "https://linear.app/issue/ENG-123",
							"createdAt":  time.Now().Format(time.RFC3339),
							"updatedAt":  time.Now().Format(time.RFC3339),
							"state": map[string]interface{}{
								"id": "state-1", "name": "Todo", "color": "#ccc", "type": "unstarted",
							},
							"project": map[string]interface{}{
								"id":   "project-1",
								"name": "Q1 Roadmap",
							},
							"team": map[string]interface{}{
								"id": "team-1", "name": "Engineering", "key": "ENG",
							},
							"labels": map[string]interface{}{"nodes": []map[string]interface{}{}},
						},
					},
				},
			},
		}
		json.NewEncoder(w).Encode(response)
	}))
	defer server.Close()

	adapter := NewLinearAdapter("lin_api_key")
	adapter.apiURL = server.URL

	result, err := adapter.Poll(context.Background(), nil)

	require.NoError(t, err)
	require.Len(t, result.Issues, 1)
	require.NotNil(t, result.Issues[0].Project)
	require.Equal(t, "Q1 Roadmap", result.Issues[0].Project.Name)
}

func TestLinearAdapter_Poll_WithLabels(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		response := map[string]interface{}{
			"data": map[string]interface{}{
				"issues": map[string]interface{}{
					"nodes": []map[string]interface{}{
						{
							"id":         "issue-1",
							"identifier": "ENG-123",
							"title":      "Test Issue",
							"priority":   1,
							"url":        "https://linear.app/issue/ENG-123",
							"createdAt":  time.Now().Format(time.RFC3339),
							"updatedAt":  time.Now().Format(time.RFC3339),
							"state": map[string]interface{}{
								"id": "state-1", "name": "Todo", "color": "#ccc", "type": "unstarted",
							},
							"team": map[string]interface{}{
								"id": "team-1", "name": "Engineering", "key": "ENG",
							},
							"labels": map[string]interface{}{
								"nodes": []map[string]interface{}{
									{"id": "label-1", "name": "bug", "color": "#ff0000"},
									{"id": "label-2", "name": "high-priority", "color": "#ff6600"},
								},
							},
						},
					},
				},
			},
		}
		json.NewEncoder(w).Encode(response)
	}))
	defer server.Close()

	adapter := NewLinearAdapter("lin_api_key")
	adapter.apiURL = server.URL

	result, err := adapter.Poll(context.Background(), nil)

	require.NoError(t, err)
	require.Len(t, result.Issues, 1)
	require.Len(t, result.Issues[0].Labels, 2)
	require.Equal(t, "bug", result.Issues[0].Labels[0].Name)
	require.Equal(t, "high-priority", result.Issues[0].Labels[1].Name)
}

func TestLinearAdapter_BuildIssuesQuery(t *testing.T) {
	adapter := NewLinearAdapter("lin_api_key")

	query := adapter.buildIssuesQuery(nil)

	require.Contains(t, query, "query Issues")
	require.Contains(t, query, "issues")
	require.Contains(t, query, "nodes")
	require.Contains(t, query, "id")
	require.Contains(t, query, "identifier")
	require.Contains(t, query, "title")
	require.Contains(t, query, "description")
	require.Contains(t, query, "state")
	require.Contains(t, query, "assignee")
	require.Contains(t, query, "labels")
	require.Contains(t, query, "project")
	require.Contains(t, query, "team")
}

// ============================================================================
// GetViewer Tests
// ============================================================================

func TestLinearAdapter_GetViewer_Success(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		response := map[string]interface{}{
			"data": map[string]interface{}{
				"viewer": map[string]interface{}{
					"id":          "user-123",
					"name":        "John Doe",
					"email":       "john@example.com",
					"displayName": "johnd",
					"avatarUrl":   "https://example.com/avatar.png",
				},
			},
		}
		json.NewEncoder(w).Encode(response)
	}))
	defer server.Close()

	adapter := NewLinearAdapter("lin_api_key")
	adapter.apiURL = server.URL

	user, err := adapter.GetViewer(context.Background())

	require.NoError(t, err)
	require.NotNil(t, user)
	require.Equal(t, "user-123", user.ID)
	require.Equal(t, "John Doe", user.Name)
	require.Equal(t, "john@example.com", user.Email)
	require.Equal(t, "johnd", user.DisplayName)
	require.Equal(t, "https://example.com/avatar.png", user.AvatarURL)
}

func TestLinearAdapter_GetViewer_Error(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
	}))
	defer server.Close()

	adapter := NewLinearAdapter("invalid-key")
	adapter.apiURL = server.URL

	_, err := adapter.GetViewer(context.Background())

	require.Error(t, err)
}

// ============================================================================
// Struct Tests
// ============================================================================

func TestLinearIssue_JSONSerialization(t *testing.T) {
	now := time.Now().Truncate(time.Second)

	issue := LinearIssue{
		ID:          "issue-123",
		Identifier:  "ENG-456",
		Title:       "Test Issue",
		Description: "This is a test",
		Priority:    2,
		State: LinearState{
			ID:    "state-1",
			Name:  "In Progress",
			Color: "#ff0000",
			Type:  "started",
		},
		Assignee: &LinearUser{
			ID:          "user-1",
			Name:        "John Doe",
			Email:       "john@example.com",
			DisplayName: "johnd",
		},
		Labels: []LinearLabel{
			{ID: "label-1", Name: "bug", Color: "#ff0000"},
		},
		Project: &LinearProject{
			ID:   "project-1",
			Name: "Q1 Roadmap",
		},
		Team: LinearTeam{
			ID:   "team-1",
			Name: "Engineering",
			Key:  "ENG",
		},
		URL:       "https://linear.app/issue/ENG-456",
		CreatedAt: now,
		UpdatedAt: now,
	}

	data, err := json.Marshal(issue)
	require.NoError(t, err)

	var decoded LinearIssue
	err = json.Unmarshal(data, &decoded)
	require.NoError(t, err)

	require.Equal(t, "ENG-456", decoded.Identifier)
	require.Equal(t, "Test Issue", decoded.Title)
	require.Equal(t, 2, decoded.Priority)
	require.NotNil(t, decoded.Assignee)
	require.Equal(t, "John Doe", decoded.Assignee.Name)
	require.Len(t, decoded.Labels, 1)
	require.NotNil(t, decoded.Project)
}

func TestLinearPollResult_Empty(t *testing.T) {
	result := LinearPollResult{
		Issues:      []LinearIssue{},
		NotModified: false,
	}

	require.Empty(t, result.Issues)
	require.False(t, result.NotModified)
}
