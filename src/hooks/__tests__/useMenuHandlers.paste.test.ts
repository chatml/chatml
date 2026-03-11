import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { readText, readImage } from '@tauri-apps/plugin-clipboard-manager';

// ---- Mocks ----

let menuEventHandler: ((payload: string) => void) | null = null;

vi.mock('@/lib/tauri', () => ({
  safeListen: vi.fn((_event: string, handler: (payload: string) => void) => {
    menuEventHandler = handler;
    return Promise.resolve(() => { menuEventHandler = null; });
  }),
  isTauri: vi.fn().mockReturnValue(true),
  openInVSCode: vi.fn(),
  copyToClipboard: vi.fn(),
  openUrlInBrowser: vi.fn(),
  getCurrentWindow: vi.fn().mockResolvedValue(null),
}));

vi.mock('next-themes', () => ({
  useTheme: vi.fn().mockReturnValue({ resolvedTheme: 'dark', setTheme: vi.fn() }),
}));

vi.mock('@/components/ui/toast', () => ({
  useToast: vi.fn().mockReturnValue({ info: vi.fn(), error: vi.fn() }),
}));

vi.mock('@/stores/appStore', () => ({
  useAppStore: Object.assign(vi.fn().mockReturnValue({}), {
    getState: vi.fn().mockReturnValue({ selectedSessionId: null, sessions: [] }),
    subscribe: vi.fn().mockReturnValue(() => {}),
  }),
}));

vi.mock('@/stores/settingsStore', () => ({
  useSettingsStore: Object.assign(vi.fn(), {
    getState: vi.fn().mockReturnValue({
      setDefaultThinkingLevel: vi.fn(),
      setContentView: vi.fn(),
    }),
  }),
}));

vi.mock('@/stores/updateStore', () => ({
  useUpdateStore: Object.assign(vi.fn(), {
    getState: vi.fn().mockReturnValue({ checkForUpdates: vi.fn().mockResolvedValue('up-to-date') }),
  }),
}));

vi.mock('@/stores/navigationStore', () => ({
  useNavigationStore: Object.assign(vi.fn(), {
    getState: vi.fn().mockReturnValue({ goBack: vi.fn(), goForward: vi.fn() }),
  }),
}));

vi.mock('@/stores/tabStore', () => ({
  useTabStore: Object.assign(vi.fn(), {
    getState: vi.fn().mockReturnValue({ tabOrder: [], activeTabId: '1', closeTab: vi.fn() }),
  }),
}));

vi.mock('@/lib/constants', () => ({
  ENABLE_BROWSER_TABS: false,
}));

vi.mock('@/components/navigation/BrowserTabBar', () => ({
  switchToTab: vi.fn(),
}));

vi.mock('@/hooks/useClaudeAuthStatus', () => ({
  refreshClaudeAuthStatus: vi.fn(),
}));

import { useMenuHandlers } from '../useMenuHandlers';

const mockedReadText = vi.mocked(readText);
const mockedReadImage = vi.mocked(readImage);

function makeOptions() {
  return {
    handleNewSession: vi.fn(),
    handleNewConversation: vi.fn(),
    handleCloseTab: vi.fn(),
    handleCloseFileTab: vi.fn(),
    saveCurrentTab: vi.fn(),
    toggleLeftSidebar: vi.fn(),
    toggleRightSidebar: vi.fn(),
    toggleBottomTerminal: vi.fn(),
    expandBottomTerminal: vi.fn(),
    selectNextTab: vi.fn(),
    selectPreviousTab: vi.fn(),
    setZenMode: vi.fn(),
    zenModeRef: { current: false },
    resetLayouts: vi.fn(),
    onOpenSettings: vi.fn(),
    onCloseSettings: vi.fn(),
    onShowAddWorkspace: vi.fn(),
    onShowCreateFromPR: vi.fn(),
    onShowShortcuts: vi.fn(),
    onShowBottomTerminal: vi.fn(),
  };
}

