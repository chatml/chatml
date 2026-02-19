# Product Overview

ChatML is a native macOS desktop application that transforms AI-assisted software development from a chat-and-paste workflow into an integrated development environment. It gives Claude direct access to your codebase through isolated git worktrees, enabling multiple AI-driven tasks to run in parallel without interference.

## Philosophy

Traditional AI coding assistants require developers to copy code into a chat, wait for a response, and paste it back. ChatML eliminates this friction by embedding the AI directly into the development workflow. Each task gets its own isolated environment (a git worktree with a dedicated branch), and the AI agent can read, write, and execute code within that environment. The developer oversees, guides, and reviews rather than manually shuttling text between interfaces.

## Core Concepts

### Workspaces

A workspace is a registered git repository. When you add a repository to ChatML, it becomes a workspace. ChatML stores metadata about each workspace including its path on disk, default branch, remote name, and branch prefix configuration. You can have multiple workspaces, and each one independently manages its own sessions.

### Sessions

Sessions are the heart of ChatML. Each session represents an isolated development task with its own git worktree and branch. When you create a session, ChatML:

1. Creates a new directory under `~/.chatml/workspaces/`
2. Runs `git worktree add` to create an isolated working copy
3. Creates a new branch based on the workspace's default branch
4. Spawns an AI agent process dedicated to that session

This isolation means multiple sessions can work on different parts of the codebase simultaneously. Session A can refactor the authentication system while Session B adds a new API endpoint, each on its own branch with its own working directory.

Sessions have several management features:
- **Priority** (Urgent, High, Medium, Low, None) for organizing work
- **Task Status** (Backlog, In Progress, In Review, Done, Cancelled) for tracking workflow
- **Pinning** to keep important sessions visible at the top of the list
- **Archiving** with AI-generated summaries for completed work
- **PR Status** tracking (None, Open, Merged, Closed) with live updates
- **Branch Sync** detection showing how far behind `origin/main` a session is
- **Auto-naming** where Claude suggests session names based on the conversation context

### Conversations

Each session can have multiple conversations. There are three types:

- **Task** — The primary conversation type for coding work. The AI agent has full tool access and can read, write, edit files, run commands, and search the codebase.
- **Review** — A code review conversation where the AI examines changes and provides feedback with inline comments.
- **Chat** — A general discussion without full tool access, useful for brainstorming or asking questions.

Conversations track their status (Active, Idle, Completed), maintain a history of all messages, and record a summary of tool actions performed.

### Messages

Messages flow between the user and the AI assistant, with system messages providing context. Each message can include:
- Text content with Markdown formatting
- File attachments (code files, images)
- Tool usage records showing what the AI did
- Timeline entries preserving the interleaved order of text and tool usage
- Extended thinking content showing the AI's reasoning process
- Run summaries with cost, duration, and statistics

## Features

### Real-Time Streaming

When the AI agent works, you see everything in real time:

- **Text streaming** — Response text appears as it's generated, rendered as Markdown with syntax highlighting
- **Tool execution display** — Each tool call shows its name, parameters, status (running/success/failure), and duration
- **Extended thinking** — When the model uses extended thinking, the reasoning is displayed in a collapsible section
- **Sub-agent tracking** — When the AI spawns sub-agents for parallel tasks, each is tracked independently with its own tool timeline
- **Elapsed time** — A running timer shows how long the current response has been generating

### File Browser and Editor

ChatML includes a built-in file browser and code editor:

- **Session-scoped file tabs** — Each session maintains its own set of open files, with an LRU eviction policy (max 10 tabs by default)
- **Syntax highlighting** — Monaco editor with language-aware syntax highlighting
- **File/Diff view modes** — Toggle between viewing the file content and viewing a diff against the base branch
- **Dirty detection** — Modified files show an unsaved indicator
- **Pin support** — Pin important tabs to prevent auto-closing
- **Side-by-side diff** — View changes in side-by-side or inline diff mode
- **File saving** — Edit and save files directly from the editor

### Code Review

The review workflow provides structured code analysis:

- **Review conversations** — Start a review conversation and Claude examines the session's changes
- **Inline comments** — Claude and users can leave comments on specific file lines
- **Severity levels** — Comments have severity (Error, Warning, Suggestion, Info) for prioritization
- **Resolution tracking** — Comments can be marked as resolved with attribution
- **Comment statistics** — Per-file counts of total and unresolved comments

