import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
  // Configure toggle
  // --------------------------------------------------------------------------

  it('shows Configure button', () => {
    render(<McpServersPanel />);
    expect(screen.getByText('Configure')).toBeInTheDocument();
  });

  it('toggles to config view', async () => {
    const user = userEvent.setup();
    render(<McpServersPanel />);

    await user.click(screen.getByText('Configure'));

    expect(screen.getByText('No MCP servers configured')).toBeInTheDocument();
  });

  it('shows configured servers in config view', async () => {
    useAppStore.setState({
      mcpServerConfigs: [
        { name: 'my-server', type: 'stdio', command: 'npx', enabled: true },
      ],
    });

    const user = userEvent.setup();
    render(<McpServersPanel />);

    await user.click(screen.getByText('Configure'));

    expect(screen.getByText('my-server')).toBeInTheDocument();
    expect(screen.getByText('npx')).toBeInTheDocument();
  });

  // --------------------------------------------------------------------------
  // Idle servers in status view
  // --------------------------------------------------------------------------

  it('shows idle servers in status view', () => {
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

  it('disabled servers not shown as idle', () => {
    useAppStore.setState({
      mcpServers: [],
      mcpServerConfigs: [
        { name: 'disabled-server', type: 'stdio', command: 'echo', enabled: false },
      ],
    });

    render(<McpServersPanel />);

    // Disabled servers should not appear in the status view
    expect(screen.queryByText('disabled-server')).not.toBeInTheDocument();
    expect(screen.queryByText('Idle')).not.toBeInTheDocument();
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
