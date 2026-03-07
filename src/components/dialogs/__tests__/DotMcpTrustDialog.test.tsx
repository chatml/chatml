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

    expect(screen.getByText('Workspace MCP servers detected')).toBeInTheDocument();
    expect(screen.getByText('My Project')).toBeInTheDocument();
  });

  it('renders Allow and Deny buttons', () => {
    render(<DotMcpTrustDialog {...defaultProps} />);

    expect(screen.getByRole('button', { name: 'Allow' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Deny' })).toBeInTheDocument();
  });

  it('displays stdio server with command', () => {
    const servers: DotMcpServerInfo[] = [
      { name: 'test-server', type: 'stdio', command: 'npx -y @mcp/test' },
    ];

    render(<DotMcpTrustDialog {...defaultProps} servers={servers} />);

    expect(screen.getByText('test-server')).toBeInTheDocument();
    expect(screen.getByText('stdio')).toBeInTheDocument();
    expect(screen.getByText('npx -y @mcp/test')).toBeInTheDocument();
  });

  it('displays SSE server without command', () => {
    const servers: DotMcpServerInfo[] = [
      { name: 'sse-server', type: 'sse' },
    ];

    render(<DotMcpTrustDialog {...defaultProps} servers={servers} />);

    expect(screen.getByText('sse-server')).toBeInTheDocument();
    expect(screen.getByText('sse')).toBeInTheDocument();
  });

  it('displays multiple servers', () => {
    const servers: DotMcpServerInfo[] = [
      { name: 'server-a', type: 'stdio', command: 'echo' },
      { name: 'server-b', type: 'http' },
    ];

    render(<DotMcpTrustDialog {...defaultProps} servers={servers} />);

    expect(screen.getByText('server-a')).toBeInTheDocument();
    expect(screen.getByText('server-b')).toBeInTheDocument();
  });

  it('shows warning when stdio servers are present', () => {
    const servers: DotMcpServerInfo[] = [
      { name: 'cmd-server', type: 'stdio', command: 'rm -rf /' },
    ];

    render(<DotMcpTrustDialog {...defaultProps} servers={servers} />);

    expect(screen.getByText(/run shell commands/i)).toBeInTheDocument();
    expect(screen.getByText(/trust the repository/i)).toBeInTheDocument();
  });

  it('does not show stdio warning when only non-stdio servers', () => {
    const servers: DotMcpServerInfo[] = [
      { name: 'safe-server', type: 'sse' },
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

    expect(screen.queryByText('Workspace MCP servers detected')).not.toBeInTheDocument();
  });

  it('mentions .mcp.json in description', () => {
    render(<DotMcpTrustDialog {...defaultProps} />);

    expect(screen.getByText('.mcp.json')).toBeInTheDocument();
  });
});
