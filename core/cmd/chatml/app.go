package main

import (
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/chatml/chatml-core/agent"
)

type appState struct {
	mu       sync.Mutex
	renderer *renderer
	backend  agent.ConversationBackend
	spinner  *spinner

	// Config
	model    string
	permMode string
	fastMode bool
	verbose  bool
	workdir  string
	width    int

	// Session tracking
	running  bool
	turnDone chan struct{} // Closed when a turn completes; recreated per turn
	stats    sessionStats

	// Streaming buffers
	assistantBuf strings.Builder
	thinkingBuf  strings.Builder
}

type sessionStats struct {
	totalCost         float64
	totalInputTokens  int
	totalOutputTokens int
	totalCacheRead    int
	totalTurns        int
	startTime         time.Time
	turnStartTime     time.Time
}

func (a *appState) isRunning() bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.running
}

func (a *appState) setRunning(v bool) {
	a.mu.Lock()
	a.running = v
	if !v && a.turnDone != nil {
		select {
		case <-a.turnDone:
			// Already closed
		default:
			close(a.turnDone)
		}
	}
	a.mu.Unlock()
}

func (a *appState) processEvents() {
	for line := range a.backend.Output() {
		var e agent.AgentEvent
		if err := json.Unmarshal([]byte(line), &e); err != nil {
			continue
		}
		a.handleEvent(&e)
	}
}

