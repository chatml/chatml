import { type MutableRefObject, useEffect, useRef } from 'react';
import { useUIStore, type ToolbarConfig } from '@/stores/uiStore';

// Track mounted instances so unmount can restore the previous toolbar config
// instead of clearing to null (fixes overlay views like Settings clobbering
// the toolbar of the still-mounted view beneath them).
// Stored on globalThis so the stack survives HMR module re-evaluation.
const STACK_KEY = '__useMainToolbarContent_stack__';

type StackEntry = { id: symbol; configRef: MutableRefObject<ToolbarConfig> };

function getStack(): StackEntry[] {
  if (!(globalThis as Record<string, unknown>)[STACK_KEY]) {
    (globalThis as Record<string, unknown>)[STACK_KEY] = [];
  }
  return (globalThis as Record<string, unknown>)[STACK_KEY] as StackEntry[];
}

/**
 * Sets the MainToolbar's dynamic content (Flutter AppBar-style).
 * Config is applied on mount / update and restored on unmount.
 *
 * @example
 * useMainToolbarContent({
 *   leading: <BackButton />,
 *   title: <h1>Branches</h1>,
 *   titlePosition: 'left',
 *   actions: <RefreshButton />,
 * });
 */
export function useMainToolbarContent(config: ToolbarConfig) {
  const configRef = useRef(config);
  const entryRef = useRef<StackEntry | null>(null);

  useEffect(() => {
    configRef.current = config;
  });

  // Register on mount, restore previous on unmount
  useEffect(() => {
    const stack = getStack();
    const entry: StackEntry = { id: Symbol(), configRef };
    entryRef.current = entry;
    stack.push(entry);
    useUIStore.getState().setToolbarConfig(configRef.current);

    return () => {
      const s = getStack();
      const idx = s.findIndex((e) => e.id === entry.id);
      if (idx !== -1) s.splice(idx, 1);
      const prev = s[s.length - 1];
      useUIStore.getState().setToolbarConfig(prev ? prev.configRef.current : null);
    };
  }, []);

  // Sync config updates only when this instance is the topmost
  useEffect(() => {
    const stack = getStack();
    const top = stack[stack.length - 1];
    if (top && entryRef.current && top.id === entryRef.current.id) {
      useUIStore.getState().setToolbarConfig(config);
    }
  }, [config]);
}
