package main

import (
	"fmt"
	"io"
	"strings"
	"time"

	"github.com/charmbracelet/glamour"
	"github.com/charmbracelet/lipgloss"
)

type renderer struct {
	out    io.Writer
	width  int
	s      *styles
	mdRend *glamour.TermRenderer
}

func newRenderer(out io.Writer, width int) *renderer {
	md, _ := glamour.NewTermRenderer(
		glamour.WithAutoStyle(),
		glamour.WithWordWrap(width-4),
	)
	return &renderer{out: out, width: width, s: newStyles(), mdRend: md}
}

func (r *renderer) printBanner(ver, model, mode, workdir string) {
	purple := lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("#7C3AED"))
	gray := lipgloss.NewStyle().Foreground(lipgloss.Color("#6B7280"))

	art := purple.Render("" +
		"   ██████╗██╗  ██╗ █████╗ ████████╗███╗   ███╗██╗\n" +
		"  ██╔════╝██║  ██║██╔══██╗╚══██╔══╝████╗ ████║██║\n" +
		"  ██║     ███████║███████║   ██║   ██╔████╔██║██║\n" +
		"  ██║     ██╔══██║██╔══██║   ██║   ██║╚██╔╝██║██║\n" +
		"  ╚██████╗██║  ██║██║  ██║   ██║   ██║ ╚═╝ ██║███████╗\n" +
		"   ╚═════╝╚═╝  ╚═╝╚═╝  ╚═╝   ╚═╝   ╚═╝     ╚═╝╚══════╝")

	fmt.Fprintln(r.out)
	fmt.Fprintln(r.out, art)
	fmt.Fprintln(r.out)
	fmt.Fprintln(r.out, gray.Render(fmt.Sprintf("  v%s | %s | %s", ver, model, mode)))
	fmt.Fprintln(r.out, gray.Render(fmt.Sprintf("  %s", workdir)))
	fmt.Fprintln(r.out)
}

func (r *renderer) printUser(text string) {
	fmt.Fprintln(r.out, r.s.userMsg.Render("  > "+text))
	fmt.Fprintln(r.out)
}

func (r *renderer) printChunk(text string) {
	// Stream assistant text directly -- no newline (chunks accumulate)
	fmt.Fprint(r.out, text)
}

func (r *renderer) printAssistant(text string) {
	// Full markdown rendering for complete blocks
	if r.mdRend != nil {
		rendered, err := r.mdRend.Render(text)
		if err == nil {
			text = strings.TrimSpace(rendered)
		}
	}
	fmt.Fprintln(r.out, text)
	fmt.Fprintln(r.out)
}

func (r *renderer) printToolStart(tool string, params map[string]interface{}, workdir string) {
	param := extractToolParams(tool, params, workdir)
	header := formatToolHeader(tool, param)
	if header == "" {
		return // Hidden tool (e.g. TodoWrite)
	}
	fmt.Fprintln(r.out, r.s.toolHeader.Render(header))
}

func (r *renderer) printToolEnd(tool string, params map[string]interface{}, summary string, success bool, workdir string) {
	// Build details
	details := buildToolDetailsLocal(tool, params, r.s, workdir)
	for _, d := range details {
		fmt.Fprintln(r.out, d)
	}

	// Enriched summary
	enriched := enrichToolSummaryLocal(tool, summary, params, r.s)
	clean := cleanSummary(enriched)

	if success {
		fmt.Fprintln(r.out, r.s.toolResult.Render(fmt.Sprintf("  | %s", clean)))
	} else {
		fmt.Fprintln(r.out, r.s.toolFail.Render(fmt.Sprintf("  x %s", clean)))
	}
	fmt.Fprintln(r.out)
}

func (r *renderer) printSubagentTool(tool, param, summary string, success bool) {
	// Indented sub-agent tool (nested under Agent block)
	line := fmt.Sprintf("  |-- %s", tool)
	if param != "" {
		line += " " + param
	}
	fmt.Fprintln(r.out, r.s.agentTree.Render(line))
}

func (r *renderer) printAgentStopped(summary string, durationMs int64) {
	if summary == "" {
		summary = "Done"
	}
	fmt.Fprintln(r.out, r.s.toolResult.Render(fmt.Sprintf("  | %s", summary)))
	fmt.Fprintln(r.out)
}

func (r *renderer) printPlanContent(content string) {
	if r.mdRend != nil {
		rendered, err := r.mdRend.Render(content)
		if err == nil {
			content = strings.TrimSpace(rendered)
		}
	}
	border := lipgloss.NewStyle().
		Border(lipgloss.RoundedBorder()).
		Padding(1, 2).
		Width(r.width - 4)
	fmt.Fprintln(r.out, border.Render(content))
}

func (r *renderer) printSystem(text string) {
	fmt.Fprintln(r.out, r.s.gray.Render("  "+text))
}

func (r *renderer) printError(text string) {
	fmt.Fprintln(r.out, r.s.errStyle.Render("  x "+text))
}

func (r *renderer) printTurnSummary(text string) {
	fmt.Fprintln(r.out)
	fmt.Fprintln(r.out, r.s.gray.Render("  "+text))
	fmt.Fprintln(r.out)
}

func (r *renderer) printStatusLine(model, mode string, cost float64, startTime time.Time) {
	green := lipgloss.NewStyle().Foreground(lipgloss.Color("#22C55E"))
	yellow := lipgloss.NewStyle().Foreground(lipgloss.Color("#F59E0B"))
	gray := lipgloss.NewStyle().Foreground(lipgloss.Color("#6B7280"))

	parts := []string{
		green.Render(model),
	}
	if cost > 0 {
		parts = append(parts, gray.Render(fmt.Sprintf("$%.4f", cost)))
	}
	if !startTime.IsZero() {
		dur := time.Since(startTime).Truncate(time.Minute)
		if dur >= time.Minute {
			parts = append(parts, gray.Render(formatDurationShort(dur)))
		}
	}
	parts = append(parts, yellow.Render(modeBadge(mode)))

	fmt.Fprintln(r.out, "  "+strings.Join(parts, " | "))
}
