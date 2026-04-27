# Frontend Test Coverage Baseline — 2026-04-26

Snapshot of the Vitest unit test suite at the start of the test-improvement initiative (`mcastilho/analyze-frontend-unit-test-gaps`). Reproduce with:

```bash
pnpm install --frozen-lockfile
pnpm run test:coverage
```

> **Status:** This file is the Day 0 baseline. Current coverage is tracked at the bottom under "Progress log".

## Suite size & speed

| Metric | Value |
|---|---|
| Test files | 100 |
| Tests | 1760 (all passing) |
| `expect()` calls | 3171 (~1.8 per test) |
| Wall-clock duration | ~6.7s (verbose run), ~8.8s (with coverage) |
| Slowest individual test | 5ms (`useMessagePrefetch > polls at 200ms intervals`) — no specs above 200ms |
| Setup time (parallel) | ~27s — dominated by jsdom + module imports |

The suite is fast. Slow-spec triage is **not** a priority; setup-time reduction is the only meaningful runtime lever.

## Overall coverage

| | % Stmts | % Branch | % Funcs | % Lines |
|---|---|---|---|---|
| **All files** | **19.88** | **17.72** | **17.36** | **20.20** |

The configured threshold (`vitest.config.ts:26-31`) is 20% across all metrics. **Statements, branches, and functions are below threshold** — the gate is symbolic and CI does not run with `--coverage`, so this does not fail the build today.

## Per-directory coverage

Directories sorted by `% Lines`:

| Directory | % Stmts | % Branch | % Funcs | % Lines | Notes |
|---|---|---|---|---|---|
| `lib/` | 59.78 | 58.08 | 57.86 | 61.12 | Strongest area — pure utilities well-tested |
| `__mocks__/` (handlers + tauri) | 79.41 | 65.00 | 66.66 | 77.41 | MSW + Tauri mocks |
| `stores/` | 40.44 | 36.49 | 35.08 | 42.12 | Mixed; appStore drags average down |
| `components/ui/` | 34.43 | 30.66 | 34.04 | 34.85 | shadcn primitives, partial coverage |
| `hooks/` | 25.26 | 17.02 | 26.85 | 25.20 | Many high-value hooks at 0% |
| `lib/api/` | 21.80 | 23.74 | 18.68 | 22.01 | Most endpoint clients at 0% |
| `components/conversation/` | 16.61 | 21.44 | 14.48 | 17.19 | Critical area — ChatInput/PlateInput at 0% |
| `components/shared/` | 15.55 | 12.73 | 15.10 | 15.01 | |
| `components/panels/` | 14.02 | 13.77 | 13.78 | 14.25 | |
| `components/dialogs/` | 11.92 | 16.78 | 10.76 | 10.88 | CommandPalette/FilePicker at 0% |
| `components/settings/sections/` | 7.46 | 12.73 | 7.63 | 7.11 | |
| `components/session-manager/` | 6.75 | 17.14 | 4.00 | 7.07 | |
| `components/files/` | 3.20 | 0.00 | 0.99 | 3.62 | |
| `components/layout/` | 3.46 | 4.13 | 2.66 | 2.75 | |
| `components/conversation/tool-details/` | 0.34 | 0 | 0 | 0.39 | |
| `components/navigation/` | 0.22 | 0 | 0 | 0.25 | |
| `app/` | 0 | 0 | 0 | 0 | `page.tsx` 0% |
| `components/` (root) | 0 | 0 | 0 | 0 | `BranchSyncBanner`, `ConflictDialog` |
| `components/ci/` | 0 | 0 | 0 | 0 | |
| `components/dashboards/` | 0 | 0 | 0 | 0 | PRDashboard, etc. |
| `components/data-table/` | 0 | 0 | 0 | 0 | |
| `components/icons/` | 0 | 0 | 0 | 0 | |
| `components/mission-control/` | 0 | 0 | 0 | 0 | |
| `components/onboarding/`, `onboarding/steps/` | 0 | 0 | 0 | 0 | |
| `components/scheduled/` | 0 | 0 | 0 | 0 | |
| `components/skills/` | 0 | 0 | 0 | 0 | |
| `components/tabs/` | 0 | 0 | 0 | 0 | |
| `components/branch-cleanup/` | 0 | 0 | 0 | 0 | |
| `components/comments/` | 4.34 | 0 | 0 | 4.68 | |
| `lib/permission/` | 0 | 0 | 0 | 0 | |
| `test-utils/` | 0 | 100 | 0 | 0 | Test helpers themselves |

## Notable per-file outliers

