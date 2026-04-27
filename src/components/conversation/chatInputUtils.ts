import type { Shortcut, ModifierKey } from '@/lib/shortcuts';
import type { DictationShortcutPreset } from '@/stores/settingsStore';
import type { FileNodeDTO } from '@/lib/api';
import type { ModelEntry } from '@/lib/models';
import { isLocalModel } from '@/lib/models';
import { THINKING_LEVELS, type ThinkingLevel, canDisableThinking } from '@/lib/thinkingLevels';
import { useSettingsStore } from '@/stores/settingsStore';

/** Convert a dictation shortcut preset + custom string into a Shortcut definition. */
export function parseDictationShortcut(
  preset: DictationShortcutPreset,
  custom: string,
): Shortcut {
  const base = { id: 'toggleDictation', label: 'Toggle dictation', category: 'Chat' as const };
  switch (preset) {
    case 'capslock':
      return { ...base, key: 'CapsLock', modifiers: [] };
    case 'cmd-shift-d':
      return { ...base, key: 'd', modifiers: ['meta', 'shift'] };
    case 'custom': {
      if (!custom) return { ...base, key: 'd', modifiers: ['meta', 'shift'] };
      const parts = custom.split('+');
      const key = parts[parts.length - 1];
      const modifiers = parts.slice(0, -1) as ModifierKey[];
      return { ...base, key, modifiers };
    }
  }
}

/** Format a Shortcut into a human-readable hint string (e.g. "⌘⇧D"). */
export function formatShortcutHint(shortcut: Shortcut): string {
  const parts: string[] = [];
  for (const mod of shortcut.modifiers) {
    switch (mod) {
      case 'meta': parts.push('⌘'); break;
      case 'ctrl': parts.push('Ctrl'); break;
      case 'alt': parts.push('⌥'); break;
      case 'shift': parts.push('⇧'); break;
    }
  }
  const key = shortcut.key.length === 1 ? shortcut.key.toUpperCase() : shortcut.key;
  parts.push(key);
  return parts.join('');
}

/** Flat file shape used by ChatInput's mention-search ranking. */
export interface FlatFile {
  path: string;
  name: string;
  directory: string;
}

/** Flatten a Plate file tree into a flat list, skipping hidden files/directories. */
export function flattenFileTree(
  nodes: FileNodeDTO[],
  parentPath: string = '',
  depth: number = 0,
): FlatFile[] {
  if (depth >= 15) return [];
  const result: FlatFile[] = [];
  for (const node of nodes) {
    if (node.name.startsWith('.')) continue;

    if (node.isDir) {
      if (node.children) {
        result.push(...flattenFileTree(node.children, node.path, depth + 1));
      }
    } else {
      const directory = parentPath || node.path.split('/').slice(0, -1).join('/');
      result.push({ path: node.path, name: node.name, directory });
    }
  }
  return result;
}

/** Resolve the backend type. Reads from settingsStore. */
export function resolveBackend(modelId: string): 'native' | undefined {
  if (isLocalModel(modelId)) return 'native';
  return useSettingsStore.getState().defaultBackend === 'native' ? 'native' : undefined;
}

/** Get available thinking level IDs for a model, respecting SDK-reported supported levels. */
export function getAvailableThinkingLevels(model: ModelEntry): ThinkingLevel[] {
  const allLevels = THINKING_LEVELS.map((l) => l.id);
  const allowOff = canDisableThinking(model);
  let available = allowOff ? allLevels : allLevels.filter((l) => l !== 'off');
  if (model.supportsEffort && model.supportedEffortLevels) {
    const supported = new Set(model.supportedEffortLevels);
    available = available.filter(
      (l) => l === 'off' || supported.has(l as 'low' | 'medium' | 'high' | 'max'),
    );
  }
  return available;
}
