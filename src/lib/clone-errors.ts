/**
 * Classifies a clone error message into a user-friendly string.
 * Used by both CloneFromUrlDialog and GitHubReposDialog.
 */
export function classifyCloneError(error: unknown, signal?: AbortSignal): string {
  if (signal?.aborted) {
    // Distinguish timeout aborts from user-initiated cancels.
    // setTimeout-based aborts pass a reason string; user cancels do not.
    if (signal.reason === 'clone_timeout') {
      return 'Clone timed out. The repository may be too large or the server is unreachable.';
    }
    return 'Clone was cancelled.';
  }

  const msg = error instanceof Error ? error.message : 'Clone failed';

  if (msg.includes('already exists')) {
    return 'A directory with this name already exists at the selected location.';
  }
  if (msg.includes('authentication failed') || msg.includes('SSH authentication')) {
    return 'Authentication failed. Please check your credentials or SSH key setup.';
  }
  if (msg.includes('not found')) {
    return 'Repository not found. Please check the URL and your access permissions.';
  }
  if (msg.includes('timed out')) {
    return 'Clone timed out. The repository may be too large or the server is unreachable.';
  }
  if (msg.includes('clone failed') || msg.includes('BAD_GATEWAY')) {
    return 'Git clone failed. Please check the URL and try again.';
  }
  return msg;
}
