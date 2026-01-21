# Agent Orchestration System - Phase 1 Design

## Overview

Add a multi-agent orchestration system to ChatML that enables specialized AI agents to monitor external services (GitHub, Linear), automatically create sessions, and assist with development workflows.

## Key Decisions

| Decision | Choice |
|----------|--------|
| Agent definitions | Hybrid: YAML files + database for runtime state |
| Triggers | Smart polling (no webhooks in Phase 1) |
| External services | GitHub + Linear |
| Agent autonomy | Read + create sessions (no external mutations) |
| UI location | Sidebar tab alongside Workspaces |
| Configuration | YAML for definition, UI for runtime settings |
| Agent scope | Hybrid: global agents + workspace overrides |
| Runner location | Context-dependent (read-only vs creates-session) |
| Conversations | Separate agent log view, not conversations |
| Result streaming | Extend existing WebSocket hub |
| Agent interaction | None in Phase 1 |

## Data Model

### Agent Definition (YAML)

```yaml
# agents/github-monitor.yaml
id: github-monitor
name: GitHub Monitor
type: monitor
description: Monitors GitHub issues and creates sessions for new work

execution:
  mode: read-only | creates-session | uses-session
  workingDirectory: root | session

polling:
  interval: 60s
  sources:
    - type: github
      owner: "{{workspace.github_owner}}"
      repo: "{{workspace.github_repo}}"
      resources: [issues, pull_requests]
      filters:
        labels: [bug, feature]
        state: open

capabilities:
  - read:github
  - create:session

systemPrompt: |
  You monitor GitHub for new issues and PRs.
  When you find actionable items, create a session to work on them.

limits:
  budgetPerRun: 0.50
  maxSessionsPerHour: 5
```

### Agent Runtime State (SQLite)

```sql
CREATE TABLE agents (
  id TEXT PRIMARY KEY,
  yaml_path TEXT NOT NULL,
  enabled BOOLEAN DEFAULT true,
  polling_interval_ms INTEGER,
  last_run_at TIMESTAMP,
  last_error TEXT,
  total_runs INTEGER DEFAULT 0,
  total_cost REAL DEFAULT 0,
  created_at TIMESTAMP,
  updated_at TIMESTAMP
);

CREATE TABLE agent_runs (
  id TEXT PRIMARY KEY,
  agent_id TEXT REFERENCES agents(id),
  trigger TEXT,  -- 'poll', 'manual', 'event'
  status TEXT,   -- 'running', 'completed', 'failed'
  result_summary TEXT,
  sessions_created TEXT,  -- JSON array of session IDs
  cost REAL,
  started_at TIMESTAMP,
  completed_at TIMESTAMP
);
```

## Architecture

### Backend Structure

```
backend/
├── orchestrator/
│   ├── orchestrator.go   # Main coordinator
│   ├── scheduler.go      # Polling scheduler
│   ├── events.go         # Event types and bus
│   └── runner.go         # Spawns agent runs
├── agents/
│   ├── loader.go         # Loads YAML definitions
│   ├── github.go         # GitHub polling adapter
│   ├── linear.go         # Linear polling adapter
│   └── cache.go          # ETag cache for polling
└── store/
    └── agents.go         # Agent state persistence
```

### Core Flow

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  Scheduler  │────▶│ Orchestrator│────▶│   Runner    │
│  (tickers)  │     │  (decides)  │     │(spawns SDK) │
└─────────────┘     └─────────────┘     └─────────────┘
       │                   │                   │
       │                   ▼                   ▼
       │            ┌─────────────┐     ┌─────────────┐
       │            │   Store     │     │ Agent Runner│
       │            │  (state)    │     │  (Node.js)  │
       │            └─────────────┘     └─────────────┘
       │
       ▼
