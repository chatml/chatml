import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { FileNodeDTO } from '@/lib/api';
import type { FlatFile } from '../useFileMentions';

// ── Mocks ──────────────────────────────────────────────────────────────

vi.mock('@/lib/api', () => ({
  listSessionFiles: vi.fn(),
}));

import { listSessionFiles } from '@/lib/api';
import { useFileMentions } from '../useFileMentions';

const mockedListSessionFiles = vi.mocked(listSessionFiles);

// ── Test data ──────────────────────────────────────────────────────────

function makeFileTree(): FileNodeDTO[] {
  return [
    {
      name: 'src',
      path: 'src',
      isDir: true,
      children: [
        {
          name: 'index.ts',
          path: 'src/index.ts',
          isDir: false,
        },
        {
          name: 'utils',
          path: 'src/utils',
          isDir: true,
          children: [
            {
              name: 'helpers.ts',
              path: 'src/utils/helpers.ts',
              isDir: false,
            },
            {
              name: 'format.ts',
              path: 'src/utils/format.ts',
              isDir: false,
            },
          ],
        },
        {
          name: 'components',
          path: 'src/components',
          isDir: true,
          children: [
            {
              name: 'Button.tsx',
              path: 'src/components/Button.tsx',
              isDir: false,
            },
          ],
        },
      ],
    },
    {
      name: 'package.json',
      path: 'package.json',
      isDir: false,
    },
    {
      name: 'README.md',
      path: 'README.md',
      isDir: false,
    },
  ];
}

const defaultOptions = {
  workspaceId: 'ws-1',
  sessionId: 'session-1',
  onSelectFile: vi.fn(),
};

// ── Helpers ────────────────────────────────────────────────────────────

function makeKeyboardEvent(key: string): React.KeyboardEvent {
  return {
    key,
    preventDefault: vi.fn(),
  } as unknown as React.KeyboardEvent;
}

// ── Tests ──────────────────────────────────────────────────────────────

/** Flush microtasks so resolved promises and React state updates can complete. */
async function flushPromises() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

