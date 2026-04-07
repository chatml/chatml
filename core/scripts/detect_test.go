package scripts

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestDetectConfig_EmptyDir(t *testing.T) {
	dir := t.TempDir()
	config := DetectConfig(dir)
	if config != nil {
		t.Errorf("DetectConfig() = %v, want nil for empty directory", config)
	}
}

func TestDetectConfig_NodeJS_NPM(t *testing.T) {
	dir := t.TempDir()

	pkg := packageJSON{
		Scripts: map[string]string{
			"dev":  "next dev",
			"test": "jest",
			"lint": "eslint .",
		},
	}
	writePkgJSON(t, dir, pkg)
	writeFile(t, dir, "package-lock.json", "{}")

	config := DetectConfig(dir)
	if config == nil {
		t.Fatal("DetectConfig() returned nil")
	}

	// Should use npm ci with lockfile present
	assertSetupScript(t, config, 0, "npm ci")

	// Should discover run scripts
	assertRunScript(t, config, "dev", "npm run dev")
	assertRunScript(t, config, "test", "npm test") // npm shorthand
	assertRunScript(t, config, "lint", "npm run lint")

	if !config.AutoSetup {
		t.Error("AutoSetup should be true")
	}
}

func TestDetectConfig_NodeJS_NoLockfile(t *testing.T) {
	dir := t.TempDir()

	pkg := packageJSON{Scripts: map[string]string{"test": "jest"}}
	writePkgJSON(t, dir, pkg)

	config := DetectConfig(dir)
	if config == nil {
		t.Fatal("DetectConfig() returned nil")
	}
	assertSetupScript(t, config, 0, "npm install")
}

func TestDetectConfig_NodeJS_Yarn(t *testing.T) {
	dir := t.TempDir()

	pkg := packageJSON{Scripts: map[string]string{"dev": "vite"}}
	writePkgJSON(t, dir, pkg)
	writeFile(t, dir, "yarn.lock", "")

	config := DetectConfig(dir)
	if config == nil {
		t.Fatal("DetectConfig() returned nil")
	}
	assertSetupScript(t, config, 0, "yarn install")
	assertRunScript(t, config, "dev", "yarn run dev")
}

func TestDetectConfig_NodeJS_PNPM(t *testing.T) {
	dir := t.TempDir()

	pkg := packageJSON{Scripts: map[string]string{"build": "tsc"}}
	writePkgJSON(t, dir, pkg)
	writeFile(t, dir, "pnpm-lock.yaml", "")

	config := DetectConfig(dir)
	if config == nil {
		t.Fatal("DetectConfig() returned nil")
	}
	assertSetupScript(t, config, 0, "pnpm install")
	assertRunScript(t, config, "build", "pnpm run build")
}

func TestDetectConfig_NodeJS_Bun(t *testing.T) {
	dir := t.TempDir()

	pkg := packageJSON{Scripts: map[string]string{"test": "bun test"}}
	writePkgJSON(t, dir, pkg)
	writeFile(t, dir, "bun.lockb", "")

	config := DetectConfig(dir)
	if config == nil {
		t.Fatal("DetectConfig() returned nil")
	}
	assertSetupScript(t, config, 0, "bun install")
	assertRunScript(t, config, "test", "bun run test")
}

func TestDetectConfig_Go(t *testing.T) {
	dir := t.TempDir()
	writeFile(t, dir, "go.mod", "module example.com/foo\n\ngo 1.22\n")

	config := DetectConfig(dir)
	if config == nil {
		t.Fatal("DetectConfig() returned nil")
	}
	assertSetupScript(t, config, 0, "go mod download")
	assertRunScript(t, config, "test", "go test ./...")
	assertRunScript(t, config, "build", "go build ./...")
}

func TestDetectConfig_Rust(t *testing.T) {
	dir := t.TempDir()
	writeFile(t, dir, "Cargo.toml", "[package]\nname = \"foo\"\n")

	config := DetectConfig(dir)
	if config == nil {
		t.Fatal("DetectConfig() returned nil")
	}
	assertSetupScript(t, config, 0, "cargo build")
	assertRunScript(t, config, "test", "cargo test")
}

func TestDetectConfig_Python_Requirements(t *testing.T) {
	dir := t.TempDir()
	writeFile(t, dir, "requirements.txt", "flask\nrequests\n")

	config := DetectConfig(dir)
	if config == nil {
		t.Fatal("DetectConfig() returned nil")
	}
	assertSetupScript(t, config, 0, "pip install -r requirements.txt")
}

func TestDetectConfig_Python_Poetry(t *testing.T) {
	dir := t.TempDir()
	writeFile(t, dir, "pyproject.toml", "[tool.poetry]\nname = \"foo\"\n")
	writeFile(t, dir, "poetry.lock", "")

	config := DetectConfig(dir)
	if config == nil {
		t.Fatal("DetectConfig() returned nil")
	}
	assertSetupScript(t, config, 0, "poetry install")
}

func TestDetectConfig_Python_UV(t *testing.T) {
	dir := t.TempDir()
	writeFile(t, dir, "pyproject.toml", "[tool.uv]\nname = \"foo\"\n")
	writeFile(t, dir, "uv.lock", "")

	config := DetectConfig(dir)
	if config == nil {
		t.Fatal("DetectConfig() returned nil")
	}
	assertSetupScript(t, config, 0, "uv sync")
}

func TestDetectConfig_Python_Pyproject(t *testing.T) {
	dir := t.TempDir()
	writeFile(t, dir, "pyproject.toml", "[build-system]\n")

	config := DetectConfig(dir)
	if config == nil {
		t.Fatal("DetectConfig() returned nil")
	}
	assertSetupScript(t, config, 0, "pip install -e .")
}

