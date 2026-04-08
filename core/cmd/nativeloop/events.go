package main

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/chatml/chatml-core/agent"
	tea "github.com/charmbracelet/bubbletea"
)

// ── Message types for BubbleTea ─────────────────────────────────────────────

type agentEventMsg agent.AgentEvent
type backendDoneMsg struct{}
type parseErrorMsg struct {
	raw string
	err error
}
type gitStateMsg struct {
	branch string
	dirty  bool
}

// detectGitStateCmd runs git detection asynchronously to avoid blocking the TUI.
func detectGitStateCmd(workdir string) tea.Cmd {
	return func() tea.Msg {
		branch, dirty := detectGitState(workdir)
		return gitStateMsg{branch: branch, dirty: dirty}
	}
}

// waitForEvent returns a tea.Cmd that blocks on the backend output channel
// and returns the next event as a tea.Msg. This is the idiomatic BubbleTea
// pattern for external event sources — no goroutine needed.
func waitForEvent(backend agent.ConversationBackend) tea.Cmd {
	return func() tea.Msg {
		for {
			line, ok := <-backend.Output()
			if !ok {
				return backendDoneMsg{}
			}
			var event agent.AgentEvent
			if err := json.Unmarshal([]byte(line), &event); err != nil {
				return parseErrorMsg{raw: line, err: err}
			}
			return agentEventMsg(event)
		}
	}
}

// processAgentEvent handles an agent event and returns a tea.Cmd if needed.
func processAgentEvent(m *model, raw agentEventMsg) tea.Cmd {
	e := agent.AgentEvent(raw)

	switch e.Type {
	case "ready":
		return handleReady(m, e)
	case "session_started":
		return handleSessionStarted(m, e)
	case "assistant_text":
		return handleAssistantText(m, e)
	case "thinking":
		return handleThinking(m, e)
	case "tool_start":
		return handleToolStart(m, e)
	case "tool_end":
		return handleToolEnd(m, e)
	case "tool_approval_request":
		return handleApprovalRequest(m, e)
	case "user_question_request":
		return handleQuestionRequest(m, e)
	case "plan_approval_request":
		return handlePlanRequest(m, e)
	case "result":
		return handleResult(m, e)
	case "turn_complete":
		return handleTurnComplete(m, e)
	case "error":
		return handleError(m, e)
	case "complete":
		return handleComplete(m, e)
	case "context_warning":
		return handleContextWarning(m, e)
	case "context_usage":
		return handleContextUsage(m, e)
	case "todo_update":
		return handleTodoUpdate(m, e)
	case "permission_mode_changed":
		return handlePermissionMode(m, e)
	case "subagent_started":
		return handleSubagentStarted(m, e)
	case "subagent_stopped":
		return handleSubagentStopped(m, e)
	case "subagent_output":
		return handleSubagentOutput(m, e)
	case "rate_limit_received":
		return handleRateLimit(m, e)
	case "fast_mode_changed":
		return handleFastMode(m, e)
	case "hook_started":
		return handleHookStarted(m, e)

	// P0.4: Handle previously-dropped event types
	case "api_retry":
		return handleAPIRetry(m, e)
	case "interrupted":
		return handleInterrupted(m, e)
	case "compact_boundary", "pre_compact":
		return handlePreCompact(m, e)
	case "post_compact":
		return handlePostCompact(m, e)
	case "session_recovering":
		return handleSessionRecovering(m, e)
	case "tool_progress":
		return handleToolProgress(m, e)
	case "cwd_changed":
		return handleCwdChanged(m, e)
	case "context_window_size":
		return handleContextWindowSize(m, e)
	case "warning", "streaming_warning":
		return handleWarning(m, e)
	case "model_changed":
		return handleModelChanged(m, e)
	}

	// Unknown event — show in verbose mode for debugging
	if m.verbose {
		data, _ := json.Marshal(e)
		m.appendActive(&displayMessage{
			kind:    msgSystem,
			content: fmt.Sprintf("[%s] %s", e.Type, truncate(string(data), 80)),
		})
	}
	return nil
}

// ── Event handler functions ─────────────────────────────────────────────────

