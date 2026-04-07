/**
 * Smart wildcard suggestion for the tool approval prompt.
 * Mirrors core/permission/suggestion.go.
 */

export interface WildcardSuggestion {
  /** Human-readable label for the button, e.g. "Yes, allow git commands" */
  label: string;
  /** Wildcard pattern for the persistent rule, e.g. "git *" */
  specifier: string;
}

/**
 * Compute a smart wildcard approval suggestion for a tool call.
 * Returns null if no meaningful wildcard can be derived.
 */
export function suggestWildcard(toolName: string, specifier: string): WildcardSuggestion | null {
  if (!specifier) return null;

  switch (toolName) {
    case 'Bash':
      return suggestBashWildcard(specifier);
    case 'Write':
      return suggestFileWildcard('writing to', specifier);
    case 'Edit':
    case 'NotebookEdit':
      return suggestFileWildcard('editing in', specifier);
    case 'WebFetch':
      if (specifier.startsWith('domain:')) {
        const domain = specifier.slice('domain:'.length);
        return { label: `Yes, allow fetching from ${domain}`, specifier };
      }
      return null;
    default:
      return null;
  }
}

function suggestBashWildcard(command: string): WildcardSuggestion | null {
  const cmd = extractFirstCommand(command);
  if (!cmd) return null;

  const trimmed = command.trim();
  if (trimmed === cmd) {
    return { label: `Yes, allow ${cmd} commands`, specifier: cmd };
  }

  return { label: `Yes, allow all ${cmd} commands`, specifier: `${cmd} *` };
}

function suggestFileWildcard(verb: string, filePath: string): WildcardSuggestion | null {
  if (!filePath) return null;

  const lastSlash = filePath.lastIndexOf('/');
  if (lastSlash < 0) {
    // File in current directory — suggest by extension
    const dotIdx = filePath.lastIndexOf('.');
    if (dotIdx > 0) {
      const ext = filePath.slice(dotIdx);
      return { label: `Yes, allow ${verb} *${ext} files`, specifier: `*${ext}` };
    }
    return null;
  }

  const dir = filePath.slice(0, lastSlash);
  const dirName = dir.split('/').pop() || dir;
  return { label: `Yes, allow ${verb} ${dirName}/`, specifier: `${dir}/*` };
}

/** Command wrappers that pass through to the next argument. */
const WRAPPERS = new Set(['env', 'command', 'xargs', 'nohup', 'time', 'nice', 'ionice', 'strace']);

/**
 * Extract the first effective command from a shell command string.
 * Skips env variable assignments (KEY=VALUE) and command wrappers (env, command, nohup, etc.).
 */
function extractFirstCommand(command: string): string {
  const tokens = command.trim().split(/\s+/);
  let i = 0;

  while (i < tokens.length) {
    const token = tokens[i];

    // Skip env variable assignments (KEY=VALUE)
    if (token.includes('=') && !token.startsWith('-') && !token.includes('/')) {
      i++;
      continue;
    }

    // Skip command wrappers
    if (WRAPPERS.has(token)) {
      i++;
      // Skip any flags after the wrapper
      while (i < tokens.length && tokens[i].startsWith('-')) {
        i++;
      }
      continue;
    }

    // Return the base name (strip path)
    const slashIdx = token.lastIndexOf('/');
    return slashIdx >= 0 ? token.slice(slashIdx + 1) : token;
  }

  return '';
}
