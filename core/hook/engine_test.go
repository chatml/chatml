package hook

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestMatchPattern(t *testing.T) {
	tests := []struct {
		pattern, value string
		want           bool
	}{
		{"", "anything", true},
		{"*", "anything", true},
		{"Bash", "Bash", true},
		{"Bash", "Read", false},
		{"Bash*", "BashTool", true},
		{"Bash*", "Read", false},
		{"*Tool", "BashTool", true},
		{"*Tool", "Bash", false},
		{"Write", "Write", true},
	}
	for _, tt := range tests {
		t.Run(tt.pattern+"_"+tt.value, func(t *testing.T) {
			if got := matchPattern(tt.pattern, tt.value); got != tt.want {
				t.Errorf("matchPattern(%q, %q) = %v, want %v", tt.pattern, tt.value, got, tt.want)
			}
		})
	}
}

func TestMatchIfCondition(t *testing.T) {
	tests := []struct {
		condition, toolName string
		want                bool
	}{
		{"", "Bash", true},
		{"Bash", "Bash", true},
		{"Bash", "Read", false},
		{"Bash(git *)", "Bash", true},
		{"Bash(git *)", "Read", false},
	}
	for _, tt := range tests {
		t.Run(tt.condition+"_"+tt.toolName, func(t *testing.T) {
			if got := matchIfCondition(tt.condition, tt.toolName); got != tt.want {
				t.Errorf("matchIfCondition(%q, %q) = %v, want %v", tt.condition, tt.toolName, got, tt.want)
			}
		})
	}
}

func TestParseConfigNewFormat(t *testing.T) {
	data := `{
		"PreToolUse": [
			{
				"matcher": "Bash",
				"hooks": [
					{ "type": "command", "command": "echo test", "timeout": 5 }
				]
			}
		],
		"PostToolUse": [
			{
				"hooks": [
					{ "type": "command", "command": "echo done" }
				]
			}
		]
	}`

	cfg := ParseConfig([]byte(data))
	if len(cfg.Hooks) != 2 {
		t.Fatalf("expected 2 events, got %d", len(cfg.Hooks))
	}
	if len(cfg.Hooks[EventPreToolUse]) != 1 {
		t.Fatalf("expected 1 PreToolUse matcher group, got %d", len(cfg.Hooks[EventPreToolUse]))
	}
	if cfg.Hooks[EventPreToolUse][0].Matcher != "Bash" {
		t.Errorf("expected matcher 'Bash', got %q", cfg.Hooks[EventPreToolUse][0].Matcher)
	}
	if len(cfg.Hooks[EventPreToolUse][0].Hooks) != 1 {
		t.Fatalf("expected 1 hook, got %d", len(cfg.Hooks[EventPreToolUse][0].Hooks))
	}
	h := cfg.Hooks[EventPreToolUse][0].Hooks[0]
	if h.Command != "echo test" {
		t.Errorf("expected command 'echo test', got %q", h.Command)
	}
	if h.Timeout != 5 {
		t.Errorf("expected timeout 5, got %d", h.Timeout)
	}
}

func TestParseConfigLegacyFormat(t *testing.T) {
	data := `{
		"hooks": [
			{ "command": "echo legacy", "timeout": 3, "events": ["PreToolUse", "PostToolUse"] }
		]
	}`

	cfg := ParseConfig([]byte(data))
	if len(cfg.LegacyHooks) != 1 {
		t.Fatalf("expected 1 legacy hook, got %d", len(cfg.LegacyHooks))
	}
	if cfg.LegacyHooks[0].Command != "echo legacy" {
		t.Errorf("expected 'echo legacy', got %q", cfg.LegacyHooks[0].Command)
	}
}

func TestMergeConfigs(t *testing.T) {
	c1 := Config{
		Hooks: map[string][]MatcherGroup{
			EventPreToolUse: {{Hooks: []HookDef{{Type: HookTypeCommand, Command: "a"}}}},
		},
	}
	c2 := Config{
		Hooks: map[string][]MatcherGroup{
			EventPreToolUse: {{Hooks: []HookDef{{Type: HookTypeCommand, Command: "b"}}}},
			EventPostToolUse: {{Hooks: []HookDef{{Type: HookTypeCommand, Command: "c"}}}},
		},
	}

	merged := MergeConfigs(c1, c2)
	if len(merged.Hooks[EventPreToolUse]) != 2 {
		t.Errorf("expected 2 PreToolUse groups, got %d", len(merged.Hooks[EventPreToolUse]))
	}
	if len(merged.Hooks[EventPostToolUse]) != 1 {
		t.Errorf("expected 1 PostToolUse group, got %d", len(merged.Hooks[EventPostToolUse]))
	}
}

func TestEngineCommandHook(t *testing.T) {
	cfg := Config{
		Hooks: map[string][]MatcherGroup{
			EventPreToolUse: {
				{
					Matcher: "Bash",
					Hooks: []HookDef{
						{
							Type:    HookTypeCommand,
							Command: `echo '{"permissionDecision":"deny","denyMessage":"blocked by test"}'`,
							Timeout: 5,
						},
					},
				},
			},
		},
	}

	engine := NewEngine(t.TempDir(), cfg)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	input := json.RawMessage(`{"command":"rm -rf /"}`)
	out, err := engine.RunPreToolUse(ctx, "Bash", input)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if out == nil {
		t.Fatal("expected non-nil output")
	}
	if out.PermissionDecision != "deny" {
		t.Errorf("expected 'deny', got %q", out.PermissionDecision)
	}
	if out.DenyMessage != "blocked by test" {
		t.Errorf("expected 'blocked by test', got %q", out.DenyMessage)
	}
}

