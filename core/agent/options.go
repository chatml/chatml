package agent

// ProcessOptions contains options for creating a new agent backend.
type ProcessOptions struct {
	ID                  string
	Workdir             string
	ConversationID      string
	SdkSessionID        string            // Full UUID for SDK session tracking (must be valid UUID)
	WorkspaceID         string            // Backend workspace/repo ID for MCP tools
	BackendSessionID    string            // Backend session ID for MCP tools (distinct from SDK session ID)
	ResumeSession       string            // Session ID to resume
	ForkSession         bool              // Whether to fork the session
	LinearIssue         string            // Linear issue identifier (e.g., "LIN-123")
	ToolPreset          string            // Tool preset: full, read-only, no-bash, safe-edit
	EnableCheckpointing bool              // Enable file checkpointing for rewind
	MaxBudgetUsd        float64
	MaxTurns            int
	MaxThinkingTokens   int
	Effort              string            // Reasoning effort: low, medium, high, max
	PlanMode            bool              // Start agent in plan mode
	PermissionMode      string            // Permission mode: default, acceptEdits, bypassPermissions, dontAsk (empty = bypassPermissions)
	FastMode            bool              // Enable fast output mode (Opus 4.6+)
	Instructions        string            // Additional instructions for the agent (e.g., conversation summaries)
	StructuredOutput    string
	SettingSources      string            // Comma-separated: project,user,local
	Betas               string            // Comma-separated beta features
	Model               string            // Model name override
	FallbackModel       string            // Fallback model name
	TargetBranch        string            // Target branch for PR base and sync (e.g. "origin/develop")
	SkipDotMcp          bool              // Skip loading .mcp.json from workspace root (untrusted repo)
	EnvVars             map[string]string // Custom environment variables to inject
	McpServersJSON      string            // JSON array of MCP server configs
	AgentsJSON          string            // JSON object of programmatic agent definitions (SDK 0.2.62+)
	PermissionRulesFile string            // Path to JSON file with persistent permission rules
}
