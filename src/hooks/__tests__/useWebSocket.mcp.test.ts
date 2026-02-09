import { describe, it, expect } from 'vitest';

/**
 * Tests for the MCP tools extraction logic used in useWebSocket.ts.
 *
 * The init event from the agent-runner includes a `tools: string[]` array.
 * MCP tools follow the naming pattern: mcp__<serverName>__<toolName>
 * The WebSocket handler parses these to build mcpToolsByServer.
 */
function parseMcpToolsByServer(tools: string[]): Record<string, string[]> {
  const toolsByServer: Record<string, string[]> = {};
  for (const tool of tools) {
    if (tool.startsWith('mcp__')) {
      const parts = tool.split('__');
      if (parts.length >= 3) {
        const serverName = parts[1];
        if (!toolsByServer[serverName]) toolsByServer[serverName] = [];
        toolsByServer[serverName].push(parts.slice(2).join('__'));
      }
    }
  }
  return toolsByServer;
}

describe('parseMcpToolsByServer', () => {
  it('parses single server with single tool', () => {
    const result = parseMcpToolsByServer(['mcp__github__list_issues']);
    expect(result).toEqual({ github: ['list_issues'] });
  });

  it('parses single server with multiple tools', () => {
    const result = parseMcpToolsByServer([
      'mcp__github__list_issues',
      'mcp__github__create_pr',
    ]);
    expect(result).toEqual({
      github: ['list_issues', 'create_pr'],
    });
  });

  it('parses multiple servers', () => {
    const result = parseMcpToolsByServer([
      'mcp__github__list_issues',
      'mcp__filesystem__read_file',
      'mcp__github__create_pr',
    ]);
    expect(result).toEqual({
      github: ['list_issues', 'create_pr'],
      filesystem: ['read_file'],
    });
  });

  it('ignores non-MCP tools', () => {
    const result = parseMcpToolsByServer([
      'Read',
      'Write',
      'mcp__github__list_issues',
      'Bash',
    ]);
    expect(result).toEqual({ github: ['list_issues'] });
  });

  it('handles empty tools array', () => {
    const result = parseMcpToolsByServer([]);
    expect(result).toEqual({});
  });

  it('handles tools with no MCP tools', () => {
    const result = parseMcpToolsByServer(['Read', 'Write', 'Bash']);
    expect(result).toEqual({});
  });

  it('handles tool names with underscores', () => {
    const result = parseMcpToolsByServer(['mcp__server__get_all_items']);
    expect(result).toEqual({ server: ['get_all_items'] });
  });

  it('handles nested double underscores in tool name', () => {
    const result = parseMcpToolsByServer(['mcp__server__deep__nested__tool']);
    expect(result).toEqual({ server: ['deep__nested__tool'] });
  });

  it('handles malformed MCP tool with only prefix', () => {
    const result = parseMcpToolsByServer(['mcp__']);
    expect(result).toEqual({});
  });

  it('handles MCP tool with only server name', () => {
    const result = parseMcpToolsByServer(['mcp__github']);
    expect(result).toEqual({});
  });

  it('handles built-in chatml server tools', () => {
    const result = parseMcpToolsByServer([
      'mcp__chatml__workspace_info',
      'mcp__chatml__list_files',
    ]);
    expect(result).toEqual({
      chatml: ['workspace_info', 'list_files'],
    });
  });

  it('handles mix of valid and invalid MCP patterns', () => {
    const result = parseMcpToolsByServer([
      'mcp__',
      'mcp__github',
      'mcp__github__list_issues',
      'Read',
      'mcp____empty_server',
      'mcp__slack__send_message',
    ]);
    expect(result).toEqual({
      github: ['list_issues'],
      '': ['empty_server'],
      slack: ['send_message'],
    });
  });
});
