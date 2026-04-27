# Frontend Test Audit Findings — 2026-04-26

Companion to `docs/test-coverage-baseline.md`. Catalogues quality issues in the existing 100-file / 1760-test Vitest suite. Sourced from a static-pattern scan and targeted reads of suspicious files.

Each finding has a fix priority:

- **P0** — false-confidence risk; tests don't exercise what they claim to.
- **P1** — known flakiness vector; fix before CI gates tighten.
- **P2** — quality smell; fix opportunistically.
- **OK** — verified clean (negative finding worth recording).

---

## P0 — False-confidence findings

### F-1. `useWebSocket` tests don't exercise `useWebSocket`
**Files:** `src/hooks/__tests__/useWebSocket.{events,initialReconcile,reconnect,snapshot,contextUsage,mcp,subagents}.test.ts` (7 files)
**Evidence:** Header comment in `useWebSocket.events.test.ts:5-7`:
> *"These tests simulate what the useWebSocket handler does when it receives events by calling store actions directly, matching the existing test pattern."*

None of the 7 files import `useWebSocket` (`grep -l "from.*useWebSocket" src/hooks/__tests__/useWebSocket.*.test.ts` → empty). They only import `useAppStore` and call store mutators.

Coverage confirms the impact: `src/hooks/useWebSocket.ts` is at **0.25%** lines covered. The 1700+ lines of event parsing, dispatch, batching, reconcile, reconnect, plan-mode handling, and MCP routing are effectively untested.

**Fix direction:** Phase 2 work — add real tests that mount the hook with a mock `WebSocket` and feed it server messages. Either:
- Inject a `WebSocket` factory (one-line refactor), or
- Use `vi.stubGlobal('WebSocket', MockWebSocket)`, or
- Move the dispatch logic into pure functions (already partially done in `useWebSocketHelpers.ts`) and test those directly.

Don't delete the existing 7 files — rename them to `appStore.wsEvents.*.test.ts` (they're store-action tests, not hook tests) so the naming reflects what they actually verify.

### F-2. Coverage threshold is not actually enforced
**Files:** `vitest.config.ts:26-31`, `.github/workflows/ci.yml:74`
**Evidence:**
- Configured threshold: 20% statements/branches/functions/lines.
- Actual: 19.88% / 17.72% / 17.36% / 20.20%.
- Local `pnpm run test:coverage` *does* fail with this baseline.
- CI runs `pnpm run test:run` (no `--coverage`), so the threshold never executes in PR pipelines.

**Fix:** Phase 1.6 — switch CI to `test:coverage`, surface report as a PR comment. (Plan already covers this.)

---

## P1 — Flakiness vectors

### F-3. Real-time `setTimeout` waits in tests
**Pattern:** `await new Promise((r) => setTimeout(r, N))`
**Count:** 22 occurrences across 4 files.

| File | Count | Notes |
|---|---|---|
| `src/hooks/__tests__/useFileWatcher.test.ts` | 17 (mostly `r, 0` for microtask flushes, one `r, 50`) | Heavy reliance on real timers |
| `src/hooks/__tests__/useDotMcpTrustCheck.test.ts` | 4 (all `r, 50`) | Negative-assertion waits — race-prone |
| `src/hooks/__tests__/useMessagePrefetch.test.ts` | 1 (`r, 500`) | Inside MSW handler — defines server delay, not a wait |
| `src/components/conversation/__tests__/UserQuestionPrompt.test.tsx` | 1 (`r, 250`) | One-off |

**Highest risk:** `useDotMcpTrustCheck.test.ts:131,142,161,189` — all four are *negative* waits ("after 50ms, assert nothing happened"). On a slow CI runner, the function under test could trigger after 50ms, producing a false pass when the negative test should fail. Replace with `vi.useFakeTimers()` + deterministic flushing, or with `await waitFor()` inverted via `expect(...).not.toHaveBeenCalled()` after a real promise tick.

**`useFileWatcher.test.ts`:** the `setTimeout(r, 0)` pattern is microtask flushing — generally safe but a code smell. Vitest provides `await vi.dynamicImportSettled()` and `await Promise.resolve()` for explicit microtask boundaries; the file already uses `vi.dynamicImportSettled?.() ?? new Promise(r => setTimeout(r, 0))` at line 103 — a hint someone knew the right tool but didn't apply it consistently.

**Fix:** Phase 1.3 — standardize on fake timers + `vi.advanceTimersByTimeAsync` for any test that asserts "X happens after delay" or "X does not happen within delay."

### F-4. Mock theater in `useMenuHandlers.paste.test.ts`
**File:** `src/hooks/__tests__/useMenuHandlers.paste.test.ts`
**Evidence:** 12 `vi.mock()` calls (lines 9, 21, 25, 29, 36, 45, 51, 57, 63, 67, 71). Mocks include `@/lib/tauri`, `next-themes`, `@/components/ui/toast`, **all five Zustand stores**, `@/lib/constants`, `@/components/navigation/BrowserTabBar`, and `@/hooks/useClaudeAuthStatus`.

When every collaborator is mocked, the test runs against a synthetic environment that the real app never inhabits. Bugs in any of those mocked surfaces (renamed exports, behavior changes) silently pass. The hook itself shows **40.83%** coverage despite this file existing — the test is exercising a narrow path through a mock garden.

**Fix:** Phase 2 — when adding the rest of `useMenuHandlers` coverage, prefer real Zustand stores (mock factories already exist in `src/test-utils/store-utils.ts`) and only mock the platform boundary (Tauri APIs).

