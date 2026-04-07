# Core Engine Roadmap — Remaining Items

> Status as of April 4, 2026. Phases 1-4 complete (~65% Claude Code parity).
> 27 built-in tools, 30+ hook events, MCP client, skill system, task management,
> session persistence, bash AST security, sandbox, enterprise settings, doctor diagnostics.

---

## Phase 5: Power Features

### P2.3: Plugin System (XL)

**Gap:** No plugin system. Claude Code has a 43-file plugin system with marketplace, auto-update, policy enforcement, plugin-defined hooks/commands/agents/MCP integration.

**Implementation plan:**
- New package `core/plugin/`
- `PluginManifest` — JSON schema for plugin definition (name, version, description, hooks, commands, agents, mcp)
- `PluginLoader` — load plugins from `~/.claude/plugins/` and `.claude/plugins/`
- `PluginRegistry` — track installed plugins, versions, enabled state
- `PluginValidator` — validate manifest schema, check permissions
- `PluginPolicy` — enterprise policy enforcement (enabledPlugins from managed settings)
- Plugin hooks: register plugin-defined hooks into the hook engine
- Plugin commands: register plugin-defined skills into the skill catalog
- Plugin agents: register plugin-defined agent types
- Plugin MCP: register plugin-defined MCP server configs
- Auto-update: check plugin versions on session start, update if newer available
- Marketplace: simple HTTP registry for discovering plugins (future)

**Dependencies:** hooks (P0.1 ✓), MCP (P0.2 ✓), skills (P1.3 ✓)

**Files to create:**
```
core/plugin/
  manifest.go      — PluginManifest schema and parsing
  loader.go        — Load plugins from directories
  registry.go      — Track installed plugins
  validator.go     — Validate manifests
  policy.go        — Enterprise policy enforcement
  hooks.go         — Register plugin hooks
  commands.go      — Register plugin skills/commands
  autoupdate.go    — Version checking and updates
```

---

### P2.5: Teams/Swarms (L)

**Gap:** No TeamCreateTool, TeamDeleteTool, SendMessageTool for agent swarm coordination.

**Implementation plan:**
- New package `core/team/`
- `Team` struct — name, members (agent IDs), shared mailbox
- `TeamManager` — create/delete teams, track membership
- `Mailbox` — channel-based message passing between agents
- `SendMessageTool` — send a message to a named agent or team
- `TeamCreateTool` — create a team with initial member list
- `TeamDeleteTool` — dissolve a team
- Coordinator mode: one agent orchestrates others via team communication

**Dependencies:** agent fork mode (P1.6 ✓)

**Files to create:**
```
core/team/
  manager.go       — Team lifecycle management
  mailbox.go       — Inter-agent message passing
core/tool/builtin/
  team.go          — TeamCreate, TeamDelete, SendMessage tools
```

---

### P2.6: LSP Integration Tool (L)

**Gap:** No Language Server Protocol client for code intelligence (diagnostics, hover, go-to-definition, completions).

**Implementation plan:**
- New package `core/lsp/`
- `LSPClient` — JSON-RPC 2.0 client over stdio (reuse patterns from MCP client)
- `LSPManager` — manage multiple language server connections
- Auto-detect: launch appropriate LSP server based on file extension (gopls, typescript-language-server, pyright, etc.)
- `LSPTool` — exposes diagnostics, hover info, references, definitions to the LLM
- Feature-gated: only enabled when `ENABLE_LSP_TOOL` is set

**Dependencies:** none

**Go notes:** Use `go.lsp.dev/protocol` package for LSP types. JSON-RPC transport is similar to MCP stdio.

**Files to create:**
```
core/lsp/
  client.go        — LSP client (JSON-RPC over stdio)
  manager.go       — Multi-server management
  detect.go        — Auto-detect LSP server for file type
core/tool/builtin/
  lsp.go           — LSPTool implementation
```

---

### P2.8: Remote Trigger Tool (M)

