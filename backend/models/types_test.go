package models

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

// ============================================================================
// Status/Constant Tests
// ============================================================================

func TestValidSessionStatuses(t *testing.T) {
	// Verify all expected session statuses are present
	expected := []string{
		SessionStatusActive,
		SessionStatusIdle,
		SessionStatusDone,
		SessionStatusError,
	}

	for _, status := range expected {
		require.True(t, ValidSessionStatuses[status], "ValidSessionStatuses should contain %q", status)
	}

	// Verify count matches
	require.Len(t, ValidSessionStatuses, len(expected), "ValidSessionStatuses should have exactly %d entries", len(expected))
}

func TestValidPRStatuses(t *testing.T) {
	// Verify all expected PR statuses are present
	expected := []string{
		PRStatusNone,
		PRStatusOpen,
		PRStatusMerged,
		PRStatusClosed,
	}

	for _, status := range expected {
		require.True(t, ValidPRStatuses[status], "ValidPRStatuses should contain %q", status)
	}

	// Verify count matches
	require.Len(t, ValidPRStatuses, len(expected), "ValidPRStatuses should have exactly %d entries", len(expected))
}

func TestAgentStatus_Constants(t *testing.T) {
	require.Equal(t, AgentStatus("pending"), StatusPending)
	require.Equal(t, AgentStatus("running"), StatusRunning)
	require.Equal(t, AgentStatus("done"), StatusDone)
	require.Equal(t, AgentStatus("error"), StatusError)
}

func TestConversationType_Constants(t *testing.T) {
	require.Equal(t, "task", ConversationTypeTask)
	require.Equal(t, "review", ConversationTypeReview)
	require.Equal(t, "chat", ConversationTypeChat)
}

func TestConversationStatus_Constants(t *testing.T) {
	require.Equal(t, "active", ConversationStatusActive)
	require.Equal(t, "idle", ConversationStatusIdle)
	require.Equal(t, "completed", ConversationStatusCompleted)
}

func TestSessionStatus_Constants(t *testing.T) {
	require.Equal(t, "active", SessionStatusActive)
	require.Equal(t, "idle", SessionStatusIdle)
	require.Equal(t, "done", SessionStatusDone)
	require.Equal(t, "error", SessionStatusError)
}

func TestPRStatus_Constants(t *testing.T) {
	require.Equal(t, "none", PRStatusNone)
	require.Equal(t, "open", PRStatusOpen)
	require.Equal(t, "merged", PRStatusMerged)
	require.Equal(t, "closed", PRStatusClosed)
}

func TestCommentSource_Constants(t *testing.T) {
	require.Equal(t, "claude", CommentSourceClaude)
	require.Equal(t, "user", CommentSourceUser)
}

func TestCommentSeverity_Constants(t *testing.T) {
	require.Equal(t, "error", CommentSeverityError)
	require.Equal(t, "warning", CommentSeverityWarning)
	require.Equal(t, "suggestion", CommentSeveritySuggestion)
}

// ============================================================================
// JSON Serialization Tests
// ============================================================================

func TestRepo_JSONSerialization(t *testing.T) {
	now := time.Now().Truncate(time.Millisecond)
	repo := Repo{
		ID:        "repo-123",
		Name:      "my-repo",
		Path:      "/path/to/repo",
		Branch:    "main",
		CreatedAt: now,
	}

	// Marshal
	data, err := json.Marshal(repo)
	require.NoError(t, err)

	// Unmarshal
	var decoded Repo
	err = json.Unmarshal(data, &decoded)
	require.NoError(t, err)

	require.Equal(t, repo.ID, decoded.ID)
	require.Equal(t, repo.Name, decoded.Name)
	require.Equal(t, repo.Path, decoded.Path)
	require.Equal(t, repo.Branch, decoded.Branch)
	require.True(t, repo.CreatedAt.Equal(decoded.CreatedAt))
}

