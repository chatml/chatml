/**
 * Parse a GitHub URL to extract owner and repo name.
 * Handles various formats:
 * - https://github.com/owner/repo
 * - https://github.com/owner/repo.git
 * - https://github.com/owner/repo/tree/main
 * - https://github.com/owner/repo/pull/123
 * - git@github.com:owner/repo.git
 * - ssh://git@github.com/owner/repo
 */
export function parseGitHubUrl(url: string): { owner: string; repo: string } | null {
  if (!url) return null;

  // HTTPS: https://github.com/owner/repo[.git][/...]
  const httpsMatch = url.match(
    /^https?:\/\/github\.com\/([^/]+)\/([^/.]+)/
  );
  if (httpsMatch) {
    return { owner: httpsMatch[1], repo: httpsMatch[2] };
  }

  // SSH: git@github.com:owner/repo[.git]
  const sshMatch = url.match(
    /^git@github\.com:([^/]+)\/([^/.]+)/
  );
  if (sshMatch) {
    return { owner: sshMatch[1], repo: sshMatch[2] };
  }

  // SSH protocol: ssh://git@github.com/owner/repo[.git]
  const sshProtoMatch = url.match(
    /^ssh:\/\/git@github\.com\/([^/]+)\/([^/.]+)/
  );
  if (sshProtoMatch) {
    return { owner: sshProtoMatch[1], repo: sshProtoMatch[2] };
  }

  return null;
}

/**
 * Extract the repository/directory name from any git URL.
 * Returns just the repo name portion, suitable for use as a directory name.
 *
 * Examples:
 * - https://github.com/user/my-repo.git → "my-repo"
 * - git@github.com:org/project.git → "project"
 * - https://gitlab.com/user/app → "app"
 * - ssh://git@bitbucket.org/team/lib.git → "lib"
 */
export function extractRepoName(url: string): string | null {
  if (!url) return null;

  const trimmed = url.trim();
  if (!trimmed) return null;

  // Remove trailing slashes first, then .git suffix
  let cleaned = trimmed.replace(/\/+$/, '');
  cleaned = cleaned.replace(/\.git$/, '');

  // Handle git@host:owner/repo format
  const sshMatch = cleaned.match(/^git@[^:]+:(.+)$/);
  if (sshMatch) {
    cleaned = sshMatch[1];
  }

  // Get the last path segment
  const lastSegment = cleaned.split('/').pop();

  if (!lastSegment || lastSegment.includes(':') || lastSegment.includes('\\')) {
    return null;
  }

  // Basic sanity check — should look like a valid directory name
  if (lastSegment.length === 0 || lastSegment === '.' || lastSegment === '..') {
    return null;
  }

  return lastSegment;
}
