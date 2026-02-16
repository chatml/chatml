import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useFileWatcher } from '../useFileWatcher';
import { useAppStore } from '@/stores/appStore';
import type { FileChangedEvent } from '@/lib/tauri';
import type { FileTab } from '@/lib/types';

// ---- Mocks ----

vi.mock('@/lib/tauri', () => ({
  startFileWatcher: vi.fn(),
  stopFileWatcher: vi.fn(),
  listenForFileChanges: vi.fn(),
  sendNotification: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  getWorkspacesBasePath: vi.fn(),
  getRepoFileContent: vi.fn(),
}));

vi.mock('@/components/ui/toast', () => ({
  useToast: () => ({
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  }),
}));

import {
  startFileWatcher,
  stopFileWatcher,
  listenForFileChanges,
  sendNotification,
} from '@/lib/tauri';
import { getWorkspacesBasePath, getRepoFileContent } from '@/lib/api';

const mockedStartFileWatcher = vi.mocked(startFileWatcher);
const mockedStopFileWatcher = vi.mocked(stopFileWatcher);
const mockedListenForFileChanges = vi.mocked(listenForFileChanges);
const mockedSendNotification = vi.mocked(sendNotification);
const mockedGetWorkspacesBasePath = vi.mocked(getWorkspacesBasePath);
const mockedGetRepoFileContent = vi.mocked(getRepoFileContent);

function makeFileTab(overrides: Partial<FileTab> = {}): FileTab {
  return {
    id: 'tab-1',
    workspaceId: 'ws-1',
    sessionId: 'session-1',
    path: 'src/file.ts',
    name: 'file.ts',
    content: 'original',
    originalContent: 'original',
    isLoading: false,
    isDirty: false,
    viewMode: 'file',
    ...overrides,
  };
}

// Capture the callback passed to listenForFileChanges so we can trigger events
let capturedFileChangeHandler: ((event: FileChangedEvent) => void) | null = null;
const mockUnlisten = vi.fn();

describe('useFileWatcher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedFileChangeHandler = null;

    // Default mocks
    mockedGetWorkspacesBasePath.mockResolvedValue('/workspaces');
    mockedStartFileWatcher.mockResolvedValue(true);
    mockedStopFileWatcher.mockResolvedValue(undefined);
    mockedListenForFileChanges.mockImplementation(async (handler) => {
      capturedFileChangeHandler = handler;
      return mockUnlisten;
    });
    mockedGetRepoFileContent.mockResolvedValue({
      content: 'new content from disk',
      path: 'src/file.ts',
      language: 'typescript',
      size: 100,
      isBinary: false,
    });

    // Reset store
    useAppStore.setState({
      fileTabs: [],
      lastFileChange: null,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('starts global watcher on mount', async () => {
    const { unmount } = renderHook(() => useFileWatcher());

    // Let async initWatcher resolve
    await act(async () => {
      await (vi.dynamicImportSettled?.() ?? new Promise((r) => setTimeout(r, 0)));
    });

    expect(mockedGetWorkspacesBasePath).toHaveBeenCalled();
    expect(mockedStartFileWatcher).toHaveBeenCalledWith('/workspaces', true);

    unmount();
  });

  it('stops watcher on unmount', async () => {
    const { unmount } = renderHook(() => useFileWatcher());

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    unmount();

    expect(mockedStopFileWatcher).toHaveBeenCalled();
  });

  it('does not start watcher twice on re-render', async () => {
    const { rerender, unmount } = renderHook(() => useFileWatcher());

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    rerender();

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    // The mount effect only runs once (empty deps), so startFileWatcher should be called once
    expect(mockedStartFileWatcher).toHaveBeenCalledTimes(1);

    unmount();
  });

  it('handles getWorkspacesBasePath failure gracefully', async () => {
    mockedGetWorkspacesBasePath.mockRejectedValueOnce(new Error('API down'));

    const { unmount } = renderHook(() => useFileWatcher());

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(mockedStartFileWatcher).not.toHaveBeenCalled();

    unmount();
  });

  it('handles startFileWatcher returning false', async () => {
    mockedStartFileWatcher.mockResolvedValueOnce(false);

    const { unmount } = renderHook(() => useFileWatcher());

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    // Should not crash
    expect(mockedStartFileWatcher).toHaveBeenCalled();

    unmount();
  });

  it('registers Tauri event listener', async () => {
    const { unmount } = renderHook(() => useFileWatcher());

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(mockedListenForFileChanges).toHaveBeenCalledWith(expect.any(Function));

    unmount();
  });

  it('writes file change events to the store', async () => {
    renderHook(() => useFileWatcher());

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(capturedFileChangeHandler).toBeTruthy();

    // Simulate a file change event
    act(() => {
      capturedFileChangeHandler!({
        workspaceId: 'ws-1',
        path: 'src/changed.ts',
        fullPath: '/workspaces/ws-1/src/changed.ts',
      });
    });

    const lastChange = useAppStore.getState().lastFileChange;
    expect(lastChange).toBeTruthy();
    expect(lastChange!.workspaceId).toBe('ws-1');
    expect(lastChange!.path).toBe('src/changed.ts');
  });

  it('reloads open non-dirty tab on file change', async () => {
    const tab = makeFileTab({ isDirty: false });
    useAppStore.setState({ fileTabs: [tab] });

    renderHook(() => useFileWatcher());

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    // Trigger file change for the open tab's file
    await act(async () => {
      capturedFileChangeHandler!({
        workspaceId: 'ws-1',
        path: 'src/file.ts',
        fullPath: '/workspaces/ws-1/src/file.ts',
      });
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(mockedGetRepoFileContent).toHaveBeenCalledWith('ws-1', 'src/file.ts');
  });

  it('shows conflict warning for dirty tab instead of reloading', async () => {
    const dirtyTab = makeFileTab({ isDirty: true });
    useAppStore.setState({ fileTabs: [dirtyTab] });

    renderHook(() => useFileWatcher());

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    // Trigger file change for the dirty tab's file
    await act(async () => {
      capturedFileChangeHandler!({
        workspaceId: 'ws-1',
        path: 'src/file.ts',
        fullPath: '/workspaces/ws-1/src/file.ts',
      });
      await new Promise((r) => setTimeout(r, 0));
    });

    // Should NOT reload
    expect(mockedGetRepoFileContent).not.toHaveBeenCalled();
    // Should show notification
    expect(mockedSendNotification).toHaveBeenCalledWith(
      'file.ts changed on disk',
      expect.stringContaining('unsaved changes')
    );
  });

  it('ignores change for unopened files', async () => {
    // No tabs open
    useAppStore.setState({ fileTabs: [] });

    renderHook(() => useFileWatcher());

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    // Trigger file change for a file not open in any tab
    await act(async () => {
      capturedFileChangeHandler!({
        workspaceId: 'ws-1',
        path: 'src/other-file.ts',
        fullPath: '/workspaces/ws-1/src/other-file.ts',
      });
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(mockedGetRepoFileContent).not.toHaveBeenCalled();
    expect(mockedSendNotification).not.toHaveBeenCalled();
  });

  it('cleans up listener on unmount', async () => {
    const { unmount } = renderHook(() => useFileWatcher());

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    unmount();

    // Give the setTimeout(10) cleanup time to fire
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(mockUnlisten).toHaveBeenCalled();
  });
});