func handleReady(m *model, e agent.AgentEvent) tea.Cmd {
	if m.promptMode && m.promptText != "" {
		text := m.promptText
		backend := m.backend // capture only the backend, not the entire model
		m.state = stateRunning
		m.stream.turnStart = now()
		m.stream.turnVerb = randomVerb()
		m.input.Blur()
		return func() tea.Msg {
			if err := backend.SendMessage(text); err != nil {
				return agentEventMsg(agent.AgentEvent{Type: "error", Message: "Failed to send message: " + err.Error()})
			}
			return nil
		}
	}
	return nil
}

func handleSessionStarted(m *model, e agent.AgentEvent) tea.Cmd {
	if m.verbose {
		m.appendActive(&displayMessage{
			kind:    msgSystem,
			content: fmt.Sprintf("Session: %s", e.SessionID),
		})
	}
	return nil
}

func handleAssistantText(m *model, e agent.AgentEvent) tea.Cmd {
	m.flushThinking()
	m.stream.assistantBuf.WriteString(e.Content)

	if !m.stream.hadAssistant {
		// First token: create a new streaming message in the viewport
		m.stream.hadAssistant = true
		idx := m.appendActive(&displayMessage{
			kind:      msgAssistant,
			content:   m.stream.assistantBuf.String(),
			streaming: true,
		})
		m.stream.streamingMsgIdx = idx
	} else if m.stream.streamingMsgIdx >= 0 {
		// Subsequent tokens: update the existing streaming message in-place
		msg := m.activeAt(m.stream.streamingMsgIdx)
		if msg != nil {
			msg.content = m.stream.assistantBuf.String()
			
		}
	}
	return nil
}

func handleThinking(m *model, e agent.AgentEvent) tea.Cmd {
	if m.stream.thinkingStart.IsZero() {
		m.stream.thinkingStart = now()
	}
	m.stream.thinkingBuf.WriteString(e.Content)
	return nil
}

func handleToolStart(m *model, e agent.AgentEvent) tea.Cmd {
	// Sub-agents are rendered by handleSubagentStarted/Stopped — skip here.
	// The SDK tool name is "Task"; we also check "Agent" defensively.
	if e.Tool == "Task" || e.Tool == "Agent" {
		return nil
	}

	m.flushThinking()
	m.flushAssistantText()

	// Track active tool for status bar
	m.stream.activeToolName = e.Tool
	m.stream.activeToolParam = extractToolParams(e.Tool, e.Params, m.workdir)

	// If there's already a pending tool that never got an end, finalize it
	if m.stream.pendingToolID != "" && m.stream.pendingToolIdx >= 0 && m.stream.pendingToolIdx < m.activeCount() {
		if msg := m.activeAt(m.stream.pendingToolIdx); msg != nil {
			msg.kind = msgTool
			msg.summary = "done"
			msg.success = true
			if start, ok := m.stream.toolStarts[m.stream.pendingToolID]; ok {
				msg.duration = time.Since(start)
				delete(m.stream.toolStarts, m.stream.pendingToolID)
			}
		}
	}

	// Track tool start time
	if e.ID != "" {
		m.stream.toolStarts[e.ID] = now()
	}

	// Build details
	details := buildToolDetails(e.Tool, e.Params, m.s, m.workdir)

	param := extractToolParams(e.Tool, e.Params, m.workdir)

	// Append a running placeholder
	idx := m.appendActive(&displayMessage{
		kind:      msgToolRunning,
		tool:      e.Tool,
		params:    param,
		expanded:  true,
		details:   details,
		timestamp: now(),
	})

	// Track the pending tool
	m.stream.pendingToolIdx = idx
	m.stream.pendingToolID = e.ID
	return nil
}