func (a *appState) handleEvent(e *agent.AgentEvent) {
	switch e.Type {
	case agent.EventTypeReady:
		// Backend ready

	case agent.EventTypeSessionStarted:
		if a.verbose {
			a.renderer.printSystem(fmt.Sprintf("Session: %s", e.SessionID))
		}

	case agent.EventTypeAssistantText:
		a.mu.Lock()
		a.assistantBuf.WriteString(e.Content)
		a.mu.Unlock()
		// Stream directly to stdout
		a.renderer.printChunk(e.Content)

	case agent.EventTypeThinking, agent.EventTypeThinkingDelta:
		a.mu.Lock()
		a.thinkingBuf.WriteString(e.Content)
		a.mu.Unlock()
		// Don't print thinking inline - show summary on turn_complete

	case agent.EventTypeToolStart:
		a.spinner.Stop()
		a.flushAssistant()
		a.renderer.printToolStart(e.Tool, e.Params, a.workdir)
		a.spinner.Start(fmt.Sprintf("Running %s...", e.Tool))

	case agent.EventTypeToolEnd:
		a.spinner.Stop()
		a.renderer.printToolEnd(e.Tool, e.Params, e.Summary, e.Success, a.workdir)

	case agent.EventTypeToolApprovalRequest:
		a.spinner.Stop()
		a.flushAssistant()
		result := promptToolApproval(e.Tool, e.Specifier, a.renderer.s)
		if err := a.backend.SendToolApprovalResponse(e.RequestID, result.action, result.specifier, result.input); err != nil {
			a.renderer.printError("Failed to send approval: " + err.Error())
			a.setRunning(false)
		}

	case agent.EventTypeUserQuestionRequest:
		a.spinner.Stop()
		a.flushAssistant()
		var questions []agent.UserQuestion
		if e.Questions != nil {
			questions = e.Questions
		}
		result := promptUserQuestion(questions, a.renderer.s)
		if err := a.backend.SendUserQuestionResponse(e.RequestID, result.answers); err != nil {
			a.renderer.printError("Failed to send answer: " + err.Error())
			a.setRunning(false)
		}

	case agent.EventTypePlanApprovalRequest:
		a.spinner.Stop()
		a.flushAssistant()
		if e.PlanContent != "" {
			a.renderer.printPlanContent(e.PlanContent)
		}
		result := promptPlanReview(a.renderer.s)
		if err := a.backend.SendPlanApprovalResponse(e.RequestID, result.approved, result.reason); err != nil {
			a.renderer.printError("Failed to send plan approval: " + err.Error())
			a.setRunning(false)
		}

	case agent.EventTypeResult:
		a.updateStats(e)
		// Update spinner with token count
		tokens := 0
		if e.Usage != nil {
			if v, ok := e.Usage["input_tokens"]; ok {
				if f, ok := v.(float64); ok {
					tokens += int(f)
				}
			}
			if v, ok := e.Usage["output_tokens"]; ok {
				if f, ok := v.(float64); ok {
					tokens += int(f)
				}
			}
		}
		if tokens > 0 {
			a.spinner.Update(fmt.Sprintf("Generating... %s tokens", formatNum(tokens)))
		}

	case agent.EventTypeTurnComplete:
		a.spinner.Stop()
		a.flushAssistant()
		a.mu.Lock()
		a.running = false
		thinkLen := a.thinkingBuf.Len()
		a.thinkingBuf.Reset()
		a.stats.totalTurns++
		a.mu.Unlock()

		// Print turn summary
		summary := fmt.Sprintf("Turn complete: %d turns", a.stats.totalTurns)
		if a.stats.totalCost > 0 {
			summary += fmt.Sprintf(" | $%.4f", a.stats.totalCost)
		}
		if thinkLen > 0 {
			summary += fmt.Sprintf(" | %s chars thinking", formatNum(thinkLen))
		}
		a.renderer.printTurnSummary(summary)

	case agent.EventTypeError:
		a.spinner.Stop()
		a.renderer.printError(e.Message)

	case agent.EventTypeComplete:
		a.spinner.Stop()
		a.flushAssistant()

	case agent.EventTypeContextUsage:
		// Could show in status, but no persistent status bar

	case agent.EventTypeSubagentStarted:
		a.spinner.Stop()
		desc := e.AgentDescription
		if desc == "" {
			desc = "Sub-agent"
		}
		a.renderer.printToolStart("Agent", map[string]interface{}{"description": desc}, a.workdir)
		a.spinner.Start(fmt.Sprintf("Running Agent: %s", desc))

	case agent.EventTypeSubagentStopped:
		a.spinner.Stop()
		a.renderer.printAgentStopped(e.Summary, e.DurationMs)

	case agent.EventTypeSubagentOutput:
		// Parse nested event for tool progress
		if e.AgentOutput != "" {
			var sub agent.AgentEvent
			if json.Unmarshal([]byte(e.AgentOutput), &sub) == nil {
				switch sub.Type {
				case agent.EventTypeToolStart:
					a.spinner.Update(fmt.Sprintf("Agent: %s %s", sub.Tool, extractToolParams(sub.Tool, sub.Params, a.workdir)))
				case agent.EventTypeToolEnd:
					param := extractToolParams(sub.Tool, sub.Params, a.workdir)
					a.renderer.printSubagentTool(sub.Tool, param, sub.Summary, sub.Success)
				case agent.EventTypeError:
					a.renderer.printError("Agent: " + sub.Message)
				}
			}
		}

	case agent.EventTypePermModeChanged:
		a.mu.Lock()
		a.permMode = e.Mode
		a.mu.Unlock()
		a.renderer.printSystem(fmt.Sprintf("Mode -> %s", e.Mode))

	case agent.EventTypeModelChanged:
		a.mu.Lock()
		a.model = e.Model
		a.mu.Unlock()
		a.renderer.printSystem(fmt.Sprintf("Model -> %s", e.Model))

	case agent.EventTypeInterrupted:
		a.spinner.Stop()
		a.flushAssistant()
		a.mu.Lock()
		a.running = false
		a.mu.Unlock()
		a.renderer.printSystem("Interrupted")

	case agent.EventTypeCompactBoundary:
		a.renderer.printSystem("Compacting context...")

	case agent.EventTypePostCompact:
		summary := "Context compacted"
		if e.CompactSummary != "" {
			summary += ": " + truncate(e.CompactSummary, 60)
		}
		a.renderer.printSystem(summary)

	default:
		if a.verbose {
			a.renderer.printSystem(fmt.Sprintf("[event: %s]", e.Type))
		}
	}
}

func (a *appState) flushAssistant() {
	a.mu.Lock()
	hadContent := a.assistantBuf.Len() > 0
	a.assistantBuf.Reset()
	a.mu.Unlock()
	if hadContent {
		// Content was already streamed chunk-by-chunk in assistant_text handler
		fmt.Fprintln(a.renderer.out) // End the assistant text block with newline
	}
}

func (a *appState) updateStats(e *agent.AgentEvent) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if e.Cost > 0 {
		a.stats.totalCost += e.Cost
	}
	if e.Usage != nil {
		if v, ok := e.Usage["input_tokens"].(float64); ok {
			a.stats.totalInputTokens += int(v)
		}
		if v, ok := e.Usage["output_tokens"].(float64); ok {
			a.stats.totalOutputTokens += int(v)
		}
	}
}
