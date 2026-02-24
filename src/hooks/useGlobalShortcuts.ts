'use client';

import { useEffect, useCallback } from 'react';
import { useAppStore } from '@/stores/appStore';
import { useTabStore } from '@/stores/tabStore';
import { ENABLE_BROWSER_TABS } from '@/lib/constants';
import { switchToTab, createAndSwitchToNewTab } from '@/components/navigation/BrowserTabBar';
import { navigate } from '@/lib/navigation';
import type { WorktreeSession } from '@/lib/types';

interface GlobalShortcutsOptions {
  sessions: WorktreeSession[];
  toggleBottomTerminal: () => void;
  selectNextTab: () => void;
  selectPreviousTab: () => void;
  setZenMode: (value: boolean) => void;
  zenModeRef: React.RefObject<boolean>;
}

/**
 * Registers global keyboard shortcuts that are NOT handled by native menu accelerators.
 * Covers: shortcuts without menu items, context-dependent shortcuts,
 * and shortcuts that need special terminal/focus handling.
 *
 * Also disables the default browser context menu in production.
 */
export function useGlobalShortcuts(options: GlobalShortcutsOptions) {
  const { sessions, toggleBottomTerminal, selectNextTab, selectPreviousTab, setZenMode, zenModeRef } = options;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Block browser zoom in production (Cmd+= Cmd+- Cmd+0)
      if (process.env.NODE_ENV !== 'development') {
        if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey &&
            (e.key === '=' || e.key === '+' || e.key === '-' || e.key === '0')) {
          e.preventDefault();
          return;
        }
      }
      // Cmd+R to reload the app (development only)
      if (e.key === 'r' && (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        if (process.env.NODE_ENV === 'development') {
          window.location.reload();
        }
      }
      // Cmd+K for command palette - allow terminal to handle it for clear
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        const isInTerminal = (e.target as HTMLElement)?.closest('.xterm');
        if (!isInTerminal) {
          e.preventDefault();
          window.dispatchEvent(new CustomEvent('open-command-palette'));
        }
      }
      // Cmd+J as alternative terminal toggle (Cmd+` is reserved by macOS for window switching)
      if (e.key === 'j' && e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        toggleBottomTerminal();
      }
      // Cmd+Shift+1-9 to switch sessions
      // Use e.code because Shift changes e.key to symbols on macOS (e.g. '1' → '!')
      if (e.metaKey && e.shiftKey && e.code >= 'Digit1' && e.code <= 'Digit9') {
        e.preventDefault();
        const index = parseInt(e.code.slice(5)) - 1;
        if (sessions[index]) {
          const session = sessions[index];
          navigate({
            workspaceId: session.workspaceId,
            sessionId: session.id,
            contentView: { type: 'conversation' },
          });
        }
      }
      // Tab switching shortcuts (multiple options for cross-platform compatibility)
      // Cmd+Option+] or Ctrl+Tab for next tab
      if ((e.key === ']' && e.metaKey && e.altKey && !e.shiftKey) ||
          (e.key === 'Tab' && e.ctrlKey && !e.shiftKey && !e.metaKey && !e.altKey)) {
        e.preventDefault();
        selectNextTab();
      }
      // Cmd+Option+[ or Ctrl+Shift+Tab for previous tab
      if ((e.key === '[' && e.metaKey && e.altKey && !e.shiftKey) ||
          (e.key === 'Tab' && e.ctrlKey && e.shiftKey && !e.metaKey && !e.altKey)) {
        e.preventDefault();
        selectPreviousTab();
      }
      // Cmd+T to open new browser tab
      if (ENABLE_BROWSER_TABS && e.key === 't' && (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        createAndSwitchToNewTab();
      }
      // Cmd+Shift+] for next browser tab
      if (ENABLE_BROWSER_TABS && e.key === ']' && (e.metaKey || e.ctrlKey) && e.shiftKey && !e.altKey) {
        e.preventDefault();
        const { tabOrder, activeTabId: currentTabId } = useTabStore.getState();
        if (tabOrder.length > 1) {
          const currentIndex = tabOrder.indexOf(currentTabId);
          const nextIndex = (currentIndex + 1) % tabOrder.length;
          switchToTab(tabOrder[nextIndex]);
        }
      }
      // Cmd+Shift+[ for previous browser tab
      if (ENABLE_BROWSER_TABS && e.key === '[' && (e.metaKey || e.ctrlKey) && e.shiftKey && !e.altKey) {
        e.preventDefault();
        const { tabOrder, activeTabId: currentTabId } = useTabStore.getState();
        if (tabOrder.length > 1) {
          const currentIndex = tabOrder.indexOf(currentTabId);
          const prevIndex = (currentIndex - 1 + tabOrder.length) % tabOrder.length;
          switchToTab(tabOrder[prevIndex]);
        }
      }
      // Cmd+1-9 to select browser tabs by position (Cmd+9 = last tab)
      if (ENABLE_BROWSER_TABS && e.key >= '1' && e.key <= '9' && (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        const { tabOrder } = useTabStore.getState();
        if (tabOrder.length > 1) {
          const num = parseInt(e.key, 10);
          // Cmd+9 always selects the last tab
          const targetIndex = num === 9 ? tabOrder.length - 1 : num - 1;
          if (targetIndex < tabOrder.length) {
            switchToTab(tabOrder[targetIndex]);
          }
        }
      }
      // Escape to exit zen mode
      if (e.key === 'Escape') {
        if (zenModeRef.current) {
          e.preventDefault();
          setZenMode(false);
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [sessions, toggleBottomTerminal, selectNextTab, selectPreviousTab, setZenMode, zenModeRef]);

  // Disable default browser context menu in production
  useEffect(() => {
    if (process.env.NODE_ENV === 'development') return;
    const handler = (e: MouseEvent) => e.preventDefault();
    document.addEventListener('contextmenu', handler);
    return () => document.removeEventListener('contextmenu', handler);
  }, []);
}
