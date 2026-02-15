import { describe, it, expect } from 'vitest';
import { parseMcpToolName } from '../format';

describe('parseMcpToolName', () => {
  it('parses a chatml MCP tool name', () => {
    const result = parseMcpToolName('mcp__chatml__get_session_status');
    expect(result).toEqual({
      serverName: 'chatml',
      toolName: 'get_session_status',
      displayLabel: 'Get session status',
      displayServer: 'ChatML',
    });
  });

  it('parses a Linear MCP tool name', () => {
    const result = parseMcpToolName('mcp__claude_ai_Linear__get_issue');
    expect(result).toEqual({
      serverName: 'claude_ai_Linear',
      toolName: 'get_issue',
      displayLabel: 'Get issue',
      displayServer: 'Linear',
    });
  });

  it('parses a Tauri MCP tool name', () => {
    const result = parseMcpToolName('mcp__tauri__webview_screenshot');
    expect(result).toEqual({
      serverName: 'tauri',
      toolName: 'webview_screenshot',
      displayLabel: 'Webview screenshot',
      displayServer: 'Tauri',
    });
  });

  it('returns null for non-MCP tool names', () => {
    expect(parseMcpToolName('Read')).toBeNull();
    expect(parseMcpToolName('Bash')).toBeNull();
    expect(parseMcpToolName('WebSearch')).toBeNull();
  });

  it('returns null for malformed MCP names with fewer than 3 parts', () => {
    expect(parseMcpToolName('mcp__foo')).toBeNull();
  });

  it('formats unknown server names with title case', () => {
    const result = parseMcpToolName('mcp__my_custom_server__do_something');
    expect(result).not.toBeNull();
    expect(result!.displayServer).toBe('My Custom Server');
    expect(result!.displayLabel).toBe('Do something');
  });

  it('handles tool names with multiple underscores', () => {
    const result = parseMcpToolName('mcp__chatml__get_recent_activity');
    expect(result).not.toBeNull();
    expect(result!.displayLabel).toBe('Get recent activity');
  });
});
