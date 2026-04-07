package scripts

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestConfigPath(t *testing.T) {
	got := ConfigPath("/workspace/myproject")
	want := filepath.Join("/workspace/myproject", ".chatml", "config.json")
	if got != want {
		t.Errorf("ConfigPath() = %q, want %q", got, want)
	}
}

func TestLoadConfig_NotFound(t *testing.T) {
	dir := t.TempDir()
	config, err := LoadConfig(dir)
	if err != nil {
		t.Fatalf("LoadConfig() error = %v", err)
	}
	if config != nil {
		t.Errorf("LoadConfig() = %v, want nil for missing config", config)
	}
}

func TestLoadConfig_ValidConfig(t *testing.T) {
	dir := t.TempDir()
	configDir := filepath.Join(dir, ConfigDir)
	if err := os.MkdirAll(configDir, 0755); err != nil {
		t.Fatal(err)
	}

	cfg := ChatMLConfig{
		SetupScripts: []ScriptDef{
			{Name: "Install", Command: "npm install"},
		},
		RunScripts: map[string]ScriptDef{
			"test": {Name: "Tests", Command: "npm test"},
		},
		AutoSetup: true,
	}

	data, _ := json.MarshalIndent(cfg, "", "  ")
	if err := os.WriteFile(filepath.Join(configDir, ConfigFile), data, 0644); err != nil {
		t.Fatal(err)
	}

	loaded, err := LoadConfig(dir)
	if err != nil {
		t.Fatalf("LoadConfig() error = %v", err)
	}
	if loaded == nil {
		t.Fatal("LoadConfig() returned nil")
	}
	if len(loaded.SetupScripts) != 1 {
		t.Errorf("SetupScripts len = %d, want 1", len(loaded.SetupScripts))
	}
	if loaded.SetupScripts[0].Command != "npm install" {
		t.Errorf("SetupScripts[0].Command = %q, want %q", loaded.SetupScripts[0].Command, "npm install")
	}
	if loaded.RunScripts["test"].Command != "npm test" {
		t.Errorf("RunScripts[test].Command = %q, want %q", loaded.RunScripts["test"].Command, "npm test")
	}
	if !loaded.AutoSetup {
		t.Error("AutoSetup = false, want true")
	}
}

func TestLoadConfig_InvalidJSON(t *testing.T) {
	dir := t.TempDir()
	configDir := filepath.Join(dir, ConfigDir)
	os.MkdirAll(configDir, 0755)
	os.WriteFile(filepath.Join(configDir, ConfigFile), []byte("{invalid json"), 0644)

	_, err := LoadConfig(dir)
	if err == nil {
		t.Error("LoadConfig() expected error for invalid JSON")
	}
}

func TestLoadConfig_InvalidConfig(t *testing.T) {
	dir := t.TempDir()
	configDir := filepath.Join(dir, ConfigDir)
	os.MkdirAll(configDir, 0755)

	// Config with empty command - should fail validation
	cfg := ChatMLConfig{
		SetupScripts: []ScriptDef{
			{Name: "Install", Command: ""},
		},
	}
	data, _ := json.MarshalIndent(cfg, "", "  ")
	os.WriteFile(filepath.Join(configDir, ConfigFile), data, 0644)

	_, err := LoadConfig(dir)
	if err == nil {
		t.Error("LoadConfig() expected error for invalid config")
	}
}

func TestWriteConfig(t *testing.T) {
	dir := t.TempDir()
	cfg := &ChatMLConfig{
		SetupScripts: []ScriptDef{
			{Name: "Build", Command: "go build ./..."},
		},
		RunScripts: map[string]ScriptDef{
			"test": {Name: "Test", Command: "go test ./..."},
		},
		AutoSetup: false,
	}

	if err := WriteConfig(dir, cfg); err != nil {
		t.Fatalf("WriteConfig() error = %v", err)
	}

	// Verify file was created
	path := ConfigPath(dir)
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("ReadFile() error = %v", err)
	}

	// Verify trailing newline
	if data[len(data)-1] != '\n' {
		t.Error("WriteConfig() missing trailing newline")
	}

	// Verify can round-trip
	loaded, err := LoadConfig(dir)
	if err != nil {
		t.Fatalf("LoadConfig() after write error = %v", err)
	}
	if loaded.SetupScripts[0].Command != "go build ./..." {
		t.Errorf("round-trip: SetupScripts[0].Command = %q", loaded.SetupScripts[0].Command)
	}
}