### Pull Request Management

Create and track pull requests directly from sessions:

- **PR creation** — Push the session branch and create a GitHub PR with AI-generated descriptions
- **PR description generation** — Claude generates PR title and body based on the changes
- **PR template support** — Global and per-workspace PR templates
- **Status tracking** — Live polling (every 30 seconds) for PR status, check failures, and merge conflicts
- **Branch sync** — Detect when the session is behind `origin/main` and sync via rebase or merge

### Git Integration

Deep integration with git operations:

- **Isolated worktrees** — Each session gets its own git worktree for complete isolation
- **Branch management** — View all branches with commit info, ahead/behind counts, and session linkage
- **Branch cleanup** — Analyze and clean up stale branches
- **Git status** — View uncommitted changes per session
- **Commit history** — View branch-specific commit history
- **File history** — View the change history for individual files
- **Protected branch detection** — Prevents creating sessions on main/master/develop

### Terminal Integration

Built-in terminal support for each session:

- **PTY terminals** — Full terminal emulation via Tauri's PTY plugin
- **Per-session terminals** — Each session can have up to 5 terminal instances
- **Working directory** — Terminals open in the session's worktree path
- **Session scripts** — Configure setup scripts and run scripts per workspace

### Skills Marketplace

Skills are specialized prompt templates that augment Claude's capabilities:

**Development Skills:**
- Test-Driven Development — Red-Green-Refactor cycle guidance
- Unit Testing Guide — Patterns, doubles, and polyglot testing
- Systematic Debugging — Hypothesis-driven bug finding
- Code Review Assistant — Correctness, security, and maintainability checks
- API Design — REST/GraphQL conventions and patterns
- Refactoring Guide — Safe, phased refactoring strategies
- Performance Optimization — Profiling and bottleneck identification

**Security Skills:**
- Security Audit — OWASP Top 10 vulnerability scanning
- Dependency Review — License, maintenance, and security evaluation

**Documentation Skills:**
- Brainstorming — Structured idea exploration
- Writing Plans — Implementation plan creation
- Architecture Decision Records — Structured decision capture
- Technical Writing — Documentation authoring
- Project Scaffolding — New project setup

**Version Control Skills:**
- Git Commit Helper — Conventional commit messages
- PR Creation — Well-documented pull requests
- Branch Management — Naming, merging, and cleanup
- Code Migration — Framework and library migration
- Accessibility Audit — WCAG compliance checking

Skills can be installed per-session and are delivered as system prompt augmentations.

### Linear Integration

For teams using Linear for project management:

- **Issue discovery** — Automatically detects Linear issues from CLI arguments, branch names, or recent commits
- **OAuth authentication** — Secure OAuth flow with deep link callback
- **Issue context** — Provides issue details to the AI agent via MCP tools
- **Issue operations** — Search, create, update, and comment on Linear issues

### CI/CD Monitoring

GitHub Actions integration for build monitoring:

- **Workflow runs** — View GitHub Actions workflow runs for the session's branch
- **Job details** — Drill into individual jobs within a workflow
- **Log viewer** — Read job logs directly in ChatML
- **AI failure analysis** — Claude analyzes CI failures and suggests fixes
- **Rerun workflows** — Trigger workflow reruns from the UI
- **Check status tracking** — Session cards show check failure indicators

### Extended Thinking and Plan Mode

Advanced AI interaction modes:

- **Extended thinking** — Claude can use extended thinking (chain-of-thought reasoning) which is displayed in a collapsible section. Configurable via `maxThinkingTokens`.
- **Plan mode** — The agent enters a read-only planning mode where it researches and designs an approach, then presents it for user approval before executing. A banner indicates when plan mode is active.
- **Plan approval** — When the agent calls `ExitPlanMode`, the user sees the plan and can approve or reject it.

### File Checkpointing and Rewind

Undo support through git stash-based checkpointing:

- **Automatic checkpoints** — The SDK creates checkpoints when files are modified
- **Checkpoint metadata** — Each checkpoint records the UUID, timestamp, message index, and affected files
- **Rewind operation** — Revert file changes to any previous checkpoint
- **Per-conversation tracking** — Checkpoints are scoped to conversations

### Budget Controls

Resource management for AI operations:

