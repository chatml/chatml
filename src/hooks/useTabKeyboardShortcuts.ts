'use client';

import { useEffect, useCallback } from 'react';
import { useTabViewStore } from '@/stores/tabViewStore';

/**
 * Hook for registering keyboard shortcuts for tab management.
 *
 * Shortcuts:
 * - Cmd/Ctrl+T: New tab
 * - Cmd/Ctrl+W: Close current tab
 * - Cmd/Ctrl+1-9: Switch to tab by index (1-based)
 * - Cmd/Ctrl+Tab: Next tab
 * - Cmd/Ctrl+Shift+Tab: Previous tab
 *
 * Note: Uses 'meta' modifier which is cross-platform:
 * - macOS: Cmd key
 * - Windows/Linux: Ctrl key
 */
export function useTabKeyboardShortcuts() {
  const tabs = useTabViewStore((state) => state.tabs);
  const activeTabId = useTabViewStore((state) => state.activeTabId);
  const createTab = useTabViewStore((state) => state.createTab);
  const closeTab = useTabViewStore((state) => state.closeTab);
  const setActiveTab = useTabViewStore((state) => state.setActiveTab);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      // Check for Cmd (Mac) or Ctrl (Windows/Linux)
      const metaOrCtrl = event.metaKey || event.ctrlKey;

      // Cmd/Ctrl+T: New tab
      if (metaOrCtrl && event.key === 't' && !event.shiftKey && !event.altKey) {
        event.preventDefault();
        createTab();
        return;
      }

      // Cmd/Ctrl+W: Close current tab
      if (metaOrCtrl && event.key === 'w' && !event.shiftKey && !event.altKey) {
        event.preventDefault();
        if (tabs.length > 1) {
          closeTab(activeTabId);
        }
        return;
      }

      // Cmd/Ctrl+1-9: Switch to tab by index
      if (metaOrCtrl && !event.shiftKey && !event.altKey) {
        const num = parseInt(event.key);
        if (num >= 1 && num <= 9) {
          event.preventDefault();
          const targetTab = tabs[num - 1];
          if (targetTab) {
            setActiveTab(targetTab.id);
          }
          return;
        }
      }

      // Cmd/Ctrl+Tab: Next tab
      if (metaOrCtrl && event.key === 'Tab' && !event.shiftKey) {
        event.preventDefault();
        const currentIndex = tabs.findIndex((t) => t.id === activeTabId);
        const nextIndex = (currentIndex + 1) % tabs.length;
        setActiveTab(tabs[nextIndex].id);
        return;
      }

      // Cmd/Ctrl+Shift+Tab: Previous tab
      if (metaOrCtrl && event.key === 'Tab' && event.shiftKey) {
        event.preventDefault();
        const currentIndex = tabs.findIndex((t) => t.id === activeTabId);
        const prevIndex = (currentIndex - 1 + tabs.length) % tabs.length;
        setActiveTab(tabs[prevIndex].id);
        return;
      }
    },
    [tabs, activeTabId, createTab, closeTab, setActiveTab]
  );

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);
}

/**
 * Get the platform-specific modifier key display string.
 * @returns 'Cmd' on macOS, 'Ctrl' on Windows/Linux
 */
export function getModifierKeyDisplay(): string {
  if (typeof window === 'undefined') return 'Cmd/Ctrl';

  const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0 ||
                navigator.userAgent.toUpperCase().indexOf('MAC') >= 0;

  return isMac ? 'Cmd' : 'Ctrl';
}