func handleToolEnd(m *model, e agent.AgentEvent) tea.Cmd {
	// Sub-agents are rendered by handleSubagentStarted/Stopped — skip here.
	if e.Tool == "Task" || e.Tool == "Agent" {
		return nil
	}

	duration := time.Duration(0)
	if e.ID != "" {
		if start, ok := m.stream.toolStarts[e.ID]; ok {
			duration = time.Since(start)
			delete(m.stream.toolStarts, e.ID)
		}
	}

	// Clear active tool from status bar
	m.stream.activeToolName = ""
	m.stream.activeToolParam = ""

	// tool_end now carries params (tool_start had nil params during streaming)
	// Rebuild details and display param from the actual params.
	param := extractToolParams(e.Tool, e.Params, m.workdir)
	details := buildToolDetails(e.Tool, e.Params, m.s, m.workdir)

	// Glob: render file tree from summary (newline-separated paths)
	if e.Tool == "Glob" && e.Summary != "" {
		paths := strings.Split(strings.TrimSpace(e.Summary), "\n")
		if len(paths) > 1 {
			treeLines := renderFileTree(paths, m.workdir, m.s, maxTreeLines)
			if len(treeLines) > 0 {
				details = append(details, treeLines...)
			}
		}
	}

	// Bash: add output preview (first 3 lines) to details
	if e.Tool == "Bash" && e.Summary != "" {
		outputLines := strings.Split(e.Summary, "\n")
		previewCount := bashPreviewLines
		if len(outputLines) <= previewCount {
			for _, line := range outputLines {
				if line != "" {
					details = append(details, m.s.toolLine.Render(fmt.Sprintf("    │ %s", line)))
				}
			}
		} else {
			for i := 0; i < previewCount; i++ {
				details = append(details, m.s.toolLine.Render(fmt.Sprintf("    │ %s", outputLines[i])))
			}
			remaining := len(outputLines) - previewCount
			details = append(details, m.s.expandHint.Render(fmt.Sprintf("    │ ... %d more lines", remaining)))
		}
		// Exit code
		if code, ok := extractExitCode(e.Summary); ok {
			if code == 0 {
				details = append(details, m.s.exitOK.Render(fmt.Sprintf("    │ Exit code: %d", code)))
			} else {
				details = append(details, m.s.exitFail.Render(fmt.Sprintf("    │ Exit code: %d", code)))
			}
		}
	}

	// Enrich the summary with tool-specific metadata
	enrichedSummary := enrichToolSummary(e.Tool, e.Summary, e.Params, m.s)

	// Compute collapse state using per-tool thresholds from tool_render.go.
	lineCount := strings.Count(e.Summary, "\n") + 1
	shouldCollapse := false
	fullContent := ""

	threshold := toolCollapseThreshold(e.Tool)
	if threshold >= 0 && lineCount > threshold {
		shouldCollapse = true
		fullContent = e.Summary
	}

	// Try to find and replace the matching running tool
	replaced := false
	if m.stream.pendingToolID != "" && m.stream.pendingToolID == e.ID &&
		m.stream.pendingToolIdx >= 0 && m.stream.pendingToolIdx < m.activeCount() {
		msg := m.activeAt(m.stream.pendingToolIdx)
		msg.kind = msgTool
		msg.params = param
		msg.summary = enrichedSummary
		msg.success = e.Success
		msg.duration = duration
		msg.details = details
		msg.lineCount = lineCount
		msg.fullContent = fullContent
		msg.collapsed = shouldCollapse
		
		m.stream.pendingToolIdx = -1
		m.stream.pendingToolID = ""
		replaced = true
	}

	if !replaced {
		for i := m.activeCount() - 1; i >= 0; i-- {
			msg := m.activeAt(i)
			if msg.kind == msgToolRunning {
				msg.kind = msgTool
				msg.params = param
				msg.summary = enrichedSummary
				msg.success = e.Success
				msg.duration = duration
				msg.details = details
				msg.lineCount = lineCount
				msg.fullContent = fullContent
				msg.collapsed = shouldCollapse
				
				replaced = true
				break
			}
		}
	}

	if !replaced {
		m.appendActive(&displayMessage{
			kind:      msgTool,
			tool:      e.Tool,
			params:    param,
			summary:   enrichedSummary,
			success:   e.Success,
			duration:  duration,
			details:   details,
			timestamp: now(),
		})
	}
	return nil
}

func handleApprovalRequest(m *model, e agent.AgentEvent) tea.Cmd {
	m.flushAssistantText()
	m.prompt.approvalID = e.RequestID
	m.prompt.approvalToolName = e.ToolName
	m.prompt.approvalSpecifier = e.Specifier
	m.appendActive(&displayMessage{
		kind:   msgApproval,
		tool:   e.ToolName,
		params: e.Specifier,
	})
	m.state = stateApproval
	bell(m) // notify user that approval is needed
	return nil
}

func handleQuestionRequest(m *model, e agent.AgentEvent) tea.Cmd {
	m.flushAssistantText()
	m.prompt.questionID = e.RequestID
	m.prompt.questions = e.Questions
	m.prompt.selectedOpt = 0
	// Compact message in conversation — options shown in input bar
	if len(e.Questions) > 0 {
		m.appendActive(&displayMessage{
			kind:     msgQuestion,
			question: e.Questions[0].Question,
		})
	}
	m.state = stateQuestion
	bell(m) // notify user that a question needs answering
	return nil
}