- **Cost limits** — Set maximum USD budget per conversation (`maxBudgetUsd`)
- **Turn limits** — Limit the number of agent turns (`maxTurns`)
- **Thinking token limits** — Control extended thinking budget (`maxThinkingTokens`)
- **Real-time tracking** — Current cost, turns, and token usage displayed during streaming

### Context Usage Tracking

Monitor how much of the context window is being used:

- **Token counts** — Input tokens, output tokens, cache read, and cache creation tokens
- **Context window** — Total context window size and utilization percentage
- **Per-model breakdown** — Usage statistics broken down by model (when model switching occurs)

### Settings

#### General Settings
- Workspaces base directory — Where session worktrees are stored (default: `~/.chatml/workspaces`)

#### Appearance Settings
- Theme — Visual theme selection
- Font size — Code and UI font sizing

#### AI Settings
- Model selection — Choose the Claude model (Opus, Sonnet, Haiku)
- Extended thinking — Enable/disable and configure token budget
- Fallback model — Model to use when primary model fails

#### Git Settings
- Branch prefix — Configure prefix strategy: GitHub username, custom prefix, or none
- Per-workspace prefix overrides

#### Review Settings
- Review prompts — Customize the system prompt for code review conversations
- Global and per-workspace review prompts

#### Account Settings
- GitHub OAuth — Connect GitHub account for PR, issues, and CI features
- Linear OAuth — Connect Linear for issue tracking
- Anthropic API key — Configure Claude API access (encrypted with AES-256-GCM)

#### Advanced Settings
- Environment variables — Configure environment variables passed to agent processes
- MCP server configuration — Add custom MCP servers (stdio, SSE, or HTTP transport)
- PR templates — Global and per-workspace PR description templates
- Workspace configuration — Setup scripts, run scripts, hooks, and auto-setup

### Keyboard Shortcuts

ChatML provides 30+ keyboard shortcuts for efficient navigation:

**Global:**
- `Cmd+K` — Command palette
- `Cmd+N` — New session
- `Cmd+,` — Settings
- `Cmd+W` — Close tab

**Conversation:**
- `Enter` — Send message
- `Shift+Enter` — New line in message
- `Cmd+Shift+S` — Stop agent
- `Cmd+.` — Interrupt agent

**Navigation:**
- `Cmd+1-9` — Switch to session by position
- `Cmd+[` / `Cmd+]` — Navigate between conversations
- `Cmd+Shift+F` — Search in conversation

### Desktop Features

As a native macOS application built with Tauri:

- **Native notifications** — Desktop notifications for agent completions and events
- **Auto-update** — Automatic update detection and installation
- **Single instance** — Prevents multiple app instances, focusing existing window
- **Window state** — Remembers window position and size across launches
- **Deep links** — `chatml://` protocol for OAuth callbacks
- **Secure storage** — Stronghold vault with Argon2id key derivation for credentials
- **Menu bar** — Native macOS menu with standard edit, view, and help menus
- **Traffic lights** — Properly positioned macOS window controls

### Onboarding

First-run experience guides new users through setup:

1. **Welcome** — Introduction to ChatML
2. **API Key** — Configure Anthropic API key or authenticate
3. **Workspaces** — Add repositories as workspaces
4. **Sessions** — Create first session
5. **Conversations** — Start first conversation
6. **Shortcuts** — Learn key keyboard shortcuts

### Dashboard

The main interface provides a unified view of all work:

- **Session sidebar** — All sessions grouped by workspace, with status indicators, PR badges, and sorting
- **Conversation area** — Full message history with streaming, tool display, and interactive controls
- **File panel** — File browser, code editor, and diff viewer
- **CI panel** — Build status and log viewer
- **Terminal panel** — Bottom panel with per-session terminals
- **PR dashboard** — Overview of all pull requests across workspaces

### MCP (Model Context Protocol) Integration

ChatML runs a built-in MCP server that provides tools to the AI agent:

- **get_session_status** — Current session information and git state
- **get_workspace_diff** — Git diff from the base branch
- **get_recent_activity** — Recent git commits
- **add_review_comment** — Add inline code review comments
- **list_review_comments** — List existing comments
- **get_review_comment_stats** — Comment statistics

Additionally, users can configure custom MCP servers per workspace with stdio, SSE, or HTTP transport.

### Conversation Summaries

On-demand AI-generated summaries of conversations:

- **Generate summary** — Request a summary of any conversation
- **Session summaries** — View summaries across all conversations in a session
- **Status tracking** — Summary generation status (generating, completed, failed)