func TestSession_JSONSerialization(t *testing.T) {
	now := time.Now().Truncate(time.Millisecond)
	session := Session{
		ID:               "session-123",
		WorkspaceID:      "workspace-456",
		Name:             "feature-branch",
		Branch:           "feature/new-thing",
		WorktreePath:     "/path/to/worktree",
		BaseCommitSHA:    "abc123def",
		Task:             "Implement new feature",
		Status:           SessionStatusActive,
		AgentID:          "agent-789",
		Stats:            &SessionStats{Additions: 10, Deletions: 5},
		PRStatus:         PRStatusOpen,
		PRUrl:            "https://github.com/org/repo/pull/1",
		PRNumber:         1,
		HasMergeConflict: false,
		HasCheckFailures: true,
		Pinned:           true,
		AutoNamed:        false,
		CreatedAt:        now,
		UpdatedAt:        now,
	}

	// Marshal
	data, err := json.Marshal(session)
	require.NoError(t, err)

	// Unmarshal
	var decoded Session
	err = json.Unmarshal(data, &decoded)
	require.NoError(t, err)

	require.Equal(t, session.ID, decoded.ID)
	require.Equal(t, session.WorkspaceID, decoded.WorkspaceID)
	require.Equal(t, session.Name, decoded.Name)
	require.Equal(t, session.Branch, decoded.Branch)
	require.Equal(t, session.WorktreePath, decoded.WorktreePath)
	require.Equal(t, session.BaseCommitSHA, decoded.BaseCommitSHA)
	require.Equal(t, session.Task, decoded.Task)
	require.Equal(t, session.Status, decoded.Status)
	require.Equal(t, session.AgentID, decoded.AgentID)
	require.NotNil(t, decoded.Stats)
	require.Equal(t, 10, decoded.Stats.Additions)
	require.Equal(t, 5, decoded.Stats.Deletions)
	require.Equal(t, session.PRStatus, decoded.PRStatus)
	require.Equal(t, session.PRUrl, decoded.PRUrl)
	require.Equal(t, session.PRNumber, decoded.PRNumber)
	require.Equal(t, session.HasMergeConflict, decoded.HasMergeConflict)
	require.Equal(t, session.HasCheckFailures, decoded.HasCheckFailures)
	require.Equal(t, session.Pinned, decoded.Pinned)
	require.Equal(t, session.AutoNamed, decoded.AutoNamed)
}

func TestSession_JSONSerialization_OmitEmpty(t *testing.T) {
	now := time.Now().Truncate(time.Millisecond)
	session := Session{
		ID:          "session-123",
		WorkspaceID: "workspace-456",
		Name:        "feature-branch",
		Branch:      "feature/new-thing",
		Status:      SessionStatusIdle,
		CreatedAt:   now,
		UpdatedAt:   now,
		// Omit optional fields
	}

	data, err := json.Marshal(session)
	require.NoError(t, err)

	// Check that omitempty fields are excluded
	var rawMap map[string]interface{}
	err = json.Unmarshal(data, &rawMap)
	require.NoError(t, err)

	_, hasBaseCommitSHA := rawMap["baseCommitSha"]
	require.False(t, hasBaseCommitSHA, "baseCommitSha should be omitted when empty")

	_, hasTask := rawMap["task"]
	require.False(t, hasTask, "task should be omitted when empty")

	_, hasAgentID := rawMap["agentId"]
	require.False(t, hasAgentID, "agentId should be omitted when empty")

	_, hasStats := rawMap["stats"]
	require.False(t, hasStats, "stats should be omitted when nil")
}

func TestConversation_JSONSerialization(t *testing.T) {
	now := time.Now().Truncate(time.Millisecond)
	conv := Conversation{
		ID:        "conv-123",
		SessionID: "session-456",
		Type:      ConversationTypeTask,
		Name:      "Implement feature",
		Status:    ConversationStatusActive,
		Messages: []Message{
			{ID: "msg-1", Role: "user", Content: "Hello", Timestamp: now},
		},
		ToolSummary: []ToolAction{
			{ID: "tool-1", Tool: "read_file", Target: "/path/to/file", Success: true},
		},
		CreatedAt: now,
		UpdatedAt: now,
	}

	// Marshal
	data, err := json.Marshal(conv)
	require.NoError(t, err)

	// Unmarshal
	var decoded Conversation
	err = json.Unmarshal(data, &decoded)
	require.NoError(t, err)

	require.Equal(t, conv.ID, decoded.ID)
	require.Equal(t, conv.SessionID, decoded.SessionID)
	require.Equal(t, conv.Type, decoded.Type)
	require.Equal(t, conv.Name, decoded.Name)
	require.Equal(t, conv.Status, decoded.Status)
	require.Len(t, decoded.Messages, 1)
	require.Equal(t, "msg-1", decoded.Messages[0].ID)
	require.Len(t, decoded.ToolSummary, 1)
	require.Equal(t, "tool-1", decoded.ToolSummary[0].ID)
}