func handlePlanRequest(m *model, e agent.AgentEvent) tea.Cmd {
	m.flushAssistantText()
	m.prompt.planID = e.RequestID
	m.appendActive(&displayMessage{
		kind:    msgPlanReview,
		content: e.PlanContent,
	})
	m.state = statePlanReview
	return nil
}

func handleResult(m *model, e agent.AgentEvent) tea.Cmd {
	m.flushAssistantText()
	updateSessionStats(m, &e)
	// Show usage stats inline (only in verbose mode to avoid clutter from intermediate results)
	if m.verbose && (e.InputTokens > 0 || e.OutputTokens > 0) {
		tokenParts := []string{
			fmt.Sprintf("%s in", formatNum(e.InputTokens)),
			fmt.Sprintf("%s out", formatNum(e.OutputTokens)),
		}
		if e.Cost > 0 {
			tokenParts = append(tokenParts, fmt.Sprintf("$%.4f", e.Cost))
		}
		m.appendActive(&displayMessage{
			kind:    msgSystem,
			content: "Tokens: " + strings.Join(tokenParts, " · "),
		})
	}
	return nil
}

func handleTurnComplete(m *model, e agent.AgentEvent) tea.Cmd {
	m.flushThinking()
	m.flushAssistantText()

	// Clear pending tool tracking
	m.stream.pendingToolIdx = -1
	m.stream.pendingToolID = ""

	// Render todos if any
	if len(m.prompt.todos) > 0 {
		var todoLines []string
		todoLines = append(todoLines, "Tasks:")
		for _, t := range m.prompt.todos {
			icon := "[ ]"
			switch t.Status {
			case "in_progress":
				icon = "[~]"
			case "completed":
				icon = "[x]"
			}
			todoLines = append(todoLines, fmt.Sprintf(" %s %s", icon, t.Content))
		}
		m.appendActive(&displayMessage{
			kind:    msgSystem,
			content: strings.Join(todoLines, "\n"),
		})
		m.prompt.todos = nil
	}

	// Turn summary line
	parts := []string{m.modelName, modeBadge(m.permMode)}
	if m.stats.totalCost > 0 {
		parts = append(parts, fmt.Sprintf("$%.4f", m.stats.totalCost))
	}
	if m.stats.lastContextPct > 0 {
		parts = append(parts, fmt.Sprintf("ctx %d%%", m.stats.lastContextPct))
	}
	if !m.stream.turnStart.IsZero() {
		elapsed := time.Since(m.stream.turnStart).Round(100 * time.Millisecond)
		verb := m.stream.turnVerb
		if verb == "" {
			verb = "Completed"
		}
		parts = append(parts, fmt.Sprintf("%s for %s", verb, elapsed))
		m.stream.turnStart = time.Time{}
	}
	m.appendActive(&displayMessage{
		kind:    msgSystem,
		content: strings.Join(parts, " · "),
	})

	// Turn separator before committing to scrollback
	m.appendActive(&displayMessage{
		kind:      msgTurnSeparator,
		timestamp: now(),
	})

	// Commit all active messages to terminal scrollback
	commitCmd := m.commitActiveMsgs()

	m.state = stateIdle
	m.input.Focus()
	if m.promptMode {
		return tea.Batch(commitCmd, tea.Quit)
	}

	return commitCmd
}

func handleError(m *model, e agent.AgentEvent) tea.Cmd {
	m.appendActive(&displayMessage{
		kind:    msgError,
		content: e.Message,
	})
	bell(m) // notify user of error
	return nil
}

func handleComplete(m *model, e agent.AgentEvent) tea.Cmd {
	m.appendActive(&displayMessage{
		kind:    msgSystem,
		content: "Session complete.",
	})
	if m.promptMode {
		return tea.Quit
	}
	return nil // Keep interactive session alive
}

func handleContextWarning(m *model, e agent.AgentEvent) tea.Cmd {
	m.appendActive(&displayMessage{
		kind:    msgSystem,
		content: fmt.Sprintf("\u26a0 %s", e.Message),
	})
	return nil
}

