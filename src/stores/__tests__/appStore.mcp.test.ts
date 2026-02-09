import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { useAppStore } from '../appStore';

// Mock the API module used by fetchMcpServerConfigs and saveMcpServerConfigs
const mockGetMcpServers = vi.fn();
const mockSetMcpServers = vi.fn();

vi.mock('@/lib/api', () => ({
  getMcpServers: (...args: unknown[]) => mockGetMcpServers(...args),
  setMcpServers: (...args: unknown[]) => mockSetMcpServers(...args),
}));

describe('appStore - MCP servers', () => {
  beforeEach(() => {
    useAppStore.setState({
      mcpServers: [],
      mcpServerConfigs: [],
      mcpConfigLoading: false,
      mcpToolsByServer: {},
    });
    mockGetMcpServers.mockReset();
    mockSetMcpServers.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // =========================================================================
  // Initial state
  // =========================================================================

  it('has correct initial MCP state', () => {
    const state = useAppStore.getState();
    expect(state.mcpServers).toEqual([]);
    expect(state.mcpServerConfigs).toEqual([]);
    expect(state.mcpConfigLoading).toBe(false);
    expect(state.mcpToolsByServer).toEqual({});
  });

  // =========================================================================
  // setMcpServers
  // =========================================================================

  it('setMcpServers sets array of McpServerStatus objects', () => {
    useAppStore.getState().setMcpServers([
      { name: 'github', status: 'connected' },
      { name: 'filesystem', status: 'failed' },
    ]);

    const state = useAppStore.getState();
    expect(state.mcpServers).toEqual([
      { name: 'github', status: 'connected' },
      { name: 'filesystem', status: 'failed' },
    ]);
  });

  it('setMcpServers overwrites previous value', () => {
    useAppStore.getState().setMcpServers([
      { name: 'first-server', status: 'connected' },
    ]);

    useAppStore.getState().setMcpServers([
      { name: 'second-server', status: 'pending' },
    ]);

    const state = useAppStore.getState();
    expect(state.mcpServers).toHaveLength(1);
    expect(state.mcpServers[0].name).toBe('second-server');
    expect(state.mcpServers[0].status).toBe('pending');
  });

  it('setMcpServers with empty array clears servers', () => {
    useAppStore.getState().setMcpServers([
      { name: 'server-a', status: 'connected' },
    ]);

    useAppStore.getState().setMcpServers([]);

    expect(useAppStore.getState().mcpServers).toEqual([]);
  });

  // =========================================================================
  // setMcpToolsByServer
  // =========================================================================

  it('setMcpToolsByServer sets tools map', () => {
    const toolsMap = {
      github: ['list_issues', 'create_pr'],
      filesystem: ['read_file'],
    };

    useAppStore.getState().setMcpToolsByServer(toolsMap);

    const state = useAppStore.getState();
    expect(state.mcpToolsByServer).toEqual({
      github: ['list_issues', 'create_pr'],
      filesystem: ['read_file'],
    });
  });

  it('setMcpToolsByServer overwrites previous value', () => {
    useAppStore.getState().setMcpToolsByServer({
      github: ['list_issues'],
    });

    useAppStore.getState().setMcpToolsByServer({
      slack: ['send_message', 'read_channel'],
    });

    const state = useAppStore.getState();
    expect(state.mcpToolsByServer).toEqual({
      slack: ['send_message', 'read_channel'],
    });
    expect(state.mcpToolsByServer.github).toBeUndefined();
  });

  it('setMcpToolsByServer with empty object clears tools', () => {
    useAppStore.getState().setMcpToolsByServer({
      github: ['list_issues'],
    });

    useAppStore.getState().setMcpToolsByServer({});

    expect(useAppStore.getState().mcpToolsByServer).toEqual({});
  });

  // =========================================================================
  // fetchMcpServerConfigs
  // =========================================================================

  it('fetchMcpServerConfigs sets loading then data', async () => {
    const mockConfigs = [
      { name: 'test-server', type: 'stdio' as const, command: 'echo', enabled: true },
      { name: 'http-server', type: 'http' as const, url: 'http://localhost:3000', enabled: false },
    ];
    mockGetMcpServers.mockResolvedValue(mockConfigs);

    const promise = useAppStore.getState().fetchMcpServerConfigs('workspace-1');

    // Loading should be true while the request is in flight
    expect(useAppStore.getState().mcpConfigLoading).toBe(true);

    await promise;

    const state = useAppStore.getState();
    expect(state.mcpConfigLoading).toBe(false);
    expect(state.mcpServerConfigs).toEqual(mockConfigs);
    expect(mockGetMcpServers).toHaveBeenCalledWith('workspace-1');
  });

  it('fetchMcpServerConfigs handles error', async () => {
    mockGetMcpServers.mockRejectedValue(new Error('Network error'));

    await useAppStore.getState().fetchMcpServerConfigs('workspace-1');

    const state = useAppStore.getState();
    expect(state.mcpConfigLoading).toBe(false);
    expect(state.mcpServerConfigs).toEqual([]);
  });

  // =========================================================================
  // saveMcpServerConfigs
  // =========================================================================

  it('saveMcpServerConfigs updates configs', async () => {
    const configsToSave = [
      { name: 'saved-server', type: 'stdio' as const, command: 'node', args: ['server.js'], enabled: true },
    ];
    const savedConfigs = [
      { name: 'saved-server', type: 'stdio' as const, command: 'node', args: ['server.js'], enabled: true },
    ];
    mockSetMcpServers.mockResolvedValue(savedConfigs);

    await useAppStore.getState().saveMcpServerConfigs('workspace-1', configsToSave);

    const state = useAppStore.getState();
    expect(state.mcpConfigLoading).toBe(false);
    expect(state.mcpServerConfigs).toEqual(savedConfigs);
    expect(mockSetMcpServers).toHaveBeenCalledWith('workspace-1', configsToSave);
  });
});