**Gap:** No remote agent triggering capability.

**Implementation plan:**
- `RemoteTriggerTool` — trigger a remote agent execution via API
- Requires cloud relay infrastructure (see mobile app / cloud relay architecture)
- Depends on P2.7 (scheduling, ✓) for cron-triggered remote agents

**Files to create:**
```
core/tool/builtin/
  remote_trigger.go
```

---

## Phase 6: Nice-to-Have (P3 Items)

### P3.1: PowerShellTool (S)
Windows PowerShell command execution. Low priority — macOS-focused.
```
core/tool/builtin/powershell.go
```

### P3.2: OpenTelemetry Tracing (M)
Observability tracing for API calls, tool executions, hook runs.
```
core/telemetry/
  tracing.go       — OpenTelemetry setup (go.opentelemetry.io/otel)
  spans.go         — Span creation for key operations
```

### P3.3: Feature Flag System (S)
Simple config-based feature flags (not Growthbook — that's Anthropic-specific).
```
core/flags/
  flags.go         — Load from config, check flag state
```

### P3.4: Terminal Notifications (S)
iTerm2, Kitty, Ghostty, and bell notifications for long-running operations.
```
core/cmd/nativeloop/notify.go  — ANSI escape sequences for terminal notifications
```

### P3.5: Pasted Text Reference Management (S)
Hash-based references for large pasted text (>1KB) to avoid bloating context.
```
core/context/paste_refs.go
```

### P3.6: ConfigTool / BriefTool (S each)
LLM-accessible tools for reading/modifying configuration and switching to brief mode.
```
core/tool/builtin/config_tool.go
core/tool/builtin/brief.go
```

### P3.7: MCP OAuth PKCE Authentication (M)
OAuth PKCE flow for authenticating with remote MCP servers.
```
core/mcp/auth/
  oauth.go         — PKCE flow implementation
  token.go         — Token storage and refresh
```

### P3.8: 4-Tier CLAUDE.md with Managed Layer (S)
Add the enterprise managed tier to CLAUDE.md loading (reads from `/Library/Application Support/ClaudeCode/CLAUDE.md`).
Extend `core/prompt/builder.go` to load from `paths.ManagedSettingsDir()`.

### P3.9: Voice Mode (L)
Speech-to-text and text-to-speech for voice interaction. Experimental.

### P3.10: Browser Automation (L)
Chrome DevTools Protocol integration for browser control. Experimental.

---

## Excluded (Anthropic-Specific)

These features are specific to Anthropic's infrastructure and not applicable:

| Feature | Reason |
|---------|--------|
| Growthbook feature flags | Anthropic A/B testing |
| Bun build-time dead code elimination | TypeScript build system |
| Claude.ai OAuth provider | Anthropic auth service |
| Transcript classifier (auto mode ML) | Anthropic ML infra |
| Native client attestation | Anthropic security |
| CCD spawn env protection | Claude Code Desktop specific |
| Commit attribution tracking | Anthropic metrics |
| Buddy/companion sprite | Anthropic UX experiment |

---

## Architecture Notes for Future Implementation

### Go Advantages to Leverage
- **Goroutines for teams/swarms** — each agent in a swarm is a goroutine, communication via channels
- **`go.lsp.dev/protocol`** — official Go LSP types, no need to redefine
- **`go.opentelemetry.io/otel`** — production-grade tracing SDK
- **Plugin isolation** — each plugin runs in its own goroutine with `context.Context` for cancellation
- **Single binary** — all features compiled in, no runtime dependencies (except MCP server processes)

### Key Integration Points
- `core/loop/factory.go` — where new tools and systems are wired into the runner
- `core/tool/builtin/register.go` — tool registration (add new tools here)
- `core/hook/engine.go` — hook event dispatch (add new event types here)
- `core/permission/engine.go` — permission checks (add new modes or rules here)
- `core/cmd/nativeloop/input.go` — CLI commands (add new slash commands here)