func TestDetectConfig_Ruby(t *testing.T) {
	dir := t.TempDir()
	writeFile(t, dir, "Gemfile", "source 'https://rubygems.org'\n")

	config := DetectConfig(dir)
	if config == nil {
		t.Fatal("DetectConfig() returned nil")
	}
	assertSetupScript(t, config, 0, "bundle install")
}

func TestDetectConfig_Makefile(t *testing.T) {
	dir := t.TempDir()
	writeFile(t, dir, "Makefile", "dev:\n\tgo run .\n\ntest:\n\tgo test ./...\n\nlint:\n\tgolangci-lint run\n\nbuild:\n\tgo build -o app\n")

	config := DetectConfig(dir)
	if config == nil {
		t.Fatal("DetectConfig() returned nil")
	}
	assertRunScript(t, config, "dev", "make dev")
	assertRunScript(t, config, "test", "make test")
	assertRunScript(t, config, "lint", "make lint")
	assertRunScript(t, config, "build", "make build")
}

func TestDetectConfig_Makefile_SpecificDetectorTakesPriority(t *testing.T) {
	dir := t.TempDir()
	// Go project with Makefile — go detector should set test/build first,
	// then Makefile should not overwrite them
	writeFile(t, dir, "go.mod", "module example.com/foo\n\ngo 1.22\n")
	writeFile(t, dir, "Makefile", "test:\n\tmake go-test\n\nbuild:\n\tmake go-build\n")

	config := DetectConfig(dir)
	if config == nil {
		t.Fatal("DetectConfig() returned nil")
	}
	// Go detector runs first, so test/build should be Go commands
	assertRunScript(t, config, "test", "go test ./...")
	assertRunScript(t, config, "build", "go build ./...")
}

func TestDetectConfig_EnvExample(t *testing.T) {
	dir := t.TempDir()
	// Need at least one other detected thing for config to be non-nil
	writeFile(t, dir, "go.mod", "module example.com/foo\n\ngo 1.22\n")
	writeFile(t, dir, ".env.example", "DATABASE_URL=postgres://localhost/db\n")

	config := DetectConfig(dir)
	if config == nil {
		t.Fatal("DetectConfig() returned nil")
	}

	// Should have env copy as last setup script
	found := false
	for _, s := range config.SetupScripts {
		if s.Command == "cp .env.example .env" {
			found = true
			break
		}
	}
	if !found {
		t.Error("expected 'cp .env.example .env' in setup scripts")
	}
}

func TestDetectConfig_EnvExample_AlreadyExists(t *testing.T) {
	dir := t.TempDir()
	writeFile(t, dir, "go.mod", "module example.com/foo\n\ngo 1.22\n")
	writeFile(t, dir, ".env.example", "KEY=val\n")
	writeFile(t, dir, ".env", "KEY=val\n")

	config := DetectConfig(dir)
	if config == nil {
		t.Fatal("DetectConfig() returned nil")
	}

	for _, s := range config.SetupScripts {
		if s.Command == "cp .env.example .env" {
			t.Error("should not add env copy when .env already exists")
		}
	}
}

func TestDetectConfig_MultipleDetectors(t *testing.T) {
	dir := t.TempDir()
	// Node.js + Go + Makefile
	pkg := packageJSON{Scripts: map[string]string{"dev": "next dev"}}
	writePkgJSON(t, dir, pkg)
	writeFile(t, dir, "package-lock.json", "{}")
	writeFile(t, dir, "go.mod", "module example.com/foo\n\ngo 1.22\n")
	writeFile(t, dir, "Makefile", "lint:\n\tgolangci-lint run\n")

	config := DetectConfig(dir)
	if config == nil {
		t.Fatal("DetectConfig() returned nil")
	}

	// Should have setup scripts from both Node and Go
	if len(config.SetupScripts) < 2 {
		t.Errorf("expected at least 2 setup scripts, got %d", len(config.SetupScripts))
	}

	// Should have run scripts from all three
	if _, ok := config.RunScripts["dev"]; !ok {
		t.Error("missing 'dev' run script from Node.js")
	}
	if _, ok := config.RunScripts["test"]; !ok {
		t.Error("missing 'test' run script from Go")
	}
	if _, ok := config.RunScripts["lint"]; !ok {
		t.Error("missing 'lint' run script from Makefile")
	}
}

// --- helpers ---

func writeFile(t *testing.T, dir, name, content string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(dir, name), []byte(content), 0644); err != nil {
		t.Fatal(err)
	}
}

func writePkgJSON(t *testing.T, dir string, pkg packageJSON) {
	t.Helper()
	data, err := json.Marshal(pkg)
	if err != nil {
		t.Fatal(err)
	}
	writeFile(t, dir, "package.json", string(data))
}

func assertSetupScript(t *testing.T, config *ChatMLConfig, index int, wantCmd string) {
	t.Helper()
	if index >= len(config.SetupScripts) {
		t.Fatalf("setup script index %d out of range (len=%d)", index, len(config.SetupScripts))
	}
	if got := config.SetupScripts[index].Command; got != wantCmd {
		t.Errorf("SetupScripts[%d].Command = %q, want %q", index, got, wantCmd)
	}
}

func assertRunScript(t *testing.T, config *ChatMLConfig, key, wantCmd string) {
	t.Helper()
	script, ok := config.RunScripts[key]
	if !ok {
		t.Errorf("RunScripts[%q] not found, available: %v", key, runScriptKeys(config))
		return
	}
	if script.Command != wantCmd {
		t.Errorf("RunScripts[%q].Command = %q, want %q", key, script.Command, wantCmd)
	}
}

func runScriptKeys(config *ChatMLConfig) []string {
	keys := make([]string, 0, len(config.RunScripts))
	for k := range config.RunScripts {
		keys = append(keys, k)
	}
	return keys
}