func TestMessage_JSONSerialization(t *testing.T) {
	now := time.Now().Truncate(time.Millisecond)

	t.Run("basic message", func(t *testing.T) {
		msg := Message{
			ID:        "msg-123",
			Role:      "assistant",
			Content:   "Hello, how can I help?",
			Timestamp: now,
		}

		data, err := json.Marshal(msg)
		require.NoError(t, err)

		var decoded Message
		err = json.Unmarshal(data, &decoded)
		require.NoError(t, err)

		require.Equal(t, msg.ID, decoded.ID)
		require.Equal(t, msg.Role, decoded.Role)
		require.Equal(t, msg.Content, decoded.Content)
	})

	t.Run("message with setup info", func(t *testing.T) {
		msg := Message{
			ID:      "msg-123",
			Role:    "system",
			Content: "Session setup",
			SetupInfo: &SetupInfo{
				SessionName:  "my-session",
				BranchName:   "feature/test",
				OriginBranch: "main",
				FileCount:    42,
				SessionType:  SessionTypeWorktree,
			},
			Timestamp: now,
		}

		data, err := json.Marshal(msg)
		require.NoError(t, err)

		var decoded Message
		err = json.Unmarshal(data, &decoded)
		require.NoError(t, err)

		require.NotNil(t, decoded.SetupInfo)
		require.Equal(t, "my-session", decoded.SetupInfo.SessionName)
		require.Equal(t, "feature/test", decoded.SetupInfo.BranchName)
		require.Equal(t, "main", decoded.SetupInfo.OriginBranch)
		require.Equal(t, 42, decoded.SetupInfo.FileCount)
		require.Equal(t, SessionTypeWorktree, decoded.SetupInfo.SessionType)
	})

	t.Run("message with run summary", func(t *testing.T) {
		msg := Message{
			ID:      "msg-123",
			Role:    "assistant",
			Content: "Done",
			RunSummary: &RunSummary{
				Success:    true,
				Cost:       0.05,
				Turns:      3,
				DurationMs: 5000,
				Stats: &RunStats{
					ToolCalls:    10,
					ToolsByType:  map[string]int{"read_file": 5, "bash": 3, "write_file": 2},
					FilesRead:    5,
					FilesWritten: 2,
					BashCommands: 3,
				},
			},
			Timestamp: now,
		}

		data, err := json.Marshal(msg)
		require.NoError(t, err)

		var decoded Message
		err = json.Unmarshal(data, &decoded)
		require.NoError(t, err)

		require.NotNil(t, decoded.RunSummary)
		require.True(t, decoded.RunSummary.Success)
		require.Equal(t, 0.05, decoded.RunSummary.Cost)
		require.Equal(t, 3, decoded.RunSummary.Turns)
		require.Equal(t, 5000, decoded.RunSummary.DurationMs)
		require.NotNil(t, decoded.RunSummary.Stats)
		require.Equal(t, 10, decoded.RunSummary.Stats.ToolCalls)
	})
}

func TestRunStats_JSONSerialization(t *testing.T) {
	stats := RunStats{
		ToolCalls:           25,
		ToolsByType:         map[string]int{"read_file": 10, "write_file": 5, "bash": 8, "grep": 2},
		SubAgents:           2,
		FilesRead:           10,
		FilesWritten:        5,
		BashCommands:        8,
		WebSearches:         1,
		TotalToolDurationMs: 12000,
	}

	data, err := json.Marshal(stats)
	require.NoError(t, err)

	var decoded RunStats
	err = json.Unmarshal(data, &decoded)
	require.NoError(t, err)

	require.Equal(t, stats.ToolCalls, decoded.ToolCalls)
	require.Equal(t, stats.SubAgents, decoded.SubAgents)
	require.Equal(t, stats.FilesRead, decoded.FilesRead)
	require.Equal(t, stats.FilesWritten, decoded.FilesWritten)
	require.Equal(t, stats.BashCommands, decoded.BashCommands)
	require.Equal(t, stats.WebSearches, decoded.WebSearches)
	require.Equal(t, stats.TotalToolDurationMs, decoded.TotalToolDurationMs)
	require.Equal(t, 10, decoded.ToolsByType["read_file"])
	require.Equal(t, 5, decoded.ToolsByType["write_file"])
}

