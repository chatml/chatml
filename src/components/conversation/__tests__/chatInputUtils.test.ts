import { describe, it, expect, beforeEach } from 'vitest';
import {
  parseDictationShortcut,
  formatShortcutHint,
  flattenFileTree,
  resolveBackend,
  getAvailableThinkingLevels,
  type FlatFile,
} from '../chatInputUtils';
import { useSettingsStore } from '@/stores/settingsStore';
import type { FileNodeDTO } from '@/lib/api';
import type { ModelEntry } from '@/lib/models';

describe('parseDictationShortcut', () => {
  it("returns CapsLock with no modifiers for 'capslock' preset", () => {
    expect(parseDictationShortcut('capslock', '')).toMatchObject({
      key: 'CapsLock',
      modifiers: [],
    });
  });

  it("returns Cmd+Shift+D for 'cmd-shift-d' preset", () => {
    expect(parseDictationShortcut('cmd-shift-d', '')).toMatchObject({
      key: 'd',
      modifiers: ['meta', 'shift'],
    });
  });

  it("parses a custom shortcut like 'ctrl+shift+x'", () => {
    expect(parseDictationShortcut('custom', 'ctrl+shift+x')).toMatchObject({
      key: 'x',
      modifiers: ['ctrl', 'shift'],
    });
  });

  it("falls back to Cmd+Shift+D when 'custom' preset has empty string", () => {
    expect(parseDictationShortcut('custom', '')).toMatchObject({
      key: 'd',
      modifiers: ['meta', 'shift'],
    });
  });

  it('always sets id, label, category', () => {
    const result = parseDictationShortcut('capslock', '');
    expect(result.id).toBe('toggleDictation');
    expect(result.label).toBe('Toggle dictation');
    expect(result.category).toBe('Chat');
  });
});

describe('formatShortcutHint', () => {
  it('formats a single key', () => {
    expect(formatShortcutHint({
      id: 'x', label: 'X', category: 'Chat',
      key: 'a', modifiers: [],
    })).toBe('A');
  });

  it('uppercases single-char keys', () => {
    expect(formatShortcutHint({
      id: 'x', label: 'X', category: 'Chat',
      key: 'd', modifiers: ['meta'],
    })).toBe('⌘D');
  });

  it('preserves multi-char keys verbatim (e.g. CapsLock)', () => {
    expect(formatShortcutHint({
      id: 'x', label: 'X', category: 'Chat',
      key: 'CapsLock', modifiers: [],
    })).toBe('CapsLock');
  });

  it('renders all four modifier glyphs', () => {
    expect(formatShortcutHint({
      id: 'x', label: 'X', category: 'Chat',
      key: 'a', modifiers: ['meta', 'ctrl', 'alt', 'shift'],
    })).toBe('⌘Ctrl⌥⇧A');
  });
});

describe('flattenFileTree', () => {
  it('returns empty array for empty input', () => {
    expect(flattenFileTree([])).toEqual([]);
  });

  it('flattens a single file', () => {
    const nodes: FileNodeDTO[] = [
      { name: 'app.tsx', path: 'src/app.tsx', isDir: false },
    ];
    const result = flattenFileTree(nodes);
    expect(result).toEqual<FlatFile[]>([
      { path: 'src/app.tsx', name: 'app.tsx', directory: 'src' },
    ]);
  });

  it('flattens nested directories', () => {
    const nodes: FileNodeDTO[] = [
      {
        name: 'src',
        path: 'src',
        isDir: true,
        children: [
          { name: 'app.tsx', path: 'src/app.tsx', isDir: false },
          { name: 'utils.ts', path: 'src/utils.ts', isDir: false },
        ],
      },
    ];
    const result = flattenFileTree(nodes);
    expect(result).toHaveLength(2);
    expect(result.map((f) => f.path).sort()).toEqual(['src/app.tsx', 'src/utils.ts']);
  });

  it('skips hidden files and directories (starting with .)', () => {
    const nodes: FileNodeDTO[] = [
      { name: '.env', path: '.env', isDir: false },
      { name: '.git', path: '.git', isDir: true, children: [
        { name: 'HEAD', path: '.git/HEAD', isDir: false },
      ]},
      { name: 'README.md', path: 'README.md', isDir: false },
    ];
    const result = flattenFileTree(nodes);
    expect(result.map((f) => f.name)).toEqual(['README.md']);
  });

  it('captures the parent directory in each result', () => {
    const nodes: FileNodeDTO[] = [
      {
        name: 'lib',
        path: 'lib',
        isDir: true,
        children: [
          {
            name: 'api',
            path: 'lib/api',
            isDir: true,
            children: [
              { name: 'git.ts', path: 'lib/api/git.ts', isDir: false },
            ],
          },
        ],
      },
    ];
    const result = flattenFileTree(nodes);
    expect(result[0].directory).toBe('lib/api');
  });

  it('caps recursion at depth 15 (defensive against pathological trees)', () => {
    // Build a 20-deep nested directory
    let nested: FileNodeDTO = {
      name: 'leaf',
      path: '/'.repeat(20) + 'leaf',
      isDir: false,
    };
    for (let i = 19; i >= 0; i--) {
      nested = {
        name: `d${i}`,
        path: `d${i}`,
        isDir: true,
        children: [nested],
      };
    }
    const result = flattenFileTree([nested]);
    // Cap means the leaf at depth 20 is unreachable
    expect(result).toEqual([]);
  });

  it('handles directories with no children gracefully', () => {
    const nodes: FileNodeDTO[] = [
      { name: 'empty', path: 'empty', isDir: true },
    ];
    expect(flattenFileTree(nodes)).toEqual([]);
  });
});

