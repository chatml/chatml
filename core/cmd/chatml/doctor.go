package main

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/chatml/chatml-core/mcp"
	"github.com/chatml/chatml-core/paths"
)

// runDoctor performs diagnostic checks and returns a formatted report.
func runDoctor(workdir string) string {
	var sb strings.Builder
	sb.WriteString("=== Doctor Report ===\n\n")

	pass := 0
	warn := 0
	fail := 0

	check := func(name string, fn func() (string, bool)) {
		result, ok := fn()
		if ok {
			sb.WriteString(fmt.Sprintf("  ✓ %s: %s\n", name, result))
			pass++
		} else {
			sb.WriteString(fmt.Sprintf("  ✗ %s: %s\n", name, result))
			fail++
		}
	}

	info := func(name, value string) {
		sb.WriteString(fmt.Sprintf("  ℹ %s: %s\n", name, value))
	}

	warnFn := func(name, value string) {
		sb.WriteString(fmt.Sprintf("  ⚠ %s: %s\n", name, value))
		warn++
	}

	// --- Environment ---
	sb.WriteString("[Environment]\n")
	info("Platform", runtime.GOOS+"/"+runtime.GOARCH)
	info("Go version", runtime.Version())
	info("Working directory", workdir)

	check("Git installed", func() (string, bool) {
		out, err := exec.Command("git", "--version").Output()
		if err != nil {
			return "not found", false
		}
		return strings.TrimSpace(string(out)), true
	})

	check("Git repository", func() (string, bool) {
		cmd := exec.Command("git", "rev-parse", "--git-dir")
		cmd.Dir = workdir
		if err := cmd.Run(); err != nil {
			return "not a git repo", false
		}
		return "yes", true
	})

	check("Ripgrep installed", func() (string, bool) {
		out, err := exec.Command("rg", "--version").Output()
		if err != nil {
			return "not found (Grep tool requires ripgrep)", false
		}
		return strings.TrimSpace(strings.Split(string(out), "\n")[0]), true
	})

	// --- Configuration ---
	sb.WriteString("\n[Configuration]\n")

	check("User settings", func() (string, bool) {
		path := filepath.Join(paths.UserSettingsDir(), "settings.json")
		if _, err := os.Stat(path); err != nil {
			return "not found (optional)", true // Not required
		}
		return path, true
	})

	check("Project settings", func() (string, bool) {
		path := filepath.Join(paths.ProjectSettingsDir(workdir), "settings.json")
		if _, err := os.Stat(path); err != nil {
			return "not found (optional)", true
		}
		return path, true
	})

	check("CLAUDE.md", func() (string, bool) {
		for _, name := range []string{"CLAUDE.md", ".claude/CLAUDE.md"} {
			path := filepath.Join(workdir, name)
			if _, err := os.Stat(path); err == nil {
				return path, true
			}
		}
		return "not found (optional)", true
	})

	check("Hooks config", func() (string, bool) {
		path := filepath.Join(workdir, ".claude", "hooks.json")
		if _, err := os.Stat(path); err == nil {
			return path, true
		}
		return "not found (optional)", true
	})

	// --- Managed/Enterprise ---
	sb.WriteString("\n[Enterprise]\n")
	managed := paths.LoadManagedSettings()
	if managed != nil {
		info("Managed settings", "active ("+paths.ManagedSettingsDir()+")")
	} else {
		info("Managed settings", "not configured")
	}

	// --- MCP Servers ---
	sb.WriteString("\n[MCP Servers]\n")
	configs, err := mcp.LoadMCPConfig(workdir)
	if err != nil {
		warnFn("MCP config", "error loading: "+err.Error())
	} else if len(configs) == 0 {
		info("MCP servers", "none configured (.mcp.json not found)")
	} else {
		for _, cfg := range configs {
			status := "enabled"
			if !cfg.Enabled {
				status = "disabled"
			}
			if cfg.Type != "" && cfg.Type != "stdio" {
				warnFn("MCP "+cfg.Name, fmt.Sprintf("unsupported transport: %s", cfg.Type))
			} else {
				// Quick check: does the command exist?
				if cfg.Command != "" {
					if _, err := exec.LookPath(cfg.Command); err != nil {
						warnFn("MCP "+cfg.Name, fmt.Sprintf("command not found: %s", cfg.Command))
					} else {
						check("MCP "+cfg.Name, func() (string, bool) {
							return fmt.Sprintf("%s (%s, %s)", cfg.Command, cfg.Type, status), true
						})
					}
				}
			}
		}
	}

	// --- API Connectivity ---
	sb.WriteString("\n[API Connectivity]\n")
	check("Anthropic API", func() (string, bool) {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		req, _ := http.NewRequestWithContext(ctx, "GET", "https://api.anthropic.com/v1/models", nil)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			return "unreachable: " + err.Error(), false
		}
		resp.Body.Close()
		// 401 is expected without auth, but means the API is reachable
		if resp.StatusCode == 401 || resp.StatusCode == 200 {
			return "reachable", true
		}
		return fmt.Sprintf("status %d", resp.StatusCode), false
	})

	// --- API Key ---
	check("API key", func() (string, bool) {
		key := os.Getenv("ANTHROPIC_API_KEY")
		if key != "" {
			var masked string
			if len(key) >= 8 {
				masked = key[:4] + "..." + key[len(key)-4:]
			} else {
				masked = "***"
			}
			return "set (ANTHROPIC_API_KEY=" + masked + ")", true
		}
		token := os.Getenv("CLAUDE_CODE_OAUTH_TOKEN")
		if token != "" {
			return "set (OAuth token)", true
		}
		return "not set (ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN)", false
	})

	// --- Skills ---
	sb.WriteString("\n[Skills]\n")
	skillDirs := []string{
		filepath.Join(workdir, ".claude", "skills"),
	}
	if home, err := os.UserHomeDir(); err == nil {
		skillDirs = append(skillDirs, filepath.Join(home, ".claude", "skills"))
	}
	for _, dir := range skillDirs {
		entries, err := os.ReadDir(dir)
		if err != nil {
			continue
		}
		count := 0
		for _, e := range entries {
			if e.IsDir() {
				count++
			}
		}
		if count > 0 {
			info("Skills in "+dir, fmt.Sprintf("%d found", count))
		}
	}

	// --- Summary ---
	sb.WriteString(fmt.Sprintf("\n=== Summary: %d passed, %d warnings, %d failed ===\n", pass, warn, fail))

	return sb.String()
}