func TestRunSummary_JSONSerialization(t *testing.T) {
	t.Run("success with stats", func(t *testing.T) {
		summary := RunSummary{
			Success:    true,
			Cost:       0.123,
			Turns:      5,
			DurationMs: 15000,
			Stats: &RunStats{
				ToolCalls:    20,
				FilesWritten: 3,
			},
		}

		data, err := json.Marshal(summary)
		require.NoError(t, err)

		var decoded RunSummary
		err = json.Unmarshal(data, &decoded)
		require.NoError(t, err)

		require.True(t, decoded.Success)
		require.Equal(t, 0.123, decoded.Cost)
		require.Equal(t, 5, decoded.Turns)
		require.Equal(t, 15000, decoded.DurationMs)
		require.NotNil(t, decoded.Stats)
	})

	t.Run("failure with errors", func(t *testing.T) {
		summary := RunSummary{
			Success: false,
			Errors:  []any{"error 1", "error 2"},
		}

		data, err := json.Marshal(summary)
		require.NoError(t, err)

		var decoded RunSummary
		err = json.Unmarshal(data, &decoded)
		require.NoError(t, err)

		require.False(t, decoded.Success)
		require.Len(t, decoded.Errors, 2)
	})
}

func TestFileTab_JSONSerialization(t *testing.T) {
	now := time.Now().Truncate(time.Millisecond)
	tab := FileTab{
		ID:             "tab-123",
		WorkspaceID:    "workspace-456",
		SessionID:      "session-789",
		Path:           "/src/main.go",
		ViewMode:       "diff",
		IsPinned:       true,
		Position:       2,
		OpenedAt:       now,
		LastAccessedAt: now,
	}

	data, err := json.Marshal(tab)
	require.NoError(t, err)

	var decoded FileTab
	err = json.Unmarshal(data, &decoded)
	require.NoError(t, err)

	require.Equal(t, tab.ID, decoded.ID)
	require.Equal(t, tab.WorkspaceID, decoded.WorkspaceID)
	require.Equal(t, tab.SessionID, decoded.SessionID)
	require.Equal(t, tab.Path, decoded.Path)
	require.Equal(t, tab.ViewMode, decoded.ViewMode)
	require.Equal(t, tab.IsPinned, decoded.IsPinned)
	require.Equal(t, tab.Position, decoded.Position)
}

func TestFileTab_JSONSerialization_OptionalSessionID(t *testing.T) {
	now := time.Now().Truncate(time.Millisecond)
	tab := FileTab{
		ID:             "tab-123",
		WorkspaceID:    "workspace-456",
		Path:           "/src/main.go",
		ViewMode:       "file",
		OpenedAt:       now,
		LastAccessedAt: now,
		// SessionID omitted (workspace-scoped tab)
	}

	data, err := json.Marshal(tab)
	require.NoError(t, err)

	// With omitempty, empty sessionId should NOT be in the JSON
	var rawMap map[string]interface{}
	err = json.Unmarshal(data, &rawMap)
	require.NoError(t, err)

	_, exists := rawMap["sessionId"]
	require.False(t, exists, "empty sessionId should be omitted due to omitempty tag")

	// Verify round-trip still works
	var decoded FileTab
	err = json.Unmarshal(data, &decoded)
	require.NoError(t, err)
	require.Empty(t, decoded.SessionID)
}

