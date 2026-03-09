import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { McpServersPanel } from '../McpServersPanel';
import { useAppStore } from '@/stores/appStore';

// ============================================================================
// McpServersPanel Tests
// ============================================================================

describe('McpServersPanel', () => {
  const fetchMcpServerConfigsMock = vi.fn();
  const saveMcpServerConfigsMock = vi.fn();

  beforeEach(() => {
    useAppStore.setState({
      selectedWorkspaceId: 'ws-1',
      mcpServers: [],
      mcpServerConfigs: [],
      mcpConfigLoading: false,
      mcpToolsByServer: {},
      mcpServerSources: {},
      fetchMcpServerConfigs: fetchMcpServerConfigsMock,
      saveMcpServerConfigs: saveMcpServerConfigsMock,
    });
    fetchMcpServerConfigsMock.mockClear();
    saveMcpServerConfigsMock.mockClear();
  });

  // --------------------------------------------------------------------------
  // Empty state
  // --------------------------------------------------------------------------

  it('renders empty state when no servers', () => {
    render(<McpServersPanel />);
    expect(screen.getByText('No MCP servers')).toBeInTheDocument();
  });

  // --------------------------------------------------------------------------
  // Runtime status servers
  // --------------------------------------------------------------------------

  it('renders runtime status servers', () => {
    useAppStore.setState({
      mcpServers: [{ name: 'github', status: 'connected' }],
    });

    render(<McpServersPanel />);
    expect(screen.getByText('github')).toBeInTheDocument();
    expect(screen.getByText('Connected')).toBeInTheDocument();
  });

  it('renders multiple server statuses', () => {
    useAppStore.setState({
      mcpServers: [
        { name: 'github', status: 'connected' },
        { name: 'filesystem', status: 'failed' },
        { name: 'slack', status: 'pending' },
      ],
    });

    render(<McpServersPanel />);

    expect(screen.getByText('github')).toBeInTheDocument();
    expect(screen.getByText('Connected')).toBeInTheDocument();

    expect(screen.getByText('filesystem')).toBeInTheDocument();
    expect(screen.getByText('Failed')).toBeInTheDocument();

    expect(screen.getByText('slack')).toBeInTheDocument();
    expect(screen.getByText('Connecting...')).toBeInTheDocument();
  });

  // --------------------------------------------------------------------------
  // Unified view with source badges
  // --------------------------------------------------------------------------

  it('shows source badges for servers', () => {
    useAppStore.setState({
      mcpServers: [
        { name: 'chatml', status: 'connected' },
        { name: 'tauri', status: 'connected' },
      ],
      mcpServerSources: {
        chatml: 'builtin',
        tauri: 'dot-mcp',
      },
    });

    render(<McpServersPanel />);

    expect(screen.getByText('Built-in')).toBeInTheDocument();
    expect(screen.getByText('.mcp.json')).toBeInTheDocument();
  });

  it('shows configured servers in unified view', () => {
    useAppStore.setState({
      mcpServerConfigs: [
        { name: 'my-server', type: 'stdio', command: 'npx', enabled: true },
      ],
    });

    render(<McpServersPanel />);

    expect(screen.getByText('my-server')).toBeInTheDocument();
  });

  // --------------------------------------------------------------------------
  // Idle servers
  // --------------------------------------------------------------------------

  it('shows idle servers from config', () => {
    useAppStore.setState({
      mcpServers: [],
      mcpServerConfigs: [
        { name: 'idle-server', type: 'stdio', command: 'echo', enabled: true },
      ],
    });

    render(<McpServersPanel />);

    expect(screen.getByText('idle-server')).toBeInTheDocument();
    expect(screen.getByText('Idle')).toBeInTheDocument();
  });

  it('shows disabled servers with toggle off', () => {
    useAppStore.setState({
      mcpServers: [],
      mcpServerConfigs: [
        { name: 'disabled-server', type: 'stdio', command: 'echo', enabled: false },
      ],
    });

    render(<McpServersPanel />);

    // Disabled servers still appear in unified view (with toggle switch off)
    expect(screen.getByText('disabled-server')).toBeInTheDocument();
  });

  // --------------------------------------------------------------------------
  // Tool counts
  // --------------------------------------------------------------------------

  it('shows tool count for connected servers', () => {
    useAppStore.setState({
      mcpServers: [{ name: 'github', status: 'connected' }],
      mcpToolsByServer: {
        github: ['list_issues', 'create_pr', 'get_repo'],
      },
    });

    render(<McpServersPanel />);

    expect(screen.getByText('github')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  // --------------------------------------------------------------------------
  // Edit controls only for ChatML servers
  // --------------------------------------------------------------------------

  it('shows edit controls for ChatML-managed servers', () => {
    useAppStore.setState({
      mcpServers: [{ name: 'my-server', status: 'connected' }],
      mcpServerConfigs: [
        { name: 'my-server', type: 'stdio', command: 'npx', enabled: true },
      ],
      mcpServerSources: { 'my-server': 'chatml' },
    });

    render(<McpServersPanel />);

    // ChatML servers should have a toggle switch
    expect(screen.getByRole('switch')).toBeInTheDocument();
  });

  it('does not show edit controls for external servers', () => {
    useAppStore.setState({
      mcpServers: [{ name: 'chatml', status: 'connected' }],
      mcpServerSources: { chatml: 'builtin' },
    });

    render(<McpServersPanel />);

    // Built-in servers should not have edit controls
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
  });

  // --------------------------------------------------------------------------
  // Fetch on mount
  // --------------------------------------------------------------------------

  it('fetches configs on mount', () => {
    render(<McpServersPanel />);

    expect(fetchMcpServerConfigsMock).toHaveBeenCalledWith('ws-1');
  });

  it('does not fetch configs when no workspace selected', () => {
    useAppStore.setState({ selectedWorkspaceId: null });

    render(<McpServersPanel />);

    expect(fetchMcpServerConfigsMock).not.toHaveBeenCalled();
  });
});
