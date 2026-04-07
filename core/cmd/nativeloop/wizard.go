package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/bubbles/textinput"
	"github.com/charmbracelet/lipgloss"
)

// detectFirstRun checks if the user needs to go through setup.
func detectFirstRun() bool {
	// Check for API key
	if os.Getenv("ANTHROPIC_API_KEY") != "" {
		return false
	}
	if os.Getenv("CLAUDE_CODE_OAUTH_TOKEN") != "" {
		return false
	}

	// Check for settings file
	home, err := os.UserHomeDir()
	if err != nil {
		return true
	}
	settingsPath := filepath.Join(home, ".chatml", "settings.json")
	if _, err := os.Stat(settingsPath); err == nil {
		// Settings exist — check if API key is configured
		data, _ := os.ReadFile(settingsPath)
		var settings map[string]interface{}
		if json.Unmarshal(data, &settings) == nil {
			if _, ok := settings["apiKey"]; ok {
				return false
			}
		}
	}

	return true
}

// wizardStep tracks the current step in the setup wizard.
type wizardStep int

const (
	wizardWelcome wizardStep = iota
	wizardAPIKey
	wizardModelSelect
	wizardPermMode
	wizardDone
)

// wizardModel is a separate BubbleTea model for the setup wizard.
type wizardModel struct {
	step     wizardStep
	input    textinput.Model
	apiKey   string
	model    string
	permMode string
	selected int // for multi-choice steps
	width    int
	done     bool
}

type wizardResult struct {
	APIKey   string
	Model    string
	PermMode string
}

func newWizardModel() wizardModel {
	ti := textinput.New()
	ti.Placeholder = "sk-ant-..."
	ti.EchoMode = textinput.EchoPassword
	ti.Focus()
	ti.CharLimit = 200

	return wizardModel{
		step:     wizardWelcome,
		input:    ti,
		model:    "claude-sonnet-4-6",
		permMode: "default",
	}
}

func (m wizardModel) Init() tea.Cmd {
	return textinput.Blink
}

func (m wizardModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.width = msg.Width

	case tea.KeyMsg:
		switch msg.String() {
		case "ctrl+c", "ctrl+d":
			m.done = true
			return m, tea.Quit
		case "esc":
			m.done = true
			return m, tea.Quit
		}

		switch m.step {
		case wizardWelcome:
			if msg.String() == "enter" {
				m.step = wizardAPIKey
				m.input.Focus()
			}

		case wizardAPIKey:
			switch msg.String() {
			case "enter":
				key := strings.TrimSpace(m.input.Value())
				if key != "" {
					m.apiKey = key
					m.step = wizardModelSelect
					m.selected = 1 // Default to Sonnet
				}
			default:
				var cmd tea.Cmd
				m.input, cmd = m.input.Update(msg)
				return m, cmd
			}

		case wizardModelSelect:
			switch msg.String() {
			case "up":
				if m.selected > 0 {
					m.selected--
				}
			case "down":
				if m.selected < 2 {
					m.selected++
				}
			case "enter":
				switch m.selected {
				case 0:
					m.model = "claude-opus-4-6"
				case 1:
					m.model = "claude-sonnet-4-6"
				case 2:
					m.model = "claude-haiku-4-5-20251001"
				}
				m.step = wizardPermMode
				m.selected = 0
			}

		case wizardPermMode:
			switch msg.String() {
			case "up":
				if m.selected > 0 {
					m.selected--
				}
			case "down":
				if m.selected < 2 {
					m.selected++
				}
			case "enter":
				switch m.selected {
				case 0:
					m.permMode = "default"
				case 1:
					m.permMode = "acceptEdits"
				case 2:
					m.permMode = "bypassPermissions"
				}
				m.step = wizardDone
				// Save config
				m.saveConfig()
				m.done = true
				return m, tea.Quit
			}
		}
	}
	return m, nil
}

