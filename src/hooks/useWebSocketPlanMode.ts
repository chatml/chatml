// Conversations that recently exited plan mode. Maps conversationId → exit timestamp.
// Used to suppress stale SDK status messages that try to re-activate plan mode after
// ExitPlanMode approval (SDK bug #15755). A timestamp-based cooldown ensures multiple
// stale events are all suppressed (not just the first one, as with a Set).
const recentlyExitedPlanMode = new Map<string, number>();
const PLAN_MODE_EXIT_COOLDOWN_MS = 5000;

// Check if a conversation is within the plan mode exit cooldown window
export function isInPlanModeExitCooldown(conversationId: string): boolean {
  const exitTime = recentlyExitedPlanMode.get(conversationId);
  if (exitTime == null) return false;
  return Date.now() - exitTime < PLAN_MODE_EXIT_COOLDOWN_MS;
}

// Allow UI components (e.g. plan approval, toggle) to mark a conversation as recently
// exited so that stale `init` or `permission_mode_changed` events don't re-activate it.
export function markPlanModeExited(conversationId: string) {
  recentlyExitedPlanMode.set(conversationId, Date.now());
  // Auto-cleanup after cooldown expires
  setTimeout(() => {
    // Only delete if timestamp hasn't been refreshed
    const exitTime = recentlyExitedPlanMode.get(conversationId);
    if (exitTime != null && Date.now() - exitTime >= PLAN_MODE_EXIT_COOLDOWN_MS) {
      recentlyExitedPlanMode.delete(conversationId);
    }
  }, PLAN_MODE_EXIT_COOLDOWN_MS + 100);
}

// Clear plan mode state for a specific conversation (used during cleanup)
export function clearPlanModeState(conversationId: string) {
  recentlyExitedPlanMode.delete(conversationId);
}