func TestReviewComment_JSONSerialization(t *testing.T) {
	now := time.Now().Truncate(time.Millisecond)
	resolvedAt := now.Add(time.Hour)

	comment := ReviewComment{
		ID:         "comment-123",
		SessionID:  "session-456",
		FilePath:   "/src/main.go",
		LineNumber: 42,
		Content:    "Consider using a more descriptive variable name",
		Source:     CommentSourceClaude,
		Author:     "Claude",
		Severity:   CommentSeveritySuggestion,
		CreatedAt:  now,
		Resolved:   true,
		ResolvedAt: &resolvedAt,
		ResolvedBy: "user@example.com",
	}

	data, err := json.Marshal(comment)
	require.NoError(t, err)

	var decoded ReviewComment
	err = json.Unmarshal(data, &decoded)
	require.NoError(t, err)

	require.Equal(t, comment.ID, decoded.ID)
	require.Equal(t, comment.SessionID, decoded.SessionID)
	require.Equal(t, comment.FilePath, decoded.FilePath)
	require.Equal(t, comment.LineNumber, decoded.LineNumber)
	require.Equal(t, comment.Content, decoded.Content)
	require.Equal(t, comment.Source, decoded.Source)
	require.Equal(t, comment.Author, decoded.Author)
	require.Equal(t, comment.Severity, decoded.Severity)
	require.True(t, decoded.Resolved)
	require.NotNil(t, decoded.ResolvedAt)
	require.Equal(t, comment.ResolvedBy, decoded.ResolvedBy)
}

func TestReviewComment_JSONSerialization_OmitEmpty(t *testing.T) {
	now := time.Now().Truncate(time.Millisecond)
	comment := ReviewComment{
		ID:         "comment-123",
		SessionID:  "session-456",
		FilePath:   "/src/main.go",
		LineNumber: 42,
		Content:    "Fix this",
		Source:     CommentSourceUser,
		Author:     "John",
		CreatedAt:  now,
		Resolved:   false,
		// Severity, ResolvedAt, ResolvedBy omitted
	}

	data, err := json.Marshal(comment)
	require.NoError(t, err)

	var rawMap map[string]interface{}
	err = json.Unmarshal(data, &rawMap)
	require.NoError(t, err)

	_, hasSeverity := rawMap["severity"]
	require.False(t, hasSeverity, "severity should be omitted when empty")

	_, hasResolvedAt := rawMap["resolvedAt"]
	require.False(t, hasResolvedAt, "resolvedAt should be omitted when nil")

	_, hasResolvedBy := rawMap["resolvedBy"]
	require.False(t, hasResolvedBy, "resolvedBy should be omitted when empty")
}

func TestSessionStats_JSONSerialization(t *testing.T) {
	stats := SessionStats{
		Additions: 100,
		Deletions: 50,
	}

	data, err := json.Marshal(stats)
	require.NoError(t, err)

	var decoded SessionStats
	err = json.Unmarshal(data, &decoded)
	require.NoError(t, err)

	require.Equal(t, 100, decoded.Additions)
	require.Equal(t, 50, decoded.Deletions)
}

func TestSetupInfo_JSONSerialization(t *testing.T) {
	info := SetupInfo{
		SessionName:  "feature-session",
		BranchName:   "feature/awesome",
		OriginBranch: "main",
		FileCount:    256,
		SessionType:  SessionTypeWorktree,
	}

	data, err := json.Marshal(info)
	require.NoError(t, err)

	var decoded SetupInfo
	err = json.Unmarshal(data, &decoded)
	require.NoError(t, err)

	require.Equal(t, info.SessionName, decoded.SessionName)
	require.Equal(t, info.BranchName, decoded.BranchName)
	require.Equal(t, info.OriginBranch, decoded.OriginBranch)
	require.Equal(t, info.FileCount, decoded.FileCount)
	require.Equal(t, info.SessionType, decoded.SessionType)
}

func TestSetupInfo_JSONSerialization_OmitEmpty(t *testing.T) {
	info := SetupInfo{
		SessionName:  "session",
		BranchName:   "branch",
		OriginBranch: "main",
		// FileCount omitted (zero value)
	}

	data, err := json.Marshal(info)
	require.NoError(t, err)

	var rawMap map[string]interface{}
	err = json.Unmarshal(data, &rawMap)
	require.NoError(t, err)

	_, hasFileCount := rawMap["fileCount"]
	require.False(t, hasFileCount, "fileCount should be omitted when zero")

	_, hasSessionType := rawMap["sessionType"]
	require.False(t, hasSessionType, "sessionType should be omitted when empty")
}