### F-5. Console error/warn suppression — verify scoping
**Pattern:** `vi.spyOn(console, 'error').mockImplementation(() => {})`
**Count:** 17 occurrences across 8 files.

| File | Count |
|---|---|
| `src/lib/__tests__/linearAuth.test.ts` | 4 |
| `src/hooks/__tests__/useTabPersistence.test.ts` | 2 |
| `src/hooks/__tests__/useFileMentions.test.ts` | 3 |
| `src/hooks/__tests__/useReviewTrigger.test.ts` | 2 |
| `src/stores/__tests__/updateStore.test.ts` | 2 |
| `src/lib/__tests__/auth-token.test.ts` | 1 |
| `src/hooks/__tests__/useWebSocket.events.test.ts` | 2 (`console.warn`) |

Spot-reading: most are local to a single negative-path test (catching a logged error in error-handling code). That's acceptable. **Verify** during Phase 1.3 that none are at top-of-file scope (which would suppress unrelated `act()` warnings, hiding real React bugs).

### F-6. `--localstorage-file` warning during test runs
**Evidence:** `(node:69158) Warning: '--localstorage-file' was provided without a valid path` fires multiple times in every run.

`vitest.setup.ts` already provides a localStorage polyfill (lines 7-18). This warning is from Node's built-in localStorage flag being forwarded by Vitest 4. Cosmetic but obscures real warnings in logs. Worth filing a small fix.

**Fix:** Phase 1, low-priority polish — investigate and silence at the Vitest invocation or via `--no-localstorage-file` if available.

---

## P2 — Quality smells

### F-7. Async-test discipline
**Pattern:** 533 `it(..., async () => ...)` declarations across 45 files.

Many are valid. But async test bodies that never `await` anything are landmines (no failure raises until the next test cleanup). A file-by-file pass during Phase 2 should grep for `async (` paired with no `await` in the body — automate this if feasible.

### F-8. `vi.mock()` density
**Pattern:** 56 `vi.mock()` declarations across 29 files.

Distribution looks reasonable. The outlier is `useMenuHandlers.paste.test.ts` (12 mocks, see F-4). Anything with >5 mocks per file deserves a second look in Phase 2.

### F-9. `runInAct` underused
**File:** `src/test-utils/store-utils.ts` exports a `runInAct` helper to wrap Zustand mutations in React's `act()`. Coverage shows `test-utils/` at 0% — not because the helpers don't work, but because they're underused (or used directly without coverage instrumentation).

When new store tests are added in Phase 2, prefer `runInAct(() => store.setState(...))` over bare `store.setState(...)` to avoid React testing warnings on consumers that re-render.

### F-10. `expect()` density looks healthy
**Counts:** 3171 `expect()` across 1760 tests = ~1.8 per test. No obvious assertion-less `it` blocks; would need AST parsing to be sure. Spot-reading didn't surface any.

---

## OK — Negative findings (verified clean)

| Check | Result |
|---|---|
| Snapshot test usage (`toMatchSnapshot`/`toMatchInlineSnapshot`) | **0 occurrences** — no snapshot abuse. |
| Skipped tests (`.skip`/`.only`/`.todo`/`.fit`/`.xit`) | **0 occurrences** — no abandoned/forgotten tests. |
| Fake-timer / real-timer balance | 50 calls across 21 files; spot-checked `appStore.contextUsage.test.ts` (3 fake / 1 real-in-`afterEach`) and `useDesktopNotifications.test.ts` (2/2) — proper cleanup pattern via `afterEach`. No leak detected. |
| Test failures | **0** — 1760/1760 pass deterministically across the runs in this audit. |
| Slowest spec | 5 ms (`useMessagePrefetch > polls at 200ms intervals`). No spec exceeds 200 ms. |
| Custom render patterns | Single `src/test-utils/render.tsx` with `ThemeProvider`. Consistent. |

---

## Action priority for Phase 1

1. **F-2** — wire `test:coverage` into CI, publish PR comment. *(Phase 1.6 of the master plan.)*
2. **F-1** — write real `useWebSocket.ts` tests that drive the hook through a `WebSocket` mock; rename the existing 7 files to reflect their actual scope. *(Promote into Phase 1.3 instead of Phase 2 — false confidence here is too high to leave for later.)*
3. **F-3** — replace `setTimeout(r, 50)` negative waits in `useDotMcpTrustCheck.test.ts` with fake timers. *(Phase 1.3.)*
4. **F-6** — silence the `--localstorage-file` warning. *(Cosmetic.)*
5. **F-4, F-5, F-7, F-8, F-9** — review/cleanup as part of Phase 2 gap-filling work; not a blocker.

---

## Reproduction

```bash
pnpm install --frozen-lockfile
pnpm run test:coverage          # baseline numbers
pnpm exec vitest run --reporter=verbose 2>&1 | tee /tmp/verbose.log
grep -E '\b[0-9]{3,}ms\b' /tmp/verbose.log    # slow specs (none today)
```

Pattern grep recipes used in this audit:

```bash
# Real-time setTimeout waits
rg 'new Promise\s*\(\s*\(?\s*(resolve|r)\s*\)?\s*=>\s*setTimeout' --type ts -g '**/*.{test,spec}.{ts,tsx}'

# vi.mock density
rg 'vi\.mock\(' --type ts -g '**/*.{test,spec}.{ts,tsx}' -c

# Skipped tests
rg '\.(skip|todo|only)\(|fit\(|xit\(|xdescribe\(' --type ts -g '**/*.{test,spec}.{ts,tsx}'

# Snapshot usage
rg 'toMatchSnapshot|toMatchInlineSnapshot' --type ts -g '**/*.{test,spec}.{ts,tsx}'
```