describe('useFileMentions', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mockedListSessionFiles.mockResolvedValue(makeFileTree());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // ── detectAtTrigger (tested through handleTextChange) ──────────────

  describe('@ trigger detection', () => {
    it('detects @ at the start of text', async () => {
      const { result } = renderHook(() => useFileMentions(defaultOptions));

      await act(async () => {
        result.current.handleTextChange('@', 1);
      });

      expect(result.current.isOpen).toBe(true);
      expect(result.current.query).toBe('');
    });

    it('detects @ after a space', async () => {
      const { result } = renderHook(() => useFileMentions(defaultOptions));

      await act(async () => {
        result.current.handleTextChange('hello @', 7);
      });

      expect(result.current.isOpen).toBe(true);
      expect(result.current.query).toBe('');
    });

    it('captures query text after @', async () => {
      const { result } = renderHook(() => useFileMentions(defaultOptions));

      await act(async () => {
        result.current.handleTextChange('@src', 4);
      });

      expect(result.current.isOpen).toBe(true);
      expect(result.current.query).toBe('src');
    });

    it('captures multi-character query after @', async () => {
      const { result } = renderHook(() => useFileMentions(defaultOptions));

      await act(async () => {
        result.current.handleTextChange('fix @helpers.ts', 15);
      });

      expect(result.current.isOpen).toBe(true);
      expect(result.current.query).toBe('helpers.ts');
    });

    it('does not trigger on email addresses', async () => {
      const { result } = renderHook(() => useFileMentions(defaultOptions));

      await act(async () => {
        result.current.handleTextChange('user@example.com', 16);
      });

      expect(result.current.isOpen).toBe(false);
    });

    it('does not trigger when @ is preceded by alphanumeric', async () => {
      const { result } = renderHook(() => useFileMentions(defaultOptions));

      await act(async () => {
        result.current.handleTextChange('test@file', 9);
      });

      expect(result.current.isOpen).toBe(false);
    });

    it('does not trigger when query contains space', async () => {
      const { result } = renderHook(() => useFileMentions(defaultOptions));

      // First activate the trigger
      await act(async () => {
        result.current.handleTextChange('@src file', 9);
      });

      // The query "src file" contains a space so it should dismiss
      expect(result.current.isOpen).toBe(false);
    });

    it('does not trigger with empty text', async () => {
      const { result } = renderHook(() => useFileMentions(defaultOptions));

      await act(async () => {
        result.current.handleTextChange('', 0);
      });

      expect(result.current.isOpen).toBe(false);
    });

    it('does not trigger with cursor at position 0', async () => {
      const { result } = renderHook(() => useFileMentions(defaultOptions));

      await act(async () => {
        result.current.handleTextChange('@test', 0);
      });

      expect(result.current.isOpen).toBe(false);
    });

    it('dismisses when @ trigger is no longer active', async () => {
      const { result } = renderHook(() => useFileMentions(defaultOptions));

      // Open the mention popup
      await act(async () => {
        result.current.handleTextChange('@src', 4);
      });
      expect(result.current.isOpen).toBe(true);

      // Type text that invalidates the trigger (adds space)
      await act(async () => {
        result.current.handleTextChange('@src file', 9);
      });
      expect(result.current.isOpen).toBe(false);
    });

    it('detects @ after newline-like whitespace', async () => {
      const { result } = renderHook(() => useFileMentions(defaultOptions));

      await act(async () => {
        result.current.handleTextChange('line1\n@test', 11);
      });

      expect(result.current.isOpen).toBe(true);
      expect(result.current.query).toBe('test');
    });
  });

  // ── flattenFileTree (tested through hook loading) ──────────────────

  describe('file tree flattening', () => {
    it('flattens nested file tree into flat list', async () => {
      const { result } = renderHook(() => useFileMentions(defaultOptions));

      await act(async () => {
        result.current.handleTextChange('@', 1);
        await vi.advanceTimersByTimeAsync(0);
      });

      const paths = result.current.files.map((f) => f.path);
      expect(paths).toContain('src/index.ts');
      expect(paths).toContain('src/utils/helpers.ts');
      expect(paths).toContain('src/utils/format.ts');
      expect(paths).toContain('src/components/Button.tsx');
      expect(paths).toContain('package.json');
      expect(paths).toContain('README.md');
    });

    it('excludes directories from flat list', async () => {
      const { result } = renderHook(() => useFileMentions(defaultOptions));

      await act(async () => {
        result.current.handleTextChange('@', 1);
        await vi.advanceTimersByTimeAsync(0);
      });

      const paths = result.current.files.map((f) => f.path);
      expect(paths).not.toContain('src');
      expect(paths).not.toContain('src/utils');
      expect(paths).not.toContain('src/components');
    });

    it('sets correct directory for nested files', async () => {
      const { result } = renderHook(() => useFileMentions(defaultOptions));

      await act(async () => {
        result.current.handleTextChange('@', 1);
        await vi.advanceTimersByTimeAsync(0);
      });

      const helpers = result.current.files.find(
        (f) => f.path === 'src/utils/helpers.ts'
      );
      expect(helpers).toBeDefined();
      expect(helpers!.directory).toBe('src/utils');
    });

    it('sets correct name for files', async () => {
      const { result } = renderHook(() => useFileMentions(defaultOptions));

      await act(async () => {
        result.current.handleTextChange('@', 1);
        await vi.advanceTimersByTimeAsync(0);
      });

      const indexFile = result.current.files.find(
        (f) => f.path === 'src/index.ts'
      );
      expect(indexFile).toBeDefined();
      expect(indexFile!.name).toBe('index.ts');
    });

    it('handles empty file tree', async () => {
      mockedListSessionFiles.mockResolvedValue([]);

      const { result } = renderHook(() => useFileMentions(defaultOptions));

      await act(async () => {
        result.current.handleTextChange('@', 1);
        await vi.advanceTimersByTimeAsync(0);
      });

      expect(result.current.files).toHaveLength(0);
    });

    it('handles directory with no children', async () => {
      mockedListSessionFiles.mockResolvedValue([
        { name: 'empty', path: 'empty', isDir: true },
      ]);

      const { result } = renderHook(() => useFileMentions(defaultOptions));

      await act(async () => {
        result.current.handleTextChange('@', 1);
        await vi.advanceTimersByTimeAsync(0);
      });

      expect(result.current.files).toHaveLength(0);
    });
  });

  // ── filterFiles (tested through hook query) ────────────────────────

  describe('file filtering', () => {
    it('shows all files (up to max) when query is empty', async () => {
      const { result } = renderHook(() => useFileMentions(defaultOptions));

      await act(async () => {
        result.current.handleTextChange('@', 1);
        await vi.advanceTimersByTimeAsync(0);
      });

      // All 6 files from the test tree
      expect(result.current.files).toHaveLength(6);
    });

    it('filters files by name', async () => {
      const { result } = renderHook(() => useFileMentions(defaultOptions));

      await act(async () => {
        result.current.handleTextChange('@helpers', 8);
        await vi.advanceTimersByTimeAsync(0);
      });

      expect(result.current.files).toHaveLength(1);
      expect(result.current.files[0].name).toBe('helpers.ts');
    });

    it('filters files by path', async () => {
      const { result } = renderHook(() => useFileMentions(defaultOptions));

      await act(async () => {
        result.current.handleTextChange('@utils/', 7);
        await vi.advanceTimersByTimeAsync(0);
      });

      const paths = result.current.files.map((f) => f.path);
      expect(paths).toContain('src/utils/helpers.ts');
      expect(paths).toContain('src/utils/format.ts');
      expect(paths).toHaveLength(2);
    });

    it('performs case-insensitive filtering', async () => {
      const { result } = renderHook(() => useFileMentions(defaultOptions));

      await act(async () => {
        result.current.handleTextChange('@BUTTON', 7);
        await vi.advanceTimersByTimeAsync(0);
      });

      expect(result.current.files).toHaveLength(1);
      expect(result.current.files[0].name).toBe('Button.tsx');
    });

    it('returns empty results when query matches nothing', async () => {
      const { result } = renderHook(() => useFileMentions(defaultOptions));

      await act(async () => {
        result.current.handleTextChange('@zzzznonexistent', 16);
        await vi.advanceTimersByTimeAsync(0);
      });

      expect(result.current.files).toHaveLength(0);
    });

    it('limits results to MAX_FILE_RESULTS (50)', async () => {
      // Generate a tree with more than 50 files
      const manyFiles: FileNodeDTO[] = Array.from({ length: 60 }, (_, i) => ({
        name: `file${i}.ts`,
        path: `src/file${i}.ts`,
        isDir: false,
      }));
      mockedListSessionFiles.mockResolvedValue(manyFiles);

      const { result } = renderHook(() => useFileMentions(defaultOptions));

      await act(async () => {
        result.current.handleTextChange('@', 1);
        await vi.advanceTimersByTimeAsync(0);
      });

      expect(result.current.files).toHaveLength(50);
    });

    it('limits filtered results to 50', async () => {
      const manyFiles: FileNodeDTO[] = Array.from({ length: 60 }, (_, i) => ({
        name: `component${i}.ts`,
        path: `src/component${i}.ts`,
        isDir: false,
      }));
      mockedListSessionFiles.mockResolvedValue(manyFiles);

      const { result } = renderHook(() => useFileMentions(defaultOptions));

      await act(async () => {
        result.current.handleTextChange('@component', 10);
        await vi.advanceTimersByTimeAsync(0);
      });

      expect(result.current.files).toHaveLength(50);
    });

    it('matches partial file extensions', async () => {
      const { result } = renderHook(() => useFileMentions(defaultOptions));

      await act(async () => {
        result.current.handleTextChange('@.tsx', 5);
        await vi.advanceTimersByTimeAsync(0);
      });

      expect(result.current.files).toHaveLength(1);
      expect(result.current.files[0].name).toBe('Button.tsx');
    });
  });

  // ── Loading state ──────────────────────────────────────────────────

  describe('loading state', () => {
    it('sets isLoading while files are being fetched', async () => {
      let resolveFiles!: (value: FileNodeDTO[]) => void;
      mockedListSessionFiles.mockReturnValue(
        new Promise((resolve) => {
          resolveFiles = resolve;
        })
      );

      const { result } = renderHook(() => useFileMentions(defaultOptions));

      // Trigger file loading
      await act(async () => {
        result.current.handleTextChange('@', 1);
      });

      expect(result.current.isLoading).toBe(true);

      // Resolve the file loading
      await act(async () => {
        resolveFiles(makeFileTree());
      });

      expect(result.current.isLoading).toBe(false);
    });

    it('sets isLoading to false on error', async () => {
      mockedListSessionFiles.mockRejectedValue(new Error('Network error'));
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const { result } = renderHook(() => useFileMentions(defaultOptions));

      await act(async () => {
        result.current.handleTextChange('@', 1);
        await vi.advanceTimersByTimeAsync(0);
      });

      expect(result.current.isLoading).toBe(false);
      expect(result.current.files).toHaveLength(0);

      consoleSpy.mockRestore();
    });

    it('does not load files when workspaceId is null', async () => {
      const options = { ...defaultOptions, workspaceId: null };

      const { result } = renderHook(() => useFileMentions(options));

      await act(async () => {
        result.current.handleTextChange('@', 1);
        await vi.advanceTimersByTimeAsync(0);
      });

      expect(mockedListSessionFiles).not.toHaveBeenCalled();
    });

    it('does not load files when sessionId is null', async () => {
      const options = { ...defaultOptions, sessionId: null };

      const { result } = renderHook(() => useFileMentions(options));

      await act(async () => {
        result.current.handleTextChange('@', 1);
        await vi.advanceTimersByTimeAsync(0);
      });

      expect(mockedListSessionFiles).not.toHaveBeenCalled();
    });
  });

  // ── Caching ────────────────────────────────────────────────────────

  describe('file caching', () => {
    it('only fetches files once per session', async () => {
      const { result } = renderHook(() => useFileMentions(defaultOptions));

      // First trigger
      await act(async () => {
        result.current.handleTextChange('@', 1);
        await vi.advanceTimersByTimeAsync(0);
      });

      // Dismiss
      act(() => {
        result.current.dismiss();
      });

      // Second trigger
      await act(async () => {
        result.current.handleTextChange('@', 1);
        await vi.advanceTimersByTimeAsync(0);
      });

      expect(mockedListSessionFiles).toHaveBeenCalledTimes(1);
    });

    it('clears cache when sessionId changes', async () => {
      const { result, rerender } = renderHook(
        (props) => useFileMentions(props),
        { initialProps: defaultOptions }
      );

      // First trigger
      await act(async () => {
        result.current.handleTextChange('@', 1);
        await vi.advanceTimersByTimeAsync(0);
      });

      expect(mockedListSessionFiles).toHaveBeenCalledTimes(1);

      // Dismiss and change session
      act(() => {
        result.current.dismiss();
      });

      rerender({ ...defaultOptions, sessionId: 'session-2' });

      // Trigger again with new session
      await act(async () => {
        result.current.handleTextChange('@', 1);
        await vi.advanceTimersByTimeAsync(0);
      });

      expect(mockedListSessionFiles).toHaveBeenCalledTimes(2);
    });

    it('clears cache when workspaceId changes', async () => {
      const { result, rerender } = renderHook(
        (props) => useFileMentions(props),
        { initialProps: defaultOptions }
      );

      // First trigger
      await act(async () => {
        result.current.handleTextChange('@', 1);
        await vi.advanceTimersByTimeAsync(0);
      });

      expect(mockedListSessionFiles).toHaveBeenCalledTimes(1);

      // Dismiss and change workspace
      act(() => {
        result.current.dismiss();
      });

      rerender({ ...defaultOptions, workspaceId: 'ws-2' });

      // Trigger again
      await act(async () => {
        result.current.handleTextChange('@', 1);
        await vi.advanceTimersByTimeAsync(0);
      });

      expect(mockedListSessionFiles).toHaveBeenCalledTimes(2);
    });
  });

  // ── Keyboard navigation ────────────────────────────────────────────

  describe('keyboard navigation', () => {
    async function openWithFiles() {
      const hookResult = renderHook(() => useFileMentions(defaultOptions));

      await act(async () => {
        hookResult.result.current.handleTextChange('@', 1);
        await vi.advanceTimersByTimeAsync(0);
      });

      return hookResult;
    }

    it('returns false when menu is not open', () => {
      const { result } = renderHook(() => useFileMentions(defaultOptions));

      const handled = result.current.handleKeyDown(makeKeyboardEvent('ArrowDown'));
      expect(handled).toBe(false);
    });

    it('moves selection down with ArrowDown', async () => {
      const { result } = await openWithFiles();
      expect(result.current.selectedIndex).toBe(0);

      act(() => {
        result.current.handleKeyDown(makeKeyboardEvent('ArrowDown'));
      });

      expect(result.current.selectedIndex).toBe(1);
    });

    it('wraps selection from last to first with ArrowDown', async () => {
      const { result } = await openWithFiles();
      const fileCount = result.current.files.length;

      // Move to the last item
      for (let i = 0; i < fileCount - 1; i++) {
        act(() => {
          result.current.handleKeyDown(makeKeyboardEvent('ArrowDown'));
        });
      }
      expect(result.current.selectedIndex).toBe(fileCount - 1);

      // One more should wrap to 0
      act(() => {
        result.current.handleKeyDown(makeKeyboardEvent('ArrowDown'));
      });
      expect(result.current.selectedIndex).toBe(0);
    });

    it('moves selection up with ArrowUp', async () => {
      const { result } = await openWithFiles();

      // Move down first
      act(() => {
        result.current.handleKeyDown(makeKeyboardEvent('ArrowDown'));
        result.current.handleKeyDown(makeKeyboardEvent('ArrowDown'));
      });
      expect(result.current.selectedIndex).toBe(2);

      act(() => {
        result.current.handleKeyDown(makeKeyboardEvent('ArrowUp'));
      });
      expect(result.current.selectedIndex).toBe(1);
    });

    it('wraps selection from first to last with ArrowUp', async () => {
      const { result } = await openWithFiles();
      const fileCount = result.current.files.length;
      expect(result.current.selectedIndex).toBe(0);

      act(() => {
        result.current.handleKeyDown(makeKeyboardEvent('ArrowUp'));
      });

      expect(result.current.selectedIndex).toBe(fileCount - 1);
    });

    it('selects file on Enter', async () => {
      const onSelectFile = vi.fn();
      const { result } = renderHook(() =>
        useFileMentions({ ...defaultOptions, onSelectFile })
      );

      await act(async () => {
        result.current.handleTextChange('@', 1);
        await vi.advanceTimersByTimeAsync(0);
      });

      const selectedFile = result.current.files[0];

      act(() => {
        result.current.handleKeyDown(makeKeyboardEvent('Enter'));
      });

      expect(onSelectFile).toHaveBeenCalledWith(selectedFile, 0);
      expect(result.current.isOpen).toBe(false);
    });

    it('selects file on Tab', async () => {
      const onSelectFile = vi.fn();
      const { result } = renderHook(() =>
        useFileMentions({ ...defaultOptions, onSelectFile })
      );

      await act(async () => {
        result.current.handleTextChange('@', 1);
        await vi.advanceTimersByTimeAsync(0);
      });

      const selectedFile = result.current.files[0];

      act(() => {
        result.current.handleKeyDown(makeKeyboardEvent('Tab'));
      });

      expect(onSelectFile).toHaveBeenCalledWith(selectedFile, 0);
      expect(result.current.isOpen).toBe(false);
    });

    it('dismisses on Escape', async () => {
      const { result } = await openWithFiles();
      expect(result.current.isOpen).toBe(true);

      act(() => {
        result.current.handleKeyDown(makeKeyboardEvent('Escape'));
      });

      expect(result.current.isOpen).toBe(false);
    });

    it('returns true for handled keys (consumed)', async () => {
      const { result } = await openWithFiles();

      const handledKeys = ['ArrowDown', 'ArrowUp', 'Enter', 'Tab', 'Escape'];
      for (const key of handledKeys) {
        // Reopen if dismissed
        if (!result.current.isOpen) {
          await act(async () => {
            result.current.handleTextChange('@', 1);
            await vi.advanceTimersByTimeAsync(0);
          });
        }

        let handled = false;
        act(() => {
          handled = result.current.handleKeyDown(makeKeyboardEvent(key));
        });
        expect(handled).toBe(true);
      }
    });

    it('returns false for unhandled keys', async () => {
      const { result } = await openWithFiles();

      let handled = false;
      act(() => {
        handled = result.current.handleKeyDown(makeKeyboardEvent('a'));
      });
      expect(handled).toBe(false);
    });

    it('calls preventDefault on handled keys', async () => {
      const { result } = await openWithFiles();

      const event = makeKeyboardEvent('ArrowDown');

      act(() => {
        result.current.handleKeyDown(event);
      });

      expect(event.preventDefault).toHaveBeenCalled();
    });

    it('returns false when open but no files match', async () => {
      mockedListSessionFiles.mockResolvedValue([]);

      const { result } = renderHook(() => useFileMentions(defaultOptions));

      await act(async () => {
        result.current.handleTextChange('@', 1);
        await vi.advanceTimersByTimeAsync(0);
      });

      let handled = false;
      act(() => {
        handled = result.current.handleKeyDown(makeKeyboardEvent('ArrowDown'));
      });
      expect(handled).toBe(false);
    });

    it('resets selectedIndex when query changes', async () => {
      const { result } = await openWithFiles();

      // Move selection down
      act(() => {
        result.current.handleKeyDown(makeKeyboardEvent('ArrowDown'));
        result.current.handleKeyDown(makeKeyboardEvent('ArrowDown'));
      });
      expect(result.current.selectedIndex).toBe(2);

      // Change query - should reset index
      await act(async () => {
        result.current.handleTextChange('@h', 2);
      });

      expect(result.current.selectedIndex).toBe(0);
    });
  });

  // ── selectFile ─────────────────────────────────────────────────────

  describe('selectFile', () => {
    it('calls onSelectFile with file and trigger position', async () => {
      const onSelectFile = vi.fn();
      const { result } = renderHook(() =>
        useFileMentions({ ...defaultOptions, onSelectFile })
      );

      await act(async () => {
        result.current.handleTextChange('check @', 7);
        await vi.advanceTimersByTimeAsync(0);
      });

      const file = result.current.files[0];

      act(() => {
        result.current.selectFile(file);
      });

      // triggerPos should be 6 (index of @)
      expect(onSelectFile).toHaveBeenCalledWith(file, 6);
    });

    it('closes the menu after selecting', async () => {
      const { result } = renderHook(() => useFileMentions(defaultOptions));

      await act(async () => {
        result.current.handleTextChange('@', 1);
        await vi.advanceTimersByTimeAsync(0);
      });

      expect(result.current.isOpen).toBe(true);

      act(() => {
        result.current.selectFile(result.current.files[0]);
      });

      expect(result.current.isOpen).toBe(false);
    });

    it('resets query and selectedIndex after selecting', async () => {
      const { result } = renderHook(() => useFileMentions(defaultOptions));

      await act(async () => {
        result.current.handleTextChange('@src', 4);
        await vi.advanceTimersByTimeAsync(0);
      });

      act(() => {
        result.current.handleKeyDown(makeKeyboardEvent('ArrowDown'));
      });

      expect(result.current.query).toBe('src');
      expect(result.current.selectedIndex).toBe(1);

      act(() => {
        result.current.selectFile(result.current.files[1]);
      });

      expect(result.current.query).toBe('');
      expect(result.current.selectedIndex).toBe(0);
    });
  });

  // ── dismiss ────────────────────────────────────────────────────────

  describe('dismiss', () => {
    it('closes the menu', async () => {
      const { result } = renderHook(() => useFileMentions(defaultOptions));

      await act(async () => {
        result.current.handleTextChange('@', 1);
        await vi.advanceTimersByTimeAsync(0);
      });

      expect(result.current.isOpen).toBe(true);

      act(() => {
        result.current.dismiss();
      });

      expect(result.current.isOpen).toBe(false);
    });

    it('resets query', async () => {
      const { result } = renderHook(() => useFileMentions(defaultOptions));

      await act(async () => {
        result.current.handleTextChange('@test', 5);
        await vi.advanceTimersByTimeAsync(0);
      });

      act(() => {
        result.current.dismiss();
      });

      expect(result.current.query).toBe('');
    });

    it('resets selectedIndex', async () => {
      const { result } = renderHook(() => useFileMentions(defaultOptions));

      await act(async () => {
        result.current.handleTextChange('@', 1);
        await vi.advanceTimersByTimeAsync(0);
      });

      act(() => {
        result.current.handleKeyDown(makeKeyboardEvent('ArrowDown'));
      });

      act(() => {
        result.current.dismiss();
      });

      expect(result.current.selectedIndex).toBe(0);
    });
  });

  // ── API integration ────────────────────────────────────────────────

  describe('API integration', () => {
    it('calls listSessionFiles with correct arguments', async () => {
      const { result } = renderHook(() => useFileMentions(defaultOptions));

      await act(async () => {
        result.current.handleTextChange('@', 1);
        await vi.advanceTimersByTimeAsync(0);
      });

      expect(mockedListSessionFiles).toHaveBeenCalledWith('ws-1', 'session-1', 'all');
    });

    it('handles API error gracefully', async () => {
      mockedListSessionFiles.mockRejectedValue(new Error('Server error'));
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const { result } = renderHook(() => useFileMentions(defaultOptions));

      await act(async () => {
        result.current.handleTextChange('@', 1);
        await vi.advanceTimersByTimeAsync(0);
      });

      expect(consoleSpy).toHaveBeenCalledWith(
        'Failed to load files for mentions:',
        expect.any(Error)
      );
      expect(result.current.files).toHaveLength(0);
      expect(result.current.isLoading).toBe(false);

      consoleSpy.mockRestore();
    });

    it('allows retry after API failure', async () => {
      mockedListSessionFiles
        .mockRejectedValueOnce(new Error('Server error'))
        .mockResolvedValueOnce(makeFileTree());
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const { result } = renderHook(() => useFileMentions(defaultOptions));

      // First trigger fails
      await act(async () => {
        result.current.handleTextChange('@', 1);
        await vi.advanceTimersByTimeAsync(0);
      });

      expect(result.current.files).toHaveLength(0);

      // Dismiss and try again
      act(() => {
        result.current.dismiss();
      });

      await act(async () => {
        result.current.handleTextChange('@', 1);
        await vi.advanceTimersByTimeAsync(0);
      });

      expect(result.current.files.length).toBeGreaterThan(0);

      consoleSpy.mockRestore();
    });
  });

  // ── setSelectedIndex ───────────────────────────────────────────────

  describe('setSelectedIndex', () => {
    it('allows manual index setting', async () => {
      const { result } = renderHook(() => useFileMentions(defaultOptions));

      await act(async () => {
        result.current.handleTextChange('@', 1);
        await vi.advanceTimersByTimeAsync(0);
      });

      act(() => {
        result.current.setSelectedIndex(3);
      });

      expect(result.current.selectedIndex).toBe(3);
    });
  });
});
