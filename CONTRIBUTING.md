# Contributing to ChatML

Thank you for your interest in contributing to ChatML! This guide will help you get set up and understand our development workflow.

## Prerequisites

- [Node.js](https://nodejs.org) v20+
- [Go](https://go.dev) 1.22+
- [Rust](https://www.rust-lang.org/tools/install) (latest stable)
- [Tauri CLI](https://tauri.app/start/prerequisites/) v2
- macOS 10.15+ (ChatML is currently macOS-only)

## Development Setup

1. **Clone the repository**
   ```bash
   git clone https://github.com/chatml/chatml.git
   cd chatml
   ```

2. **Copy environment config**
   ```bash
   cp .env.example .env
   ```
   Edit `.env` with your Anthropic API key. GitHub OAuth works out of the box (see [OAuth Setup](#oauth-setup)).

3. **Start development**
   ```bash
   make dev
   ```
   This installs dependencies, builds the Go backend and agent-runner, and starts the Tauri dev server.

## Build Commands

| Command | Description |
|---------|-------------|
| `make dev` | Start all services (backend + frontend + Tauri) |
| `make backend` | Build Go backend only |
| `make agent-runner` | Build agent-runner only |
| `make build` | Production build |
| `make build-debug` | Debug build (no code signing required) |
| `make test` | Run Go backend tests |
| `make clean` | Remove all build artifacts |

## Testing & Linting

Before submitting a PR, run:

```bash
# Go backend
make test                  # Run tests with race detection
cd backend && go vet ./... # Static analysis

# Frontend
npm run lint               # ESLint
npm run build              # TypeScript type checking + build
```

## OAuth Setup

ChatML integrates with GitHub and Linear via OAuth.

### GitHub OAuth

`.env.example` ships with a shared development OAuth App — just `cp .env.example .env` and GitHub OAuth works out of the box. No setup needed.

The dev OAuth App is separate from production. Production credentials are injected at build time via GitHub Actions secrets.

### Linear OAuth

Linear requires your own OAuth app:

1. Go to [Linear API Applications](https://linear.app/settings/api/applications)
2. Create a new application
3. Set **Callback URL** to: `chatml://oauth/callback`
4. Copy the Client ID to your `.env` file

### Running Without OAuth

GitHub and Linear OAuth are optional. ChatML works without them — you just won't have PR creation or Linear issue tracking features. The Anthropic API key is required for AI functionality.

## Auto-Updater

The auto-updater in `src-tauri/tauri.conf.json` is configured for the official ChatML distribution. If you're building a fork:

- Update the `endpoints` URL to point to your own releases
- Or set `"createUpdaterArtifacts": false` in the bundle config to disable it
- Or simply ignore updater errors during development (`make build-debug` handles this)

## Architecture Overview

ChatML is a polyglot application with four layers:

```
Tauri (Rust) → Next.js Frontend (React) → Go Backend → Agent Runner (Node.js)
```

See [ARCHITECTURE.md](ARCHITECTURE.md) for details.

### Adding a New Model Provider

ChatML currently supports Claude via the Anthropic Claude Agent SDK. The architecture is designed for community-contributed providers:

1. **Go backend**: The `ai.Provider` interface in `backend/ai/provider.go` defines the contract for lightweight AI tasks (PR generation, summarization). Implement this interface for your provider.

2. **Agent runner**: The agent runner communicates with the Go backend via a stdin/stdout JSON protocol documented in `docs/agent-runner-protocol.md`. To add a new provider, implement an agent runner that speaks this protocol.

3. **Frontend**: Provider capabilities are exposed via `GET /api/provider/capabilities`. The UI conditionally shows features based on what the provider supports.

## Pull Request Process

1. Create a feature branch from `main`: `git checkout -b feature/description`
2. Make your changes
3. Run the full test/lint suite (see above)
4. Push and open a PR against `main`
5. Describe what you changed and why in the PR description

## Code Style

- **Go**: Standard `gofmt` formatting, no special linter config
- **TypeScript/React**: ESLint config in the repo (run `npm run lint`)
- **Rust**: Standard `rustfmt` formatting
- Keep changes focused — one logical change per PR
