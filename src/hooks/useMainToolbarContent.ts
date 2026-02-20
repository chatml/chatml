import { useEffect, useRef } from 'react';
import { useUIStore, type ToolbarConfig } from '@/stores/uiStore';

/**
 * Sets the MainToolbar's dynamic content (Flutter AppBar-style).
 * Config is applied on mount / update and cleared on unmount.
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

  useEffect(() => {
    configRef.current = config;
  });

  // Apply on mount and clear on unmount
  useEffect(() => {
    useUIStore.getState().setToolbarConfig(configRef.current);
    return () => useUIStore.getState().setToolbarConfig(null);
  }, []);

  // Sync config updates when the caller's memoized config changes
  useEffect(() => {
    useUIStore.getState().setToolbarConfig(config);
  }, [config]);
}
