package scripts

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
)

// DetectConfig scans a workspace directory for common project patterns
// and returns a suggested ChatMLConfig. Returns nil if nothing is detected.
func DetectConfig(workspacePath string) *ChatMLConfig {
	config := &ChatMLConfig{
		RunScripts: make(map[string]ScriptDef),
	}

	// Detect Node.js projects
	detectNodeJS(workspacePath, config)

	// Detect Go projects
	detectGo(workspacePath, config)

	// Detect Rust projects
	detectRust(workspacePath, config)

	// Detect Python projects
	detectPython(workspacePath, config)

	// Detect Ruby projects
	detectRuby(workspacePath, config)

	// Detect Makefile
	detectMakefile(workspacePath, config)

	// Detect .env.example
	detectEnvExample(workspacePath, config)

	// Return nil if nothing was detected
	if len(config.SetupScripts) == 0 && len(config.RunScripts) == 0 {
		return nil
	}

	config.AutoSetup = true
	return config
}

func fileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

// packageJSON is a minimal representation of package.json
type packageJSON struct {
	Scripts map[string]string `json:"scripts"`
}

func detectNodeJS(workspacePath string, config *ChatMLConfig) {
	pkgPath := filepath.Join(workspacePath, "package.json")
	if !fileExists(pkgPath) {
		return
	}

	// Determine install command based on lock file
	installCmd := "npm install"
	if fileExists(filepath.Join(workspacePath, "package-lock.json")) {
		installCmd = "npm ci"
	} else if fileExists(filepath.Join(workspacePath, "yarn.lock")) {
		installCmd = "yarn install"
	} else if fileExists(filepath.Join(workspacePath, "pnpm-lock.yaml")) {
		installCmd = "pnpm install"
	} else if fileExists(filepath.Join(workspacePath, "bun.lockb")) || fileExists(filepath.Join(workspacePath, "bun.lock")) {
		installCmd = "bun install"
	}

	config.SetupScripts = append(config.SetupScripts, ScriptDef{
		Name:    "Install dependencies",
		Command: installCmd,
	})

	// Parse package.json for available scripts
	data, err := os.ReadFile(pkgPath)
	if err != nil {
		return
	}

	var pkg packageJSON
	if err := json.Unmarshal(data, &pkg); err != nil {
		return
	}

	// Determine the run prefix from the install command
	runPrefix := strings.Split(installCmd, " ")[0] // npm, yarn, pnpm, bun
	runCmd := runPrefix + " run"
	if runPrefix == "npm" {
		runCmd = "npm run"
	}

	// Map common script names to run scripts
	scriptMappings := []struct {
		keys []string
		key  string
		name string
	}{
		{keys: []string{"dev", "start:dev", "serve"}, key: "dev", name: "Dev Server"},
		{keys: []string{"test", "test:unit"}, key: "test", name: "Run Tests"},
		{keys: []string{"lint", "lint:fix"}, key: "lint", name: "Lint"},
		{keys: []string{"build"}, key: "build", name: "Build"},
		{keys: []string{"typecheck", "type-check", "tsc"}, key: "typecheck", name: "Type Check"},
	}

	for _, mapping := range scriptMappings {
		for _, scriptKey := range mapping.keys {
			if _, ok := pkg.Scripts[scriptKey]; ok {
				// Use shorthand for npm (npm test, npm start) or run prefix for others
				cmd := runCmd + " " + scriptKey
				if runPrefix == "npm" && (scriptKey == "test" || scriptKey == "start") {
					cmd = "npm " + scriptKey
				}
				config.RunScripts[mapping.key] = ScriptDef{
					Name:    mapping.name,
					Command: cmd,
				}
				break
			}
		}
	}
}

func detectGo(workspacePath string, config *ChatMLConfig) {
	if !fileExists(filepath.Join(workspacePath, "go.mod")) {
		return
	}

	config.SetupScripts = append(config.SetupScripts, ScriptDef{
		Name:    "Download Go modules",
		Command: "go mod download",
	})

	config.RunScripts["test"] = ScriptDef{
		Name:    "Run Tests",
		Command: "go test ./...",
	}

	config.RunScripts["build"] = ScriptDef{
		Name:    "Build",
		Command: "go build ./...",
	}
}

func detectRust(workspacePath string, config *ChatMLConfig) {
	if !fileExists(filepath.Join(workspacePath, "Cargo.toml")) {
		return
	}

	config.SetupScripts = append(config.SetupScripts, ScriptDef{
		Name:    "Build project",
		Command: "cargo build",
	})

	config.RunScripts["test"] = ScriptDef{
		Name:    "Run Tests",
		Command: "cargo test",
	}
}

func detectPython(workspacePath string, config *ChatMLConfig) {
	if fileExists(filepath.Join(workspacePath, "pyproject.toml")) {
		// Check for poetry
		if fileExists(filepath.Join(workspacePath, "poetry.lock")) {
			config.SetupScripts = append(config.SetupScripts, ScriptDef{
				Name:    "Install dependencies",
				Command: "poetry install",
			})
		} else if fileExists(filepath.Join(workspacePath, "uv.lock")) {
			config.SetupScripts = append(config.SetupScripts, ScriptDef{
				Name:    "Install dependencies",
				Command: "uv sync",
			})
		} else {
			config.SetupScripts = append(config.SetupScripts, ScriptDef{
				Name:    "Install package",
				Command: "pip install -e .",
			})
		}
		return
	}

	if fileExists(filepath.Join(workspacePath, "requirements.txt")) {
		config.SetupScripts = append(config.SetupScripts, ScriptDef{
			Name:    "Install dependencies",
			Command: "pip install -r requirements.txt",
		})
	}
}

func detectRuby(workspacePath string, config *ChatMLConfig) {
	if !fileExists(filepath.Join(workspacePath, "Gemfile")) {
		return
	}

	config.SetupScripts = append(config.SetupScripts, ScriptDef{
		Name:    "Install dependencies",
		Command: "bundle install",
	})
}

func detectMakefile(workspacePath string, config *ChatMLConfig) {
	if !fileExists(filepath.Join(workspacePath, "Makefile")) {
		return
	}

	// Read makefile to discover targets
	data, err := os.ReadFile(filepath.Join(workspacePath, "Makefile"))
	if err != nil {
		return
	}

	content := string(data)
	lines := strings.Split(content, "\n")

	// Look for common targets defined as "target:" at start of line
	targetMappings := map[string]struct {
		key  string
		name string
	}{
		"dev":   {key: "dev", name: "Dev Server"},
		"test":  {key: "test", name: "Run Tests"},
		"lint":  {key: "lint", name: "Lint"},
		"build": {key: "build", name: "Build"},
	}

	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		// Match "target:" or "target: deps"
		for target, mapping := range targetMappings {
			if strings.HasPrefix(trimmed, target+":") {
				// Only add if not already set by a more specific detector
				if _, exists := config.RunScripts[mapping.key]; !exists {
					config.RunScripts[mapping.key] = ScriptDef{
						Name:    mapping.name,
						Command: "make " + target,
					}
				}
			}
		}
	}
}

func detectEnvExample(workspacePath string, config *ChatMLConfig) {
	envExample := filepath.Join(workspacePath, ".env.example")
	envFile := filepath.Join(workspacePath, ".env")

	if fileExists(envExample) && !fileExists(envFile) {
		config.SetupScripts = append(config.SetupScripts, ScriptDef{
			Name:    "Copy environment file",
			Command: "cp .env.example .env",
		})
	}
}
