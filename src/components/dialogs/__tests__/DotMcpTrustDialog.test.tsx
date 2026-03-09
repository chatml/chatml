import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DotMcpTrustDialog } from '../DotMcpTrustDialog';
import type { DotMcpServerInfo } from '@/lib/api';

const defaultProps = {
  open: true,
  onOpenChange: vi.fn(),
  workspaceName: 'My Project',
  servers: [] as DotMcpServerInfo[],
  onAllow: vi.fn(),
  onDeny: vi.fn(),
};

describe('DotMcpTrustDialog', () => {
  it('renders title and workspace name', () => {
    render(<DotMcpTrustDialog {...defaultProps} />);

    expect(screen.getByText('Project MCP servers detected')).toBeInTheDocument();
    expect(screen.getByText('My Project')).toBeInTheDocument();
  });

  it('renders Allow and Deny buttons', () => {
    render(<DotMcpTrustDialog {...defaultProps} />);

    expect(screen.getByRole('button', { name: 'Allow' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Deny' })).toBeInTheDocument();
  });

  it('displays stdio server with command', () => {
    const servers: DotMcpServerInfo[] = [
      { name: 'test-server', type: 'stdio', command: 'npx -y @mcp/test', source: 'dot-mcp' },
    ];

    render(<DotMcpTrustDialog {...defaultProps} servers={servers} />);

    expect(screen.getByText('test-server')).toBeInTheDocument();
    expect(screen.getByText('stdio')).toBeInTheDocument();
    expect(screen.getByText('npx -y @mcp/test')).toBeInTheDocument();
  });

  it('displays SSE server without command', () => {
    const servers: DotMcpServerInfo[] = [
      { name: 'sse-server', type: 'sse', source: 'dot-mcp' },
    ];

    render(<DotMcpTrustDialog {...defaultProps} servers={servers} />);

    expect(screen.getByText('sse-server')).toBeInTheDocument();
    expect(screen.getByText('sse')).toBeInTheDocument();
  });

  it('displays multiple servers', () => {
    const servers: DotMcpServerInfo[] = [
      { name: 'server-a', type: 'stdio', command: 'echo', source: 'dot-mcp' },
      { name: 'server-b', type: 'http', source: 'dot-mcp' },
    ];

    render(<DotMcpTrustDialog {...defaultProps} servers={servers} />);

    expect(screen.getByText('server-a')).toBeInTheDocument();
    expect(screen.getByText('server-b')).toBeInTheDocument();
  });

  it('shows warning when stdio servers are present', () => {
    const servers: DotMcpServerInfo[] = [
      { name: 'cmd-server', type: 'stdio', command: 'rm -rf /', source: 'dot-mcp' },
    ];

    render(<DotMcpTrustDialog {...defaultProps} servers={servers} />);

    expect(screen.getByText(/run shell commands/i)).toBeInTheDocument();
    expect(screen.getByText(/trust the repository/i)).toBeInTheDocument();
  });

  it('does not show stdio warning when only non-stdio servers', () => {
    const servers: DotMcpServerInfo[] = [
      { name: 'safe-server', type: 'sse', source: 'dot-mcp' },
    ];

    render(<DotMcpTrustDialog {...defaultProps} servers={servers} />);

    expect(screen.queryByText(/run shell commands/i)).not.toBeInTheDocument();
  });

  it('calls onAllow when Allow is clicked', async () => {
    const onAllow = vi.fn();
    const user = userEvent.setup();

    render(<DotMcpTrustDialog {...defaultProps} onAllow={onAllow} />);

    await user.click(screen.getByRole('button', { name: 'Allow' }));
    expect(onAllow).toHaveBeenCalledOnce();
  });

  it('calls onDeny when Deny is clicked', async () => {
    const onDeny = vi.fn();
    const user = userEvent.setup();

    render(<DotMcpTrustDialog {...defaultProps} onDeny={onDeny} />);

    await user.click(screen.getByRole('button', { name: 'Deny' }));
    expect(onDeny).toHaveBeenCalledOnce();
  });

  it('does not render when open is false', () => {
    render(<DotMcpTrustDialog {...defaultProps} open={false} />);

    expect(screen.queryByText('Project MCP servers detected')).not.toBeInTheDocument();
  });

  it('mentions .mcp.json in description', () => {
    render(<DotMcpTrustDialog {...defaultProps} />);

    expect(screen.getByText('.mcp.json')).toBeInTheDocument();
  });

  it('shows source badges for servers from different configs', () => {
    const servers: DotMcpServerInfo[] = [
      { name: 'mcp-server', type: 'stdio', command: 'echo', source: 'dot-mcp' },
      { name: 'claude-server', type: 'sse', source: 'claude-cli-project' },
    ];

    render(<DotMcpTrustDialog {...defaultProps} servers={servers} />);

    // Source badges should show the config file origin
    // .mcp.json appears in description and badge; .claude/settings.json in description and badge
    expect(screen.getAllByText('.mcp.json').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('.claude/settings.json').length).toBeGreaterThanOrEqual(1);
  });
});
