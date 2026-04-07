package main

import (
	"fmt"
	"strconv"
	"strings"

	tea "github.com/charmbracelet/bubbletea"
)

// handleApprovalKey processes key input during tool approval state.
// Uses Claude Code-style selectable list: up/down to navigate, Enter to confirm.
func handleApprovalKey(m *model, key tea.KeyMsg) tea.Cmd {
	switch key.String() {
	case "up":
		if m.prompt.approvalSel > 0 {
			m.prompt.approvalSel--
		}
	case "down":
		if m.prompt.approvalSel < approvalOptionCount-1 {
			m.prompt.approvalSel++
		}
	case "1":
		m.prompt.approvalSel = 0
		return submitApproval(m)
	case "2":
		m.prompt.approvalSel = 1
		return submitApproval(m)
	case "3":
		m.prompt.approvalSel = 2
		return submitApproval(m)
	case "enter":
		return submitApproval(m)
	case "esc":
		// Esc = deny
		m.prompt.approvalSel = 2
		return submitApproval(m)
	// Keep legacy y/n/a as quick shortcuts
	case "y":
		m.prompt.approvalSel = 0
		return submitApproval(m)
	case "a":
		m.prompt.approvalSel = 1
		return submitApproval(m)
	case "n":
		m.prompt.approvalSel = 2
		return submitApproval(m)
	}
	return nil
}

func submitApproval(m *model) tea.Cmd {
	actions := []string{"allow_once", "allow_session", "deny_once"}
	labels := []string{"Allowed", "Always allowed", "Denied"}

	action := actions[m.prompt.approvalSel]
	label := labels[m.prompt.approvalSel]

	if err := m.backend.SendToolApprovalResponse(m.prompt.approvalID, action, "", nil); err != nil {
		m.appendActive(&displayMessage{kind: msgError, content: err.Error()})
	} else {
		m.appendActive(&displayMessage{kind: msgSystem, content: "✓ " + label})
	}
	m.state = stateRunning
	m.prompt.approvalSel = 0
	m.input.Blur()
	return nil
}

// handleQuestionKey processes key input during user question state.
func handleQuestionKey(m *model, key tea.KeyMsg) tea.Cmd {
	switch key.String() {
	case "up":
		if m.prompt.selectedOpt > 0 {
			m.prompt.selectedOpt--
		}
	case "down":
		maxOpts := 0
		for _, q := range m.prompt.questions {
			maxOpts += len(q.Options)
		}
		if m.prompt.selectedOpt < maxOpts-1 {
			m.prompt.selectedOpt++
		}
	case "enter":
		return submitQuestionAnswer(m, "")
	default:
		s := key.String()
		if num, err := strconv.Atoi(s); err == nil {
			for _, q := range m.prompt.questions {
				if num >= 1 && num <= len(q.Options) {
					return submitQuestionAnswer(m, q.Options[num-1].Label)
				}
			}
		}
		var cmd tea.Cmd
		m.input, cmd = m.input.Update(key)
		return cmd
	}
	return nil
}

// submitQuestionAnswer handles user response to questions.
// NOTE: Currently only supports answering the first question when multiple are sent.
// All questions receive the same answer. Multi-question support requires per-question
// step-through UI (future enhancement).
func submitQuestionAnswer(m *model, answer string) tea.Cmd {
	if answer == "" {
		answer = strings.TrimSpace(m.input.Value())
	}
	if answer == "" {
		for _, q := range m.prompt.questions {
			if len(q.Options) > 0 && m.prompt.selectedOpt >= 0 && m.prompt.selectedOpt < len(q.Options) {
				answer = q.Options[m.prompt.selectedOpt].Label
			}
		}
	}

	answers := make(map[string]string)
	for _, q := range m.prompt.questions {
		key := q.Header
		if key == "" {
			key = q.Question
		}
		// Use a per-iteration copy so numeric resolution for one question
		// doesn't mutate the answer seen by subsequent questions.
		resolved := answer
		if num, err := strconv.Atoi(resolved); err == nil {
			if num >= 1 && num <= len(q.Options) {
				resolved = q.Options[num-1].Label
			}
		}
		answers[key] = resolved
	}

	m.appendActive(&displayMessage{
		kind:    msgSystem,
		content: fmt.Sprintf("✓ Selected: %s", answer),
	})

	if err := m.backend.SendUserQuestionResponse(m.prompt.questionID, answers); err != nil {
		m.appendActive(&displayMessage{kind: msgError, content: err.Error()})
	}
	m.state = stateRunning
	m.input.SetValue("")
	m.input.Blur()
	return nil
}

// handlePlanKey processes key input during plan review or reason states.
func handlePlanKey(m *model, key tea.KeyMsg) tea.Cmd {
	if m.state == stateReason {
		if key.String() == "enter" {
			reason := strings.TrimSpace(m.input.Value())
			m.backend.SendPlanApprovalResponse(m.prompt.planID, false, reason)
			m.appendActive(&displayMessage{
				kind: msgSystem,
				content: "Plan rejected" + func() string {
					if reason != "" {
						return ": " + reason
					}
					return ""
				}(),
			})
			m.state = stateRunning
			m.input.SetValue("")
			m.input.Blur()
			return nil
		}
		var cmd tea.Cmd
		m.input, cmd = m.input.Update(key)
		return cmd
	}

	// statePlanReview — selectable list
	switch key.String() {
	case "up":
		if m.prompt.selectedOpt > 0 {
			m.prompt.selectedOpt--
		}
	case "down":
		if m.prompt.selectedOpt < planOptionCount-1 {
			m.prompt.selectedOpt++
		}
	case "1":
		m.prompt.selectedOpt = 0
		return submitPlanDecision(m)
	case "2":
		m.prompt.selectedOpt = 1
		return submitPlanDecision(m)
	case "enter":
		return submitPlanDecision(m)
	case "esc":
		m.prompt.selectedOpt = 1
		return submitPlanDecision(m)
	// Legacy shortcuts
	case "a":
		m.prompt.selectedOpt = 0
		return submitPlanDecision(m)
	case "r":
		m.prompt.selectedOpt = 1
		return submitPlanDecision(m)
	}
	return nil
}

func submitPlanDecision(m *model) tea.Cmd {
	if m.prompt.selectedOpt == 0 {
		// Approve
		m.backend.SendPlanApprovalResponse(m.prompt.planID, true, "")
		m.appendActive(&displayMessage{kind: msgSystem, content: "✓ Plan approved"})
		m.state = stateRunning
		m.prompt.selectedOpt = 0
		m.input.Blur()
	} else {
		// Reject — enter reason mode
		m.appendActive(&displayMessage{kind: msgSystem, content: "Enter rejection reason (Enter to skip):"})
		m.state = stateReason
		m.prompt.selectedOpt = 0
		m.input.Focus()
		m.input.SetValue("")
	}
	return nil
}