func (m wizardModel) View() string {
	purple := lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("#7C3AED"))
	green := lipgloss.NewStyle().Foreground(lipgloss.Color("#22C55E"))
	gray := lipgloss.NewStyle().Foreground(lipgloss.Color("#6B7280"))
	yellow := lipgloss.NewStyle().Foreground(lipgloss.Color("#F59E0B"))

	var sb strings.Builder
	sb.WriteString("\n")

	switch m.step {
	case wizardWelcome:
		sb.WriteString(purple.Render("  ╔═══════════════════════════════╗") + "\n")
		sb.WriteString(purple.Render("  ║     Welcome to ChatML CLI    ║") + "\n")
		sb.WriteString(purple.Render("  ╚═══════════════════════════════╝") + "\n\n")
		sb.WriteString(gray.Render("  Let's set up your environment.\n\n"))
		sb.WriteString(green.Render("  Press Enter to continue...") + "\n")

	case wizardAPIKey:
		sb.WriteString(purple.Render("  Step 1/3: API Key") + "\n\n")
		sb.WriteString(gray.Render("  Enter your Anthropic API key:") + "\n\n")
		sb.WriteString("  " + m.input.View() + "\n\n")
		sb.WriteString(gray.Render("  Get one at: https://console.anthropic.com/") + "\n")

	case wizardModelSelect:
		sb.WriteString(purple.Render("  Step 2/3: Default Model") + "\n\n")
		models := []struct{ name, desc string }{
			{"Opus 4.6", "Most capable — complex tasks, deep analysis"},
			{"Sonnet 4.6", "Balanced — good for most tasks (recommended)"},
			{"Haiku 4.5", "Fastest — quick tasks, lower cost"},
		}
		for i, mod := range models {
			if i == m.selected {
				sb.WriteString(yellow.Render(fmt.Sprintf("  › %s", mod.name)) + " " + gray.Render(mod.desc) + "\n")
			} else {
				sb.WriteString(gray.Render(fmt.Sprintf("    %s — %s", mod.name, mod.desc)) + "\n")
			}
		}

	case wizardPermMode:
		sb.WriteString(purple.Render("  Step 3/3: Permission Mode") + "\n\n")
		modes := []struct{ name, desc string }{
			{"Default", "Ask before running commands or editing files"},
			{"Accept Edits", "Auto-approve file edits, ask for commands"},
			{"Bypass", "Auto-approve everything (for trusted projects)"},
		}
		for i, mod := range modes {
			if i == m.selected {
				sb.WriteString(yellow.Render(fmt.Sprintf("  › %s", mod.name)) + " " + gray.Render(mod.desc) + "\n")
			} else {
				sb.WriteString(gray.Render(fmt.Sprintf("    %s — %s", mod.name, mod.desc)) + "\n")
			}
		}

	case wizardDone:
		sb.WriteString(green.Render("  ✓ Setup complete!") + "\n\n")
		sb.WriteString(gray.Render(fmt.Sprintf("  Model: %s", m.model)) + "\n")
		sb.WriteString(gray.Render(fmt.Sprintf("  Mode: %s", m.permMode)) + "\n")
	}

	return sb.String()
}

func (m *wizardModel) saveConfig() {
	home, err := os.UserHomeDir()
	if err != nil {
		return
	}

	configDir := filepath.Join(home, ".chatml")
	os.MkdirAll(configDir, 0700) //nolint:errcheck

	settings := map[string]interface{}{
		"apiKey": m.apiKey,
		"model":  m.model,
		"permissions": map[string]interface{}{
			"defaultMode": m.permMode,
		},
	}

	data, err := json.MarshalIndent(settings, "", "  ")
	if err != nil {
		fmt.Fprintf(os.Stderr, "warning: failed to marshal settings: %v\n", err)
		return
	}
	settingsPath := filepath.Join(configDir, "settings.json")
	if err := os.WriteFile(settingsPath, data, 0600); err != nil {
		fmt.Fprintf(os.Stderr, "warning: failed to save settings to %s: %v\n", settingsPath, err)
	}

	// Also set the env var for the current process
	os.Setenv("ANTHROPIC_API_KEY", m.apiKey)
}

// runWizard runs the setup wizard and returns the result.
func runWizard() *wizardResult {
	wm := newWizardModel()
	p := tea.NewProgram(wm)
	finalModel, err := p.Run()
	if err != nil {
		return nil
	}

	fm, ok := finalModel.(wizardModel)
	if !ok || !fm.done || fm.apiKey == "" {
		return nil
	}

	return &wizardResult{
		APIKey:   fm.apiKey,
		Model:    fm.model,
		PermMode: fm.permMode,
	}
}
