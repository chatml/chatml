import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useSettingsStore } from '@/stores/settingsStore';

// ---- Mocks ----

const mockGetDotMcpInfo = vi.fn();
const mockGetDotMcpTrust = vi.fn();

vi.mock('@/lib/api', () => ({
  getDotMcpInfo: (...args: unknown[]) => mockGetDotMcpInfo(...args),
  getDotMcpTrust: (...args: unknown[]) => mockGetDotMcpTrust(...args),
}));

import { useDotMcpTrustCheck } from '../useDotMcpTrustCheck';
import type { Workspace } from '@/lib/types';

const mockWorkspaces: Workspace[] = [
  {
    id: 'ws-1',
    name: 'My Project',
    path: '/tmp/my-project',
    defaultBranch: 'main',
    remote: 'origin',
    branchPrefix: 'github',
    customPrefix: '',
    createdAt: new Date().toISOString(),
  },
];

const mockShowDotMcpTrust = vi.fn();
const mockDialogRef = {
  current: {
    openSettings: vi.fn(),
    closeSettings: vi.fn(),
    showAddWorkspace: vi.fn(),
    showCreateFromPR: vi.fn(),
    showCloneFromUrl: vi.fn(),
    showGitHubRepos: vi.fn(),
    showShortcuts: vi.fn(),
    openWorkspaceSettings: vi.fn(),
    showDotMcpTrust: mockShowDotMcpTrust,
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  useSettingsStore.setState({ neverLoadDotMcp: false });
});

describe('useDotMcpTrustCheck', () => {
  it('shows trust dialog when .mcp.json exists and trust is unknown', async () => {
    mockGetDotMcpInfo.mockResolvedValue({
      exists: true,
      servers: [{ name: 'test', type: 'stdio', command: 'echo' }],
    });
    mockGetDotMcpTrust.mockResolvedValue({ status: 'unknown' });

    renderHook(() =>
      useDotMcpTrustCheck(mockWorkspaces, 'ws-1', mockDialogRef)
    );

    await waitFor(() => {
      expect(mockShowDotMcpTrust).toHaveBeenCalledWith(
        'ws-1',
        'My Project',
        [{ name: 'test', type: 'stdio', command: 'echo' }]
      );
    });
  });

  it('does not show dialog when no .mcp.json exists', async () => {
    mockGetDotMcpInfo.mockResolvedValue({ exists: false, servers: [] });

    renderHook(() =>
      useDotMcpTrustCheck(mockWorkspaces, 'ws-1', mockDialogRef)
    );

    await waitFor(() => {
      expect(mockGetDotMcpInfo).toHaveBeenCalledWith('ws-1');
    });

    expect(mockGetDotMcpTrust).not.toHaveBeenCalled();
    expect(mockShowDotMcpTrust).not.toHaveBeenCalled();
  });

  it('does not show dialog when trust is already trusted', async () => {
    mockGetDotMcpInfo.mockResolvedValue({
      exists: true,
      servers: [{ name: 'test', type: 'stdio', command: 'echo' }],
    });
    mockGetDotMcpTrust.mockResolvedValue({ status: 'trusted' });

    renderHook(() =>
      useDotMcpTrustCheck(mockWorkspaces, 'ws-1', mockDialogRef)
    );

    await waitFor(() => {
      expect(mockGetDotMcpTrust).toHaveBeenCalledWith('ws-1');
    });

    expect(mockShowDotMcpTrust).not.toHaveBeenCalled();
  });

  it('does not show dialog when trust is already denied', async () => {
    mockGetDotMcpInfo.mockResolvedValue({
      exists: true,
      servers: [{ name: 'test', type: 'stdio', command: 'echo' }],
    });
    mockGetDotMcpTrust.mockResolvedValue({ status: 'denied' });

    renderHook(() =>
      useDotMcpTrustCheck(mockWorkspaces, 'ws-1', mockDialogRef)
    );

    await waitFor(() => {
      expect(mockGetDotMcpTrust).toHaveBeenCalledWith('ws-1');
    });

    expect(mockShowDotMcpTrust).not.toHaveBeenCalled();
  });

  it('does not check when neverLoadDotMcp is true', async () => {
    useSettingsStore.setState({ neverLoadDotMcp: true });

    renderHook(() =>
      useDotMcpTrustCheck(mockWorkspaces, 'ws-1', mockDialogRef)
    );

    // Give time for any async operations
    await new Promise((r) => setTimeout(r, 50));

    expect(mockGetDotMcpInfo).not.toHaveBeenCalled();
    expect(mockShowDotMcpTrust).not.toHaveBeenCalled();
  });

  it('does not check when workspaceId is null', async () => {
    renderHook(() =>
      useDotMcpTrustCheck(mockWorkspaces, null, mockDialogRef)
    );

    await new Promise((r) => setTimeout(r, 50));

    expect(mockGetDotMcpInfo).not.toHaveBeenCalled();
  });

  it('only checks each workspace once per mount', async () => {
    mockGetDotMcpInfo.mockResolvedValue({ exists: false, servers: [] });

    const { rerender } = renderHook(
      ({ wsId }) => useDotMcpTrustCheck(mockWorkspaces, wsId, mockDialogRef),
      { initialProps: { wsId: 'ws-1' as string | null } }
    );

    await waitFor(() => {
      expect(mockGetDotMcpInfo).toHaveBeenCalledTimes(1);
    });

    // Re-render with same workspace — should not check again
    rerender({ wsId: 'ws-1' });
    await new Promise((r) => setTimeout(r, 50));

    expect(mockGetDotMcpInfo).toHaveBeenCalledTimes(1);
  });

  it('does not show dialog when servers list is empty', async () => {
    mockGetDotMcpInfo.mockResolvedValue({ exists: true, servers: [] });

    renderHook(() =>
      useDotMcpTrustCheck(mockWorkspaces, 'ws-1', mockDialogRef)
    );

    await waitFor(() => {
      expect(mockGetDotMcpInfo).toHaveBeenCalledWith('ws-1');
    });

    expect(mockGetDotMcpTrust).not.toHaveBeenCalled();
    expect(mockShowDotMcpTrust).not.toHaveBeenCalled();
  });

  it('handles API errors gracefully', async () => {
    mockGetDotMcpInfo.mockRejectedValue(new Error('Network error'));

    renderHook(() =>
      useDotMcpTrustCheck(mockWorkspaces, 'ws-1', mockDialogRef)
    );

    // Should not throw or show dialog
    await new Promise((r) => setTimeout(r, 50));

    expect(mockShowDotMcpTrust).not.toHaveBeenCalled();
  });

  it('falls back to unknown workspace name when not found', async () => {
    mockGetDotMcpInfo.mockResolvedValue({
      exists: true,
      servers: [{ name: 'test', type: 'stdio', command: 'echo' }],
    });
    mockGetDotMcpTrust.mockResolvedValue({ status: 'unknown' });

    // Use a workspace ID not in the workspaces array
    renderHook(() =>
      useDotMcpTrustCheck([], 'ws-unknown', mockDialogRef)
    );

    await waitFor(() => {
      expect(mockShowDotMcpTrust).toHaveBeenCalledWith(
        'ws-unknown',
        'Unknown workspace',
        expect.any(Array)
      );
    });
  });
});
