# Testing Strategy

ChatML employs testing across its four language components. This document describes the testing approach for each layer.

## Frontend Testing

**Framework:** Vitest + React Testing Library

```bash
npm test              # Run all frontend tests
npm run test:watch    # Watch mode
npm run test:coverage # With coverage report
```

### Test Structure

Frontend tests focus on:
- **Component rendering** — Components render correctly with given props
- **User interactions** — Click handlers, form submissions, keyboard shortcuts
- **Store logic** — Zustand store actions produce expected state changes
- **Hook behavior** — Custom hooks respond correctly to events

### Tauri Mocks

Since Tauri IPC commands are unavailable in the test environment, they're mocked:

```typescript
// Mock Tauri invoke
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));
```

## Backend Testing

**Framework:** Go's built-in `testing` package

```bash
cd backend && go test ./...           # Run all tests
cd backend && go test -race ./...     # With race detection
cd backend && go test -v ./store/...  # Verbose, specific package
```

### Test Patterns

- **Handler tests** — HTTP request/response testing with `httptest`
- **Store tests** — SQLite operations with in-memory databases
- **Git operation tests** — Worktree creation with temporary repositories
- **Parser tests** — Event parsing with sample JSON

### Race Detection

Go's race detector (`-race` flag) is used in CI to catch concurrency issues in the WebSocket hub, agent manager, and store operations.

## Agent Runner Testing

**Framework:** TypeScript compilation check

```bash
cd agent-runner && npm run build    # Type check via tsc
```

The agent runner primarily validates through TypeScript compilation. Runtime behavior is tested indirectly through integration with the Go backend.

## CI Pipeline

The CI pipeline runs on pull requests with path-based change detection:

| Job | Trigger Paths | Commands |
|-----|---------------|----------|
| Frontend lint | `src/**`, `package.json` | `npm run lint` |
| Frontend build | `src/**`, `package.json` | `npm run build` |
| Frontend tests | `src/**`, `__tests__/**` | `npm test` |
| Backend tests | `backend/**` | `go test -race ./...` |
| Backend build | `backend/**` | `go build ./...` |
| Agent runner build | `agent-runner/**` | `npm run build` |

### Path-Based Detection

Jobs only run when relevant files change. Changing a Go file doesn't trigger frontend tests, and vice versa. This keeps CI fast for focused changes.

## Verification Checklist

Before completing any task:

```bash
# Frontend
npm run lint          # ESLint passes
npm run build         # TypeScript compiles, build succeeds

# Backend
cd backend && go test ./...   # All tests pass
cd backend && go build ./...  # Compiles without errors

# Full stack
make dev              # Manual testing
```

## Related Documentation

- [Getting Started](./getting-started.md)
- [Architecture Decisions](./architecture-decisions.md)