func TestToolAction_JSONSerialization(t *testing.T) {
	action := ToolAction{
		ID:      "action-123",
		Tool:    "write_file",
		Target:  "/src/new_file.go",
		Success: true,
	}

	data, err := json.Marshal(action)
	require.NoError(t, err)

	var decoded ToolAction
	err = json.Unmarshal(data, &decoded)
	require.NoError(t, err)

	require.Equal(t, action.ID, decoded.ID)
	require.Equal(t, action.Tool, decoded.Tool)
	require.Equal(t, action.Target, decoded.Target)
	require.True(t, decoded.Success)
}

func TestAgent_JSONSerialization(t *testing.T) {
	now := time.Now().Truncate(time.Millisecond)
	agent := Agent{
		ID:        "agent-123",
		RepoID:    "repo-456",
		Task:      "Implement feature X",
		Status:    string(StatusRunning),
		Worktree:  "/path/to/worktree",
		Branch:    "agent/feature-x",
		CreatedAt: now,
	}

	data, err := json.Marshal(agent)
	require.NoError(t, err)

	var decoded Agent
	err = json.Unmarshal(data, &decoded)
	require.NoError(t, err)

	require.Equal(t, agent.ID, decoded.ID)
	require.Equal(t, agent.RepoID, decoded.RepoID)
	require.Equal(t, agent.Task, decoded.Task)
	require.Equal(t, agent.Status, decoded.Status)
	require.Equal(t, agent.Worktree, decoded.Worktree)
	require.Equal(t, agent.Branch, decoded.Branch)
}

func TestCommentStats_JSONSerialization(t *testing.T) {
	stats := CommentStats{
		FilePath:   "/src/main.go",
		Total:      10,
		Unresolved: 3,
	}

	data, err := json.Marshal(stats)
	require.NoError(t, err)

	var decoded CommentStats
	err = json.Unmarshal(data, &decoded)
	require.NoError(t, err)

	require.Equal(t, stats.FilePath, decoded.FilePath)
	require.Equal(t, stats.Total, decoded.Total)
	require.Equal(t, stats.Unresolved, decoded.Unresolved)
}

// ============================================================================
// SessionWithWorkspace Tests
// ============================================================================

func TestSessionWithWorkspace_DefaultBranch(t *testing.T) {
	t.Run("returns workspace branch when set", func(t *testing.T) {
		sw := &SessionWithWorkspace{
			WorkspaceBranch: "develop",
		}
		require.Equal(t, "develop", sw.DefaultBranch())
	})

	t.Run("returns main when workspace branch is empty", func(t *testing.T) {
		sw := &SessionWithWorkspace{
			WorkspaceBranch: "",
		}
		require.Equal(t, "main", sw.DefaultBranch())
	})

	t.Run("returns main for zero-value struct", func(t *testing.T) {
		sw := &SessionWithWorkspace{}
		require.Equal(t, "main", sw.DefaultBranch())
	})

	t.Run("returns master when workspace uses master", func(t *testing.T) {
		sw := &SessionWithWorkspace{
			WorkspaceBranch: "master",
		}
		require.Equal(t, "master", sw.DefaultBranch())
	})
}

func TestSessionWithWorkspace_EffectiveRemote(t *testing.T) {
	t.Run("returns workspace remote when set", func(t *testing.T) {
		sw := &SessionWithWorkspace{
			WorkspaceRemote: "upstream",
		}
		require.Equal(t, "upstream", sw.EffectiveRemote())
	})

	t.Run("returns origin when workspace remote is empty", func(t *testing.T) {
		sw := &SessionWithWorkspace{
			WorkspaceRemote: "",
		}
		require.Equal(t, "origin", sw.EffectiveRemote())
	})

	t.Run("returns origin for zero-value struct", func(t *testing.T) {
		sw := &SessionWithWorkspace{}
		require.Equal(t, "origin", sw.EffectiveRemote())
	})

	t.Run("preserves custom remote name", func(t *testing.T) {
		sw := &SessionWithWorkspace{
			WorkspaceRemote: "my-fork",
		}
		require.Equal(t, "my-fork", sw.EffectiveRemote())
	})
}