describe('useMenuHandlers — edit_paste', () => {
  const originalExecCommand = document.execCommand;

  beforeEach(() => {
    vi.clearAllMocks();
    menuEventHandler = null;
    // jsdom doesn't define execCommand — add it as a mock
    document.execCommand = vi.fn().mockReturnValue(true);
    // jsdom doesn't implement canvas — mock getContext and toDataURL
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      putImageData: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,mockBase64Data');
    // jsdom doesn't define ImageData — polyfill it
    if (typeof globalThis.ImageData === 'undefined') {
      (globalThis as Record<string, unknown>).ImageData = class ImageData {
        data: Uint8ClampedArray;
        width: number;
        height: number;
        constructor(data: Uint8ClampedArray, width: number, height?: number) {
          this.data = data;
          this.width = width;
          this.height = height ?? (data.length / (4 * width));
        }
      };
    }
  });

  afterEach(() => {
    document.execCommand = originalExecCommand;
    vi.restoreAllMocks();
  });

  function setupHook() {
    renderHook(() => useMenuHandlers(makeOptions()));
  }

  it('pastes text via execCommand when clipboard has text', async () => {
    mockedReadText.mockResolvedValue('hello world');
    setupHook();
    expect(menuEventHandler).toBeTruthy();

    menuEventHandler!('edit_paste');
    // Wait for async handler
    await vi.waitFor(() => {
      expect(document.execCommand).toHaveBeenCalledWith('insertText', false, 'hello world');
    });
  });

  it('does not attempt image paste when text is available', async () => {
    mockedReadText.mockResolvedValue('some text');
    setupHook();

    menuEventHandler!('edit_paste');
    await vi.waitFor(() => {
      expect(document.execCommand).toHaveBeenCalled();
    });
    expect(mockedReadImage).not.toHaveBeenCalled();
  });

  it('attempts image paste when clipboard has no text', async () => {
    mockedReadText.mockResolvedValue('');

    const mockRgba = new Uint8Array(4 * 2 * 2); // 2x2 RGBA
    const mockImage = {
      size: vi.fn().mockResolvedValue({ width: 2, height: 2 }),
      rgba: vi.fn().mockResolvedValue(mockRgba),
    };
    mockedReadImage.mockResolvedValue(mockImage as never);

    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');
    setupHook();

    menuEventHandler!('edit_paste');
    await vi.waitFor(() => {
      expect(dispatchSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'clipboard-paste-image',
        })
      );
    });

    const event = dispatchSpy.mock.calls.find(
      (call) => (call[0] as CustomEvent).type === 'clipboard-paste-image'
    )![0] as CustomEvent;

    expect(event.detail).toMatchObject({
      width: 2,
      height: 2,
      mimeType: 'image/png',
    });
    expect(event.detail.base64).toBeTruthy();
    expect(typeof event.detail.size).toBe('number');

    dispatchSpy.mockRestore();
  });

  it('does not crash when both text and image fail', async () => {
    mockedReadText.mockRejectedValue(new Error('no text'));
    mockedReadImage.mockRejectedValue(new Error('no image'));

    setupHook();

    // Should not throw
    menuEventHandler!('edit_paste');
    await vi.waitFor(() => {
      expect(mockedReadImage).toHaveBeenCalled();
    });
  });

  it('uses img.size() to get dimensions (not direct properties)', async () => {
    mockedReadText.mockResolvedValue('');

    const sizeFn = vi.fn().mockResolvedValue({ width: 100, height: 50 });
    const mockImage = {
      size: sizeFn,
      rgba: vi.fn().mockResolvedValue(new Uint8Array(4 * 100 * 50)),
    };
    mockedReadImage.mockResolvedValue(mockImage as never);

    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');
    setupHook();

    menuEventHandler!('edit_paste');
    await vi.waitFor(() => {
      expect(sizeFn).toHaveBeenCalled();
    });

    const event = dispatchSpy.mock.calls.find(
      (call) => (call[0] as CustomEvent).type === 'clipboard-paste-image'
    )![0] as CustomEvent;

    expect(event.detail.width).toBe(100);
    expect(event.detail.height).toBe(50);

    dispatchSpy.mockRestore();
  });

  it('falls back to image when readText returns empty string', async () => {
    mockedReadText.mockResolvedValue('');
    const mockImage = {
      size: vi.fn().mockResolvedValue({ width: 1, height: 1 }),
      rgba: vi.fn().mockResolvedValue(new Uint8Array(4)),
    };
    mockedReadImage.mockResolvedValue(mockImage as never);

    setupHook();
    menuEventHandler!('edit_paste');

    await vi.waitFor(() => {
      expect(mockedReadImage).toHaveBeenCalled();
    });
  });

  it('falls back to image when readText rejects', async () => {
    mockedReadText.mockRejectedValue(new Error('clipboard error'));
    const mockImage = {
      size: vi.fn().mockResolvedValue({ width: 1, height: 1 }),
      rgba: vi.fn().mockResolvedValue(new Uint8Array(4)),
    };
    mockedReadImage.mockResolvedValue(mockImage as never);

    setupHook();
    menuEventHandler!('edit_paste');

    await vi.waitFor(() => {
      expect(mockedReadImage).toHaveBeenCalled();
    });
  });
});
