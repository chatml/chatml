/**
 * Shared formatting utilities.
 */

/** Format a token count as a compact string (e.g. 1.2M, 45.3K, 800). */
export const formatTokens = (tokens: number) => {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`;
  return tokens.toString();
};

// ---------------------------------------------------------------------------
// MCP tool name formatting
// ---------------------------------------------------------------------------

export interface McpToolInfo {
  serverName: string;     // raw server name, e.g. "chatml"
  toolName: string;       // raw tool name, e.g. "get_session_status"
  displayLabel: string;   // human-readable, e.g. "Get session status"
  displayServer: string;  // human-readable, e.g. "ChatML"
}

/** Known MCP server display names. */
const SERVER_DISPLAY_NAMES: Record<string, string> = {
  chatml: 'ChatML',
  claude_ai_Linear: 'Linear',
  tauri: 'Tauri',
};

/** Convert snake_case to sentence case: "get_session_status" → "Get session status" */
function formatSnakeCaseToLabel(name: string): string {
  const words = name.split('_');
  if (words.length === 0) return name;
  return words
    .map((w, i) => (i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(' ');
}

/** Convert raw server name to display-friendly name. */
function formatServerName(name: string): string {
  if (SERVER_DISPLAY_NAMES[name]) return SERVER_DISPLAY_NAMES[name];
  return name
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Parse an MCP tool name (e.g. "mcp__chatml__get_session_status") into
 * structured display info. Returns null for non-MCP tool names.
 */
export function parseMcpToolName(rawTool: string): McpToolInfo | null {
  if (!rawTool.startsWith('mcp__')) return null;

  const parts = rawTool.split('__');
  if (parts.length < 3) return null;

  const serverName = parts[1];
  const toolName = parts.slice(2).join('__');

  return {
    serverName,
    toolName,
    displayLabel: formatSnakeCaseToLabel(toolName),
    displayServer: formatServerName(serverName),
  };
}
