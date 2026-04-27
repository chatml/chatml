/**
 * Async test helpers.
 *
 * `flushAsync` advances the microtask queue a fixed number of ticks. Use it
 * instead of `await new Promise((r) => setTimeout(r, N))` for *negative*
 * assertions ("nothing happens within X") — those macrotask waits are
 * race-prone on slow CI runners (audit F-3). For waiting on a *condition*,
 * prefer `@testing-library/react`'s `waitFor` instead.
 */
export async function flushAsync(ticks: number = 3): Promise<void> {
  for (let i = 0; i < ticks; i++) {
    await Promise.resolve();
  }
}
