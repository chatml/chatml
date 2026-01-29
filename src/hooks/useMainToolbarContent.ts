import { useEffect } from 'react';
import { useUIStore, type ToolbarConfig } from '@/stores/uiStore';

/**
 * Sets the MainToolbar's dynamic content (Flutter AppBar-style).
 * Config is applied on mount and cleared on unmount.
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
  const setToolbarConfig = useUIStore((s) => s.setToolbarConfig);

  useEffect(() => {
    setToolbarConfig(config);
    return () => setToolbarConfig(null);
  }, [config, setToolbarConfig]);
}