func handleContextUsage(m *model, e agent.AgentEvent) tea.Cmd {
	updateContextStats(m, &e)
	return nil
}

func handleTodoUpdate(m *model, e agent.AgentEvent) tea.Cmd {
	m.prompt.todos = e.Todos
	return nil
}

func handlePermissionMode(m *model, e agent.AgentEvent) tea.Cmd {
	m.permMode = e.Mode
	m.appendActive(&displayMessage{
		kind:    msgSystem,
		content: fmt.Sprintf("Mode \u2192 %s", modeBadge(e.Mode)),
	})
	return nil
}

func handleSubagentStarted(m *model, e agent.AgentEvent) tea.Cmd {
	m.flushThinking()
	m.flushAssistantText()

	desc := e.AgentDescription
	if desc == "" {
		desc = "Sub-agent"
	}
	idx := m.appendActive(&displayMessage{
		kind:      msgToolRunning,
		tool:      "Agent",
		params:    desc,
		timestamp: now(),
		agentProg: &agentProgress{
			agentID: e.AgentId,
		},
	})
	// Track agent ID -> message index for O(1) lookup
	if e.AgentId != "" {
		m.agentMsgIdx[e.AgentId] = idx
		m.stream.toolStarts[e.AgentId] = now()
	}
	return nil
}

func handleSubagentStopped(m *model, e agent.AgentEvent) tea.Cmd {
	// No bell here — sub-agents can finish in bursts (parallel agents).
	// The turn_complete or approval bell covers user-actionable moments.

	// Find the Agent message and mark it complete
	idx := -1
	if e.AgentId != "" {
		if i, ok := m.agentMsgIdx[e.AgentId]; ok {
			idx = i
			delete(m.agentMsgIdx, e.AgentId)
		}
	}
	if idx < 0 {
		// Fallback: search backward
		for i := m.activeCount() - 1; i >= 0; i-- {
			msg := m.activeAt(i)
			if msg.kind == msgToolRunning && msg.tool == "Agent" {
				idx = i
				break
			}
		}
	}
	if idx >= 0 && idx < m.activeCount() {
		msg := m.activeAt(idx)
		msg.kind = msgTool
		msg.success = true
		msg.collapsed = true // Default collapsed
		if e.Summary != "" {
			msg.summary = e.Summary
		} else {
			msg.summary = "Done"
		}
		if e.DurationMs > 0 {
			msg.duration = time.Duration(e.DurationMs) * time.Millisecond
		} else if e.AgentId != "" {
			if start, ok := m.stream.toolStarts[e.AgentId]; ok {
				msg.duration = time.Since(start)
				delete(m.stream.toolStarts, e.AgentId)
			}
		}
		
	}
	return nil
}

func handleSubagentOutput(m *model, e agent.AgentEvent) tea.Cmd {
	// Route inner sub-agent events into the parent Agent message's agentProg.
	// This renders them INSIDE the Agent block instead of as top-level messages.
	if e.AgentOutput != "" {
		// Find parent Agent message
		parentIdx := -1
		if e.AgentId != "" {
			if i, ok := m.agentMsgIdx[e.AgentId]; ok {
				parentIdx = i
			}
		}
		if parentIdx < 0 {
			// Fallback: last running Agent
			for i := m.activeCount() - 1; i >= 0; i-- {
				msg := m.activeAt(i)
				if msg.kind == msgToolRunning && msg.tool == "Agent" {
					parentIdx = i
					break
				}
			}
		}

		if parentIdx >= 0 && parentIdx < m.activeCount() && m.activeAt(parentIdx).agentProg != nil {
			prog := m.activeAt(parentIdx).agentProg

			var subEvent agent.AgentEvent
			if json.Unmarshal([]byte(e.AgentOutput), &subEvent) == nil {
				switch subEvent.Type {
				case "tool_start":
					prog.runningTool = subEvent.Tool
					prog.runningParam = extractToolParams(subEvent.Tool, subEvent.Params, m.workdir)
					

				case "tool_end":
					param := extractToolParams(subEvent.Tool, subEvent.Params, m.workdir)
					summary := subEvent.Summary
					if len(summary) > maxHeaderWidth {
						summary = summary[:maxHeaderWidth-3] + "..."
					}
					var dur time.Duration
					if subEvent.Duration > 0 {
						dur = time.Duration(subEvent.Duration) * time.Millisecond
					}
					// Default tool_end to success=true. The Success field uses
					// json:"success,omitempty" which omits false from JSON, making
					// it indistinguishable from "not set" after unmarshal. Since
					// tool_end with isError emits Success:false AND the summary
					// contains the error, we check for error indicators.
					isSuccess := true
					if strings.HasPrefix(summary, "Error") || strings.HasPrefix(summary, "error") ||
						subEvent.Error != "" {
						isSuccess = false
					}
					prog.toolCalls = append(prog.toolCalls, agentToolCall{
						tool:     subEvent.Tool,
						params:   param,
						summary:  summary,
						success:  isSuccess,
						duration: dur,
					})
					prog.toolCount++
					prog.runningTool = ""
					prog.runningParam = ""
					

				case "result":
					// Update token count from usage data
					if subEvent.Usage != nil {
						tokens := 0
						for _, key := range []string{"input_tokens", "output_tokens", "cache_read_input_tokens", "cache_creation_input_tokens"} {
							if v, ok := subEvent.Usage[key]; ok {
								if f, ok := v.(float64); ok {
									tokens += int(f)
								}
							}
						}
						if tokens > 0 {
							prog.tokenCount = tokens
							
						}
					}

				case "error":
					prog.toolCalls = append(prog.toolCalls, agentToolCall{
						tool:    "error",
						summary: subEvent.Message,
						success: false,
					})
					
				}
			}
		}
	}
	return nil
}

