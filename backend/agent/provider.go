package agent

// AgentProvider describes the capabilities of the current agent-runner implementation.
// For the initial release, only "claude" is supported. Future providers can be added
// by implementing a different agent-runner binary that speaks the same stdin/stdout
// JSON protocol (see docs/agent-runner-protocol.md).
type AgentProvider struct {
	// Name identifies the provider (e.g., "claude", "openai").
	Name string `json:"name"`

	// SupportsThinking indicates whether the provider supports extended thinking / chain-of-thought.
	SupportsThinking bool `json:"supportsThinking"`

	// SupportsPlanMode indicates whether the provider supports structured plan-then-execute mode.
	SupportsPlanMode bool `json:"supportsPlanMode"`

	// SupportsSubAgents indicates whether the provider supports spawning sub-agent processes.
	SupportsSubAgents bool `json:"supportsSubAgents"`

	// SupportsEffort indicates whether the provider supports reasoning effort levels (low/medium/high/max).
	SupportsEffort bool `json:"supportsEffort"`
}

// DefaultProvider returns the Claude provider configuration.
func DefaultProvider() AgentProvider {
	return AgentProvider{
		Name:              "claude",
		SupportsThinking:  true,
		SupportsPlanMode:  true,
		SupportsSubAgents: true,
		SupportsEffort:    true,
	}
}