func TestWriteConfig_CreatesDirectory(t *testing.T) {
	dir := t.TempDir()
	cfg := &ChatMLConfig{AutoSetup: true}

	if err := WriteConfig(dir, cfg); err != nil {
		t.Fatalf("WriteConfig() error = %v", err)
	}

	configDir := filepath.Join(dir, ConfigDir)
	info, err := os.Stat(configDir)
	if err != nil {
		t.Fatalf(".chatml directory not created: %v", err)
	}
	if !info.IsDir() {
		t.Error(".chatml is not a directory")
	}
}

func TestWriteConfig_RejectsInvalid(t *testing.T) {
	dir := t.TempDir()
	cfg := &ChatMLConfig{
		SetupScripts: []ScriptDef{
			{Name: "", Command: "npm install"},
		},
	}

	err := WriteConfig(dir, cfg)
	if err == nil {
		t.Error("WriteConfig() expected error for invalid config")
	}
}

func TestWriteConfig_NilConfig(t *testing.T) {
	dir := t.TempDir()
	err := WriteConfig(dir, nil)
	if err == nil {
		t.Error("WriteConfig(nil) expected error")
	}
}

func TestValidateConfig_Valid(t *testing.T) {
	tests := []struct {
		name   string
		config ChatMLConfig
	}{
		{
			name:   "empty config",
			config: ChatMLConfig{},
		},
		{
			name: "full config",
			config: ChatMLConfig{
				SetupScripts: []ScriptDef{
					{Name: "Install", Command: "npm install"},
					{Name: "Build", Command: "npm run build"},
				},
				RunScripts: map[string]ScriptDef{
					"test": {Name: "Tests", Command: "npm test"},
					"lint": {Name: "Lint", Command: "npm run lint"},
				},
				Hooks: map[string]string{
					"pre-session":  "./scripts/pre.sh",
					"post-session": "./scripts/post.sh",
					"post-merge":   "./scripts/merge.sh",
				},
				AutoSetup: true,
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if err := ValidateConfig(&tt.config); err != nil {
				t.Errorf("ValidateConfig() error = %v", err)
			}
		})
	}
}

func TestValidateConfig_Invalid(t *testing.T) {
	tests := []struct {
		name    string
		config  ChatMLConfig
		wantErr string
	}{
		{
			name: "empty setup command",
			config: ChatMLConfig{
				SetupScripts: []ScriptDef{{Name: "Install", Command: ""}},
			},
			wantErr: "setupScripts[0]: command is empty",
		},
		{
			name: "empty setup name",
			config: ChatMLConfig{
				SetupScripts: []ScriptDef{{Name: "", Command: "npm install"}},
			},
			wantErr: "setupScripts[0]: name is empty",
		},
		{
			name: "whitespace-only setup command",
			config: ChatMLConfig{
				SetupScripts: []ScriptDef{{Name: "Install", Command: "   "}},
			},
			wantErr: "setupScripts[0]: command is empty",
		},
		{
			name: "empty run script command",
			config: ChatMLConfig{
				RunScripts: map[string]ScriptDef{
					"test": {Name: "Test", Command: ""},
				},
			},
			wantErr: "command is empty",
		},
		{
			name: "empty run script name",
			config: ChatMLConfig{
				RunScripts: map[string]ScriptDef{
					"test": {Name: "", Command: "npm test"},
				},
			},
			wantErr: "name is empty",
		},
		{
			name: "empty hook command",
			config: ChatMLConfig{
				Hooks: map[string]string{"pre-session": ""},
			},
			wantErr: "command is empty",
		},
		{
			name: "unknown hook name",
			config: ChatMLConfig{
				Hooks: map[string]string{"on-start": "./start.sh"},
			},
			wantErr: "unknown hook name",
		},
		{
			name: "multiple errors",
			config: ChatMLConfig{
				SetupScripts: []ScriptDef{{Name: "", Command: ""}},
				Hooks:        map[string]string{"bad-hook": ""},
			},
			wantErr: "setupScripts[0]: command is empty",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := ValidateConfig(&tt.config)
			if err == nil {
				t.Error("ValidateConfig() expected error")
				return
			}
			if tt.wantErr != "" {
				if got := err.Error(); !contains(got, tt.wantErr) {
					t.Errorf("error = %q, want to contain %q", got, tt.wantErr)
				}
			}
		})
	}
}

func TestValidateConfig_Nil(t *testing.T) {
	err := ValidateConfig(nil)
	if err == nil {
		t.Error("ValidateConfig(nil) expected error")
	}
}

func contains(s, substr string) bool {
	return len(s) >= len(substr) && (s == substr || len(s) > 0 && containsSubstring(s, substr))
}

func containsSubstring(s, substr string) bool {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}