func handleRateLimit(m *model, e agent.AgentEvent) tea.Cmd {
	m.appendActive(&displayMessage{
		kind:    msgSystem,
		content: "\u26a0 " + e.Message,
	})
	return nil
}

func handleFastMode(m *model, e agent.AgentEvent) tea.Cmd {
	if e.FastMode != nil {
		m.fastMode = *e.FastMode
	}
	if e.Message != "" {
		m.appendActive(&displayMessage{
			kind:    msgSystem,
			content: e.Message,
		})
	}
	return nil
}

func handleHookStarted(m *model, e agent.AgentEvent) tea.Cmd {
	if m.verbose {
		m.appendActive(&displayMessage{
			kind:    msgSystem,
			content: fmt.Sprintf("Hook: %s \u2192 %s", e.HookEvent, e.Command),
		})
	}
	return nil
}

// ── P0.4: New event handlers ────────────────────────────────────────────────

func handleAPIRetry(m *model, e agent.AgentEvent) tea.Cmd {
	msg := fmt.Sprintf("⟳ Retrying API call (attempt %d/%d)", e.Attempt, e.MaxRetries)
	if e.RetryDelayMs > 0 {
		msg += fmt.Sprintf(" in %dms", e.RetryDelayMs)
	}
	if e.ErrorStatus > 0 {
		msg += fmt.Sprintf(" [HTTP %d]", e.ErrorStatus)
	}
	m.appendActive(&displayMessage{kind: msgSystem, content: msg})
	return nil
}

func handleInterrupted(m *model, e agent.AgentEvent) tea.Cmd {
	m.flushThinking()
	m.flushAssistantText()
	m.stream.pendingToolIdx = -1
	m.stream.pendingToolID = ""
	m.appendActive(&displayMessage{kind: msgSystem, content: "Turn interrupted"})
	commitCmd := m.commitActiveMsgs()
	m.state = stateIdle
	m.input.Focus()
	// Note: waitForEvent continuation is chained by the caller (processAgentEvent
	// return path in Update). If this is the final event before channel close,
	// the next waitForEvent will yield backendDoneMsg, which is correct.
	return commitCmd
}

func handlePreCompact(m *model, e agent.AgentEvent) tea.Cmd {
	msg := "Context compaction starting"
	if e.PreTokens > 0 {
		msg += fmt.Sprintf(" (%s tokens)", formatNum(e.PreTokens))
	}
	if e.Trigger != "" {
		msg += fmt.Sprintf(" — trigger: %s", e.Trigger)
	}
	m.appendActive(&displayMessage{kind: msgSystem, content: "⟳ " + msg})
	return nil
}

func handlePostCompact(m *model, e agent.AgentEvent) tea.Cmd {
	msg := "Context compacted"
	if e.CompactSummary != "" {
		msg += ": " + truncate(e.CompactSummary, 100)
	}
	m.appendActive(&displayMessage{kind: msgSystem, content: "✓ " + msg})
	return nil
}