describe('resolveBackend', () => {
  beforeEach(() => {
    useSettingsStore.setState({ defaultBackend: 'agent-runner' } as never);
  });

  it("returns 'native' for local models regardless of settings", () => {
    useSettingsStore.setState({ defaultBackend: 'agent-runner' } as never);
    // isLocalModel matches the 'ollama/' prefix
    expect(resolveBackend('ollama/llama3')).toBe('native');
  });

  it("returns 'native' when defaultBackend is 'native'", () => {
    useSettingsStore.setState({ defaultBackend: 'native' } as never);
    expect(resolveBackend('claude-sonnet-4-6')).toBe('native');
  });

  it('returns undefined when defaultBackend is agent-runner and model is non-local', () => {
    useSettingsStore.setState({ defaultBackend: 'agent-runner' } as never);
    expect(resolveBackend('claude-sonnet-4-6')).toBeUndefined();
  });
});

describe('getAvailableThinkingLevels', () => {
  // canDisableThinking returns !model.supportsEffort. So:
  //   supportsEffort: true  → "off" is NOT allowed (excluded from levels)
  //   supportsEffort: false → "off" IS allowed (included in levels)

  it('excludes "off" when the model uses effort-based thinking (supportsEffort=true)', () => {
    const model: ModelEntry = {
      id: 'gpt-5',
      name: 'GPT-5',
      description: '',
      supportsThinking: true,
      supportsEffort: true,
      contextWindow: 200000,
    } as never;
    const levels = getAvailableThinkingLevels(model);
    expect(levels).not.toContain('off');
  });

  it('includes "off" when the model does not use effort levels (supportsEffort=false)', () => {
    const model: ModelEntry = {
      id: 'claude-haiku-4-5',
      name: 'Haiku 4.5',
      description: '',
      supportsThinking: true,
      supportsEffort: false,
      contextWindow: 200000,
    } as never;
    const levels = getAvailableThinkingLevels(model);
    expect(levels).toContain('off');
  });

  it('filters by SDK-reported supportedEffortLevels (without "off")', () => {
    const model: ModelEntry = {
      id: 'gpt-5',
      name: 'GPT-5',
      description: '',
      supportsThinking: true,
      supportsEffort: true,
      supportedEffortLevels: ['low', 'medium'],
      contextWindow: 200000,
    } as never;
    const levels = getAvailableThinkingLevels(model);
    // 'off' excluded because supportsEffort=true; only allowed effort levels remain
    expect(levels).not.toContain('off');
    expect(levels).toContain('low');
    expect(levels).toContain('medium');
    expect(levels).not.toContain('high');
    expect(levels).not.toContain('max');
  });

  it('returns all levels (including "off") when supportsEffort is false', () => {
    const model: ModelEntry = {
      id: 'claude-sonnet-4-6',
      name: 'Sonnet 4.6',
      description: '',
      supportsThinking: true,
      supportsEffort: false,
      contextWindow: 200000,
    } as never;
    const levels = getAvailableThinkingLevels(model);
    expect(levels.length).toBeGreaterThan(2);
    expect(levels).toContain('off');
  });
});
