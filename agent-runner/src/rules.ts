/**
 * Permission rule evaluation for tool approval.
 *
 * Rules follow Claude Code's convention:
 *   - Format: Tool or Tool(specifier)
 *   - Evaluation order: deny → ask → allow (first match wins)
 *   - Specifiers support glob wildcards (*)
 */

export interface PermissionRule {
  id: string;
  tool: string; // "Bash", "Read", "Write", "Edit", etc.
  specifier: string; // "npm run *", "./.env", "domain:example.com", "" for match-all
  action: "allow" | "deny" | "ask";
  scope: "user" | "workspace";
  workspaceId?: string;
}

/**
 * Build a specifier string from a tool's input, used for rule matching.
 * Returns null if no meaningful specifier can be extracted.
 */
export function buildSpecifier(
  toolName: string,
  toolInput: Record<string, unknown>,
): string | null {
  switch (toolName) {
    case "Bash":
      return (toolInput.command as string) || null;
    case "Read":
    case "Write":
    case "Edit":
    case "NotebookEdit":
      return (toolInput.file_path as string) || null;
    case "WebFetch": {
      const url = toolInput.url as string;
      if (!url) return null;
      try {
        return `domain:${new URL(url).hostname}`;
      } catch {
        return null;
      }
    }
    case "Glob":
      return (toolInput.pattern as string) || null;
    case "Grep":
      return (toolInput.pattern as string) || null;
    default:
      // MCP tools: mcp__server__tool — use tool name as specifier
      if (toolName.startsWith("mcp__")) return toolName;
      return null;
  }
}

/**
 * Evaluate rules against a tool invocation.
 * Returns the matching action or null if no rule matches.
 * Evaluation order: deny → ask → allow (first match wins within each tier).
 */
export function evaluateRules(
  rules: PermissionRule[],
  toolName: string,
  specifier: string | null,
): "allow" | "deny" | "ask" | null {
  // Phase 1: deny rules
  for (const rule of rules) {
    if (rule.action === "deny" && matchesRule(rule, toolName, specifier)) {
      return "deny";
    }
  }
  // Phase 2: ask rules
  for (const rule of rules) {
    if (rule.action === "ask" && matchesRule(rule, toolName, specifier)) {
      return "ask";
    }
  }
  // Phase 3: allow rules
  for (const rule of rules) {
    if (rule.action === "allow" && matchesRule(rule, toolName, specifier)) {
      return "allow";
    }
  }
  return null;
}

/**
 * Check if a single rule matches the given tool name and specifier.
 */
function matchesRule(
  rule: PermissionRule,
  toolName: string,
  specifier: string | null,
): boolean {
  if (rule.tool !== toolName) return false;
  // Bare tool name (no specifier) matches all uses of the tool
  if (!rule.specifier) return true;
  // If rule has a specifier but the tool call has none, no match
  if (!specifier) return false;
  return wildcardMatch(rule.specifier, specifier);
}

/**
 * Glob-style wildcard matching (iterative, no regex — immune to ReDoS).
 * Supports `*` as a wildcard that matches any sequence of characters.
 *
 * Following Claude Code conventions:
 *   - `Bash(ls *)` matches "ls -la" but not "lsof" (space before * = word boundary)
 *   - `Bash(ls*)` matches both "ls -la" and "lsof"
 *   - Multiple wildcards are supported: `git * main` matches "git checkout main"
 *
 * Uses a two-pointer greedy algorithm with backtracking anchored at the last `*`.
 */
export function wildcardMatch(pattern: string, value: string): boolean {
  let pi = 0; // pattern index
  let vi = 0; // value index
  let starPi = -1; // last * position in pattern
  let matchVi = -1; // value index when last * was seen

  while (vi < value.length) {
    if (pi < pattern.length && pattern[pi] === "*") {
      // Record * position and advance pattern
      starPi = pi;
      matchVi = vi;
      pi++;
    } else if (pi < pattern.length && pattern[pi] === value[vi]) {
      // Characters match — advance both
      pi++;
      vi++;
    } else if (starPi !== -1) {
      // Mismatch but we have a prior * — backtrack:
      // let * consume one more character from value
      pi = starPi + 1;
      matchVi++;
      vi = matchVi;
    } else {
      // Mismatch with no * to fall back on
      return false;
    }
  }

  // Consume any trailing *s in the pattern
  while (pi < pattern.length && pattern[pi] === "*") {
    pi++;
  }

  return pi === pattern.length;
}