func handleSessionRecovering(m *model, e agent.AgentEvent) tea.Cmd {
	msg := "Session recovering"
	if e.Attempt > 0 {
		msg += fmt.Sprintf(" (attempt %d/%d)", e.Attempt, e.MaxAttempts)
	}
	m.appendActive(&displayMessage{kind: msgSystem, content: "⟳ " + msg})
	return nil
}

func handleToolProgress(m *model, e agent.AgentEvent) tea.Cmd {
	// Update the running tool's elapsed time display in the status bar
	if e.ToolName != "" {
		m.stream.activeToolName = e.ToolName
	}
	return nil
}

func handleCwdChanged(m *model, e agent.AgentEvent) tea.Cmd {
	if e.NewCwd != "" {
		m.workdir = e.NewCwd
		m.appendActive(&displayMessage{
			kind:    msgSystem,
			content: fmt.Sprintf("Working directory → %s", displayPath(e.NewCwd, e.OldCwd)),
		})
		// Detect git state asynchronously to avoid blocking the TUI
		return detectGitStateCmd(e.NewCwd)
	}
	return nil
}

func handleContextWindowSize(m *model, e agent.AgentEvent) tea.Cmd {
	if e.ContextWindow > 0 {
		m.stats.lastContextWindow = e.ContextWindow
	}
	return nil
}

func handleWarning(m *model, e agent.AgentEvent) tea.Cmd {
	msg := e.Message
	if msg == "" {
		msg = "Unknown warning"
	}
	m.appendActive(&displayMessage{kind: msgSystem, content: "⚠ " + msg})
	return nil
}

func handleModelChanged(m *model, e agent.AgentEvent) tea.Cmd {
	if e.Model != "" {
		m.modelName = e.Model
		m.appendActive(&displayMessage{
			kind:    msgSystem,
			content: fmt.Sprintf("Model → %s", e.Model),
		})
	}
	return nil
}

// ── Helper functions ────────────────────────────────────────────────────────

// updateSessionStats accumulates cost and token data from a result event.
func updateSessionStats(m *model, e *agent.AgentEvent) {
	m.stats.totalCost += e.Cost
	m.stats.totalInputTokens += e.InputTokens
	m.stats.totalOutputTokens += e.OutputTokens
	if e.Turns > 0 {
		m.stats.totalTurns += e.Turns
	} else {
		m.stats.totalTurns++
	}
	// Use typed field first; fall back to Usage map if typed field is zero
	if e.CacheReadInputTokens > 0 {
		m.stats.totalCacheRead += e.CacheReadInputTokens
	} else if e.Usage != nil {
		if cr, ok := e.Usage["cache_read_input_tokens"]; ok {
			if v, ok := toInt(cr); ok {
				m.stats.totalCacheRead += v
			}
		}
	}
}

// buildToolDetails builds the inline detail lines shown below a tool header.
// Dispatches to per-tool renderers defined in tool_render.go.
func buildToolDetails(tool string, params map[string]interface{}, s *styles, workdir string) []string {
	if params == nil {
		return nil
	}
	if r, ok := toolRenderers[tool]; ok && r.buildDetails != nil {
		return r.buildDetails(params, s, workdir)
	}
	return nil
}

// enrichToolSummary enhances a tool's summary with richer metadata.
// Dispatches to per-tool renderers defined in tool_render.go.
func enrichToolSummary(tool, summary string, params map[string]interface{}, s *styles) string {
	if r, ok := toolRenderers[tool]; ok && r.enrichSummary != nil {
		return r.enrichSummary(summary, params)
	}
	return summary
}

// updateContextStats updates context window tracking from context_usage events.
func updateContextStats(m *model, e *agent.AgentEvent) {
	if e.ContextWindow > 0 {
		m.stats.lastContextWindow = e.ContextWindow
		used := e.CumulativeTokens
		if used == 0 {
			used = e.InputTokens + e.OutputTokens
		}
		pct := used * 100 / e.ContextWindow
		if pct > 100 {
			pct = 100
		}
		m.stats.lastContextPct = pct
	}
	if e.CumulativeTokens > 0 {
		m.stream.turnTokens = e.CumulativeTokens
	} else if e.InputTokens+e.OutputTokens > 0 {
		m.stream.turnTokens = e.InputTokens + e.OutputTokens
	}
}