func TestSessionWithWorkspace_EffectiveTargetBranch(t *testing.T) {
	t.Run("returns session target branch when set", func(t *testing.T) {
		sw := &SessionWithWorkspace{
			Session:         Session{TargetBranch: "origin/develop"},
			WorkspaceBranch: "main",
		}
		require.Equal(t, "origin/develop", sw.EffectiveTargetBranch())
	})

	t.Run("falls back to origin/workspace-branch when target not set", func(t *testing.T) {
		sw := &SessionWithWorkspace{
			Session:         Session{TargetBranch: ""},
			WorkspaceBranch: "main",
		}
		require.Equal(t, "origin/main", sw.EffectiveTargetBranch())
	})

	t.Run("falls back to origin/main when both empty", func(t *testing.T) {
		sw := &SessionWithWorkspace{}
		require.Equal(t, "origin/main", sw.EffectiveTargetBranch())
	})

	t.Run("falls back to origin/master for master workspace", func(t *testing.T) {
		sw := &SessionWithWorkspace{
			Session:         Session{TargetBranch: ""},
			WorkspaceBranch: "master",
		}
		require.Equal(t, "origin/master", sw.EffectiveTargetBranch())
	})

	t.Run("session override takes precedence over workspace default", func(t *testing.T) {
		sw := &SessionWithWorkspace{
			Session:         Session{TargetBranch: "origin/release/v2"},
			WorkspaceBranch: "main",
		}
		require.Equal(t, "origin/release/v2", sw.EffectiveTargetBranch())
	})

	t.Run("uses custom remote when workspace remote is set", func(t *testing.T) {
		sw := &SessionWithWorkspace{
			Session:         Session{TargetBranch: ""},
			WorkspaceBranch: "main",
			WorkspaceRemote: "upstream",
		}
		require.Equal(t, "upstream/main", sw.EffectiveTargetBranch())
	})

	t.Run("uses custom remote with custom default branch", func(t *testing.T) {
		sw := &SessionWithWorkspace{
			Session:         Session{TargetBranch: ""},
			WorkspaceBranch: "develop",
			WorkspaceRemote: "upstream",
		}
		require.Equal(t, "upstream/develop", sw.EffectiveTargetBranch())
	})

	t.Run("session target branch overrides custom remote fallback", func(t *testing.T) {
		sw := &SessionWithWorkspace{
			Session:         Session{TargetBranch: "origin/hotfix"},
			WorkspaceBranch: "main",
			WorkspaceRemote: "upstream",
		}
		require.Equal(t, "origin/hotfix", sw.EffectiveTargetBranch())
	})

	t.Run("custom remote with default branch fallback to main", func(t *testing.T) {
		sw := &SessionWithWorkspace{
			WorkspaceRemote: "upstream",
		}
		require.Equal(t, "upstream/main", sw.EffectiveTargetBranch())
	})
}

func TestSession_TargetBranch_JSONSerialization(t *testing.T) {
	t.Run("included when set", func(t *testing.T) {
		session := Session{
			ID:           "sess-1",
			WorkspaceID:  "ws-1",
			Name:         "test",
			Branch:       "feature/test",
			Status:       SessionStatusIdle,
			TargetBranch: "origin/develop",
			CreatedAt:    time.Now().Truncate(time.Millisecond),
			UpdatedAt:    time.Now().Truncate(time.Millisecond),
		}

		data, err := json.Marshal(session)
		require.NoError(t, err)

		var decoded Session
		err = json.Unmarshal(data, &decoded)
		require.NoError(t, err)
		require.Equal(t, "origin/develop", decoded.TargetBranch)
	})

	t.Run("omitted when empty", func(t *testing.T) {
		session := Session{
			ID:          "sess-1",
			WorkspaceID: "ws-1",
			Name:        "test",
			Branch:      "feature/test",
			Status:      SessionStatusIdle,
			CreatedAt:   time.Now().Truncate(time.Millisecond),
			UpdatedAt:   time.Now().Truncate(time.Millisecond),
		}

		data, err := json.Marshal(session)
		require.NoError(t, err)

		var rawMap map[string]interface{}
		err = json.Unmarshal(data, &rawMap)
		require.NoError(t, err)

		_, hasTargetBranch := rawMap["targetBranch"]
		require.False(t, hasTargetBranch, "targetBranch should be omitted when empty")
	})
}