func TestEngineMatcherFiltering(t *testing.T) {
	cfg := Config{
		Hooks: map[string][]MatcherGroup{
			EventPreToolUse: {
				{
					Matcher: "Write",
					Hooks: []HookDef{
						{
							Type:    HookTypeCommand,
							Command: `echo '{"permissionDecision":"deny"}'`,
						},
					},
				},
			},
		},
	}

	engine := NewEngine(t.TempDir(), cfg)
	ctx := context.Background()

	// Bash should NOT match the Write matcher
	out, err := engine.RunPreToolUse(ctx, "Bash", nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if out != nil && out.PermissionDecision != "" {
		t.Errorf("expected no permission decision for non-matching tool, got %q", out.PermissionDecision)
	}

	// Write should match
	out, err = engine.RunPreToolUse(ctx, "Write", nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if out == nil || out.PermissionDecision != "deny" {
		t.Errorf("expected 'deny' for matching Write tool")
	}
}

func TestEngineOnceHook(t *testing.T) {
	cfg := Config{
		Hooks: map[string][]MatcherGroup{
			EventPreToolUse: {
				{
					Hooks: []HookDef{
						{
							Type:    HookTypeCommand,
							Command: `echo '{"permissionDecision":"deny"}'`,
							Once:    true,
						},
					},
				},
			},
		},
	}

	engine := NewEngine(t.TempDir(), cfg)
	ctx := context.Background()

	// First call should return deny
	out, _ := engine.RunPreToolUse(ctx, "Bash", nil)
	if out == nil || out.PermissionDecision != "deny" {
		t.Fatalf("first call should deny")
	}

	// Second call should return nothing (once already fired)
	out, _ = engine.RunPreToolUse(ctx, "Bash", nil)
	if out != nil && out.PermissionDecision != "" {
		t.Errorf("second call should not deny (once hook), got %q", out.PermissionDecision)
	}
}

func TestEnginePostToolUse(t *testing.T) {
	cfg := Config{
		Hooks: map[string][]MatcherGroup{
			EventPostToolUse: {
				{
					Hooks: []HookDef{
						{
							Type:    HookTypeCommand,
							Command: `echo '{"additionalContext":"post-hook context"}'`,
						},
					},
				},
			},
		},
	}

	engine := NewEngine(t.TempDir(), cfg)
	ctx := context.Background()

	out, err := engine.RunPostToolUse(ctx, "Read", nil, "file contents")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if out == nil || out.AdditionalContext != "post-hook context" {
		t.Errorf("expected additional context from post hook")
	}
}

func TestEngineSessionHooks(t *testing.T) {
	cfg := Config{
		Hooks: map[string][]MatcherGroup{
			EventSessionStart: {
				{
					Hooks: []HookDef{
						{
							Type:    HookTypeCommand,
							Command: `echo '{"additionalContext":"session started"}'`,
						},
					},
				},
			},
		},
	}

	engine := NewEngine(t.TempDir(), cfg)
	ctx := context.Background()

	result, err := engine.RunSessionStart(ctx, "test-session")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result == nil || len(result.AdditionalContexts) == 0 {
		t.Errorf("expected additional context from session start hook")
	}
}

func TestLoadConfigFromFile(t *testing.T) {
	tmpDir := t.TempDir()
	claudeDir := filepath.Join(tmpDir, ".claude")
	os.MkdirAll(claudeDir, 0755)

	hookData := `{
		"PreToolUse": [
			{ "hooks": [{ "type": "command", "command": "echo loaded" }] }
		]
	}`
	os.WriteFile(filepath.Join(claudeDir, "hooks.json"), []byte(hookData), 0644)

	cfg := LoadConfig(tmpDir)
	if len(cfg.Hooks[EventPreToolUse]) != 1 {
		t.Errorf("expected 1 PreToolUse group from file, got %d", len(cfg.Hooks[EventPreToolUse]))
	}
}

func TestLoadConfigFromSettings(t *testing.T) {
	tmpDir := t.TempDir()
	claudeDir := filepath.Join(tmpDir, ".claude")
	os.MkdirAll(claudeDir, 0755)

	settingsData := `{
		"permissions": {},
		"hooks": {
			"PostToolUse": [
				{ "hooks": [{ "type": "command", "command": "echo from-settings" }] }
			]
		}
	}`
	os.WriteFile(filepath.Join(claudeDir, "settings.json"), []byte(settingsData), 0644)

	cfg := LoadConfig(tmpDir)
	if len(cfg.Hooks[EventPostToolUse]) != 1 {
		t.Errorf("expected 1 PostToolUse group from settings, got %d", len(cfg.Hooks[EventPostToolUse]))
	}
}

func TestEngineLegacyBackcompat(t *testing.T) {
	cfg := Config{
		LegacyHooks: []LegacyHookConfig{
			{
				Command: `echo '{"permissionDecision":"allow"}'`,
				Events:  []string{EventPreToolUse},
				Timeout: 5,
			},
		},
	}

	engine := NewEngine(t.TempDir(), cfg)
	ctx := context.Background()

	out, err := engine.RunPreToolUse(ctx, "Bash", nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if out == nil || out.PermissionDecision != "allow" {
		t.Error("expected legacy hook to produce 'allow'")
	}
}

func TestAllEventsValid(t *testing.T) {
	for _, event := range AllEvents {
		if !isKnownEvent(event) {
			t.Errorf("event %q not recognized by isKnownEvent", event)
		}
	}
}