┌─────────────────────────────────────┐
│           Polling Adapters          │
│  ┌──────────┐      ┌──────────┐    │
│  │  GitHub  │      │  Linear  │    │
│  └──────────┘      └──────────┘    │
└─────────────────────────────────────┘
```

## API Endpoints

```go
r.Route("/api/agents", func(r chi.Router) {
    r.Get("/", h.ListAgents)              // All agent definitions + state
    r.Post("/reload", h.ReloadAgents)     // Reload YAML files

    r.Route("/{agentId}", func(r chi.Router) {
        r.Get("/", h.GetAgent)            // Single agent with state
        r.Patch("/", h.UpdateAgentState)  // Enable/disable, interval
        r.Post("/run", h.TriggerAgentRun) // Manual trigger
        r.Get("/runs", h.ListAgentRuns)   // Run history
        r.Get("/runs/{runId}", h.GetAgentRun)
        r.Get("/runs/{runId}/logs", h.GetAgentRunLogs)
    })
})
```

## WebSocket Events

```go
// New event types:
// "agent.state.changed"   - Agent enabled/disabled/error
// "agent.run.started"     - Run began
// "agent.run.progress"    - Intermediate update
// "agent.run.completed"   - Run finished
// "agent.session.created" - Agent created a session
```

## Frontend Components

```
src/components/
├── AgentSidebar.tsx        # Main sidebar tab content
├── AgentCard.tsx           # Individual agent status card
├── AgentRunLog.tsx         # Expandable run history
├── AgentConfigPanel.tsx    # Runtime settings (enable, interval)
└── AgentActivityFeed.tsx   # Recent activity stream
```

### Sidebar Layout

```
┌─────────────────────────────┐
│ [Workspaces] [Agents]       │
├─────────────────────────────┤
│ AGENTS                   ⚙️  │
├─────────────────────────────┤
│ ┌─────────────────────────┐ │
│ │ 🟢 GitHub Monitor   [≡] │ │
│ │ Polling • 2m ago        │ │
│ │ ├─ 14:32 Created session│ │
│ │ └─ 14:30 Checked 3 repos│ │
│ └─────────────────────────┘ │
│ ┌─────────────────────────┐ │
│ │ 🟡 Linear Sync      [≡] │ │
│ │ Idle • Rate limited     │ │
│ └─────────────────────────┘ │
├─────────────────────────────┤
│ TODAY                       │
│ 12 runs • $1.24 • 3 sessions│
├─────────────────────────────┤
│ [+ Add Agent]               │
└─────────────────────────────┘
```

## Polling Strategy

### Smart Polling Intervals

- Active repos (recent commits): 1 min
- Idle repos (no activity 24h): 5 min
- Dormant repos (no activity 7d): 15 min

### Rate Limit Handling

- Use ETags for conditional requests (304 = no changes)
- Cache responses with TTL
- Exponential backoff on rate limit errors

## Implementation Steps

### Step 1: Data Layer
- Add agents table to SQLite
- Add agent_runs table
- Create store/agents.go with CRUD operations
- Create agents/loader.go to parse YAML files

### Step 2: Orchestration Core
- Create orchestrator/orchestrator.go
- Create orchestrator/scheduler.go (ticker management)
- Create orchestrator/runner.go (spawns agent-runner)
- Wire into main.go startup

### Step 3: Polling Adapters
- Create agents/github.go
- Create agents/linear.go
- Create agents/cache.go
- Add API credentials config

### Step 4: API Routes
- Add agent routes to router.go
- Create server/agent_handlers.go
- Add WebSocket event types to hub.go
- Test with curl/Postman

### Step 5: Frontend - Store & Types
- Create src/lib/agentTypes.ts
- Create src/stores/agentStore.ts
- Add WebSocket handlers for agent events
- Wire into useWebSocket hook

### Step 6: Frontend - UI Components
- Create AgentSidebar.tsx
- Create AgentCard.tsx
- Create AgentRunLog.tsx
- Add "Agents" tab to sidebar
- Integrate with existing layout

### Step 7: Agent Definitions
- Create agents/ directory
- Write github-monitor.yaml
- Write linear-sync.yaml
- Test end-to-end flow

## Files Summary

### New Files (17)

```
backend/
├── orchestrator/
│   ├── orchestrator.go
│   ├── scheduler.go
│   ├── runner.go
│   └── events.go
├── agents/
│   ├── loader.go
│   ├── github.go
│   ├── linear.go
│   └── cache.go
├── store/agents.go
└── server/agent_handlers.go

src/
├── lib/agentTypes.ts
├── stores/agentStore.ts
└── components/
    ├── AgentSidebar.tsx
    ├── AgentCard.tsx
    └── AgentRunLog.tsx

agents/
├── github-monitor.yaml
└── linear-sync.yaml
```

### Modified Files (4)

```
backend/main.go
backend/server/router.go
backend/server/hub.go
src/components/WorkspaceSidebar.tsx
```

## Future Phases

### Phase 2: Enhanced Triggers
- File system watchers
- Git hooks integration
- Scheduled triggers (cron)

### Phase 3: Agent Coordination
- Agent-to-agent delegation
- Shared context/memory
- Run linking and tracing

### Phase 4: Advanced Features
- Custom agent builder UI
- Agent marketplace/templates
- Workflow designer (visual)
- Analytics dashboard