### Strong (≥ 90% lines)
`lib/`: action-templates, auth-token, check-utils, clone-errors, conversationMarkers, diffCache, fileContentCache, formatReviewFeedback, linearAuth, markdownCache, menuContext, models, pierre, pkce, pr-utils, slashCommands, thinkingLevels, workspace-colors. `lib/api/`: review-comments. `stores/`: authStore, branchCacheStore (97%), linearAuthStore, recentlyClosedStore, skillsStore, uiStore. `hooks/`: useBranchSync (96%), useCIRuns (95%), useDotMcpTrustCheck (95%), useFileMentions (99%), useGitStatus (100%), useMessagePrefetch (94%), useReviewTrigger (98%), useSessionSnapshot (95%), useStreamingBatcher (97%), useTabPersistence (98%). `components/conversation/`: ChangesBlock (100%), ContextMeter (94%), ThinkingNode (100%), UserBubble (100%), VerificationBlock (100%).

### Critical 0% — load-bearing files with no exercise
| File | Why this matters |
|---|---|
| `src/hooks/useWebSocket.ts` | **0.25%** — 1700+ lines of event dispatch. Despite 7 `useWebSocket.*.test.ts` files, those tests bypass the hook and call store actions directly. See audit doc. |
| `src/hooks/useTerminal.ts` | 0% — terminal lifecycle, large surface |
| `src/hooks/usePRStatus.ts` | 1.61% — PR polling/state |
| `src/hooks/useMenuHandlers.ts` | 40.83% — only paste paths covered |
| `src/components/conversation/ChatInput.tsx` | 0% — main user input (1284 lines) |
| `src/components/conversation/PlateInput.tsx` | 0% — Plate.js editor + content extraction |
| `src/components/conversation/ConversationArea.tsx` | 0% — 1200+ lines |
| `src/components/conversation/StreamingMessage.tsx` | 0% — 600+ lines |
| `src/components/dialogs/CommandPalette.tsx` | 0% — keyboard + search |
| `src/components/dialogs/FilePicker.tsx` | 0% — fuzzy match + picker |
| `src/components/navigation/WorkspaceSidebar.tsx` | 0% — 2500 lines |
| `src/lib/api/git.ts`, `branches.ts`, `ci.ts`, `files.ts`, `file-operations.ts`, `github.ts`, `health.ts`, `repositories.ts`, `scheduled-tasks.ts`, `scripts.ts`, `skills.ts`, `stats.ts`, `summaries.ts` | 0% — full API endpoints uncovered |
| `src/stores/dismissedAttentionStore.ts` | 0% |
| `src/stores/scheduledTaskStore.ts` | 5% |
| `src/stores/settingsStore.ts` | 18% |

## Coverage outputs

- HTML report: `coverage/index.html` (gitignored)
- LCOV: `coverage/lcov.info` (gitignored)
- CI: `frontend-coverage` artifact (14-day retention, see `.github/workflows/ci.yml`)

---

## Progress log

### 2026-04-26 — Initial sweep

**Suite**

| Metric | Day 0 | Now | Δ |
|---|---|---|---|
| Test files | 100 | 132 | +32 |
| Tests | 1760 | 2310 | +550 |
| Wall-clock | ~7s | ~7s | (no regression) |

**Overall coverage**

| | Day 0 | Now | Δ |
|---|---|---|---|
| Statements | 19.88% | **24.50%** | +4.62 |
| Branches | 17.72% | **20.78%** | +3.06 |
| Functions | 17.36% | **23.70%** | +6.34 |
| Lines | 20.20% | **24.90%** | +4.70 |

All four metrics now exceed the 20% gate. The configured threshold has been raised to 22/19/22/22 (~2 pts of headroom over current values).

**Top moves**

- `lib/api/`: 21.80% → **97.29% statements** (23 new test files, 396 tests). Every API client function is now exercised through MSW handlers.
- `useWebSocketHelpers.ts` / `useWebSocketPlanMode.ts` / `useWebSocketReconciliation.ts`: ~15% → **94%–100%**. Pure-function tests for type guards, status mappers, cooldown timers, ref-counted reconciliation.
- `useWebSocket.ts` itself: 0.25% → **13.92%**. Real integration tests with a `MockWebSocket` harness that exercises the actual hook code path (connection lifecycle, reconnect backoff, event dispatch, returned `reconnect()` callback). Mitigates the audit's P0 false-confidence finding (existing 7 `useWebSocket.*.test.ts` files claim to test the hook but only drive store actions).
- `appStore.ts`: 29.17% → **73%** statements (5 new test files, 167 tests). Workspaces, sessions, conversations, file tabs, active tools, sub-agents, background tasks all covered through CRUD + cascade tests.

**CI integration**

- `pnpm run test:coverage` now runs in the `frontend` job (was `pnpm run test:run`), gated by the configured thresholds.
- Coverage report uploaded as an artifact (`frontend-coverage`, 14-day retention).
- Per-directory thresholds added in `vitest.config.ts` for `src/lib/api/**` (85/68/85/85) and `src/stores/**` (60/51/53/61) so well-tested directories cannot silently regress while the global average stays acceptable.
