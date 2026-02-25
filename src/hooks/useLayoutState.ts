'use client';

import { useEffect, useState, useCallback, useRef, useLayoutEffect } from 'react';
import { useAppStore } from '@/stores/appStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useTerminalPanelVisible } from '@/stores/selectors';
import { useShallow } from 'zustand/react/shallow';
import type { PanelImperativeHandle } from '@/components/ui/resizable';

/**
 * Manages layout state for the app shell:
 * - Sidebar collapse/expand state
 * - Zen mode transitions with state preservation
 * - Panel refs for imperative resize control
 * - ResizeObserver for sidebar width tracking
 * - Bottom terminal toggle (per-session, store-driven)
 */
export function useLayoutState() {
  const [leftSidebarCollapsed, setLeftSidebarCollapsed] = useState(false);
  const [rightSidebarCollapsed, setRightSidebarCollapsed] = useState(false);
  const sidebarWidthRef = useRef(250); // Tracked via ref — no re-renders on resize

  // Panel refs for imperative collapse/expand
  const leftSidebarPanelRef = useRef<PanelImperativeHandle>(null);
  const rightSidebarPanelRef = useRef<PanelImperativeHandle>(null);
  const bottomTerminalPanelRef = useRef<PanelImperativeHandle>(null);
  const leftSidebarDomRef = useRef<HTMLDivElement>(null);

  // Pre-zen mode state for restoration
  const preZenStateRef = useRef({ left: false, right: false });

  const {
    zenMode, setZenMode,
    layoutOuter, setLayoutOuter,
    layoutInner, setLayoutInner,
    layoutVertical, setLayoutVertical,
    resetLayouts,
  } = useSettingsStore(useShallow((s) => ({
    zenMode: s.zenMode,
    setZenMode: s.setZenMode,
    layoutOuter: s.layoutOuter,
    setLayoutOuter: s.setLayoutOuter,
    layoutInner: s.layoutInner,
    setLayoutInner: s.setLayoutInner,
    layoutVertical: s.layoutVertical,
    setLayoutVertical: s.setLayoutVertical,
    resetLayouts: s.resetLayouts,
  })));

  // Per-session terminal panel visibility (hidden by default, not persisted across restarts)
  const selectedSessionId = useAppStore((s) => s.selectedSessionId);
  const showBottomTerminal = useTerminalPanelVisible(selectedSessionId);
  const setTerminalPanelVisible = useAppStore((s) => s.setTerminalPanelVisible);

  // Toggle functions for sidebars
  const toggleLeftSidebar = useCallback(() => {
    const panel = leftSidebarPanelRef.current;
    if (!panel) return;

    if (panel.isCollapsed()) {
      panel.expand();
    } else {
      panel.collapse();
    }
  }, []);

  const toggleRightSidebar = useCallback(() => {
    const panel = rightSidebarPanelRef.current;
    if (!panel) return;

    if (panel.isCollapsed()) {
      panel.expand();
    } else {
      panel.collapse();
    }
  }, []);

  const toggleBottomTerminal = useCallback(() => {
    const { selectedSessionId: sid } = useAppStore.getState();
    if (!sid) return;
    const current = useAppStore.getState().terminalPanelVisible[sid] ?? false;
    useAppStore.getState().setTerminalPanelVisible(sid, !current);
  }, []);

  const hideBottomTerminal = useCallback(() => {
    const { selectedSessionId: sid } = useAppStore.getState();
    if (!sid) return;
    useAppStore.getState().setTerminalPanelVisible(sid, false);
  }, []);

  // Sync bottom terminal panel collapse/expand state when session changes
  useLayoutEffect(() => {
    const panel = bottomTerminalPanelRef.current;
    if (!panel) return;
    if (showBottomTerminal && panel.isCollapsed()) {
      panel.expand();
    } else if (!showBottomTerminal && !panel.isCollapsed()) {
      panel.collapse();
    }
  }, [showBottomTerminal, selectedSessionId]);

  // Zen mode ref for keyboard handler closures
  const zenModeRef = useRef(zenMode);
  useEffect(() => {
    zenModeRef.current = zenMode;
  }, [zenMode]);

  // Track previous zen mode state to detect transitions
  const prevZenModeRef = useRef(zenMode);

  // Handle zen mode collapse/expand - only on zen mode TRANSITIONS
  useEffect(() => {
    const wasZenMode = prevZenModeRef.current;
    prevZenModeRef.current = zenMode;

    // Entering zen mode
    if (zenMode && !wasZenMode) {
      // Save current collapsed state before entering zen mode
      preZenStateRef.current = {
        left: leftSidebarCollapsed,
        right: rightSidebarCollapsed,
      };
      // Collapse both sidebars in zen mode
      leftSidebarPanelRef.current?.collapse();
      rightSidebarPanelRef.current?.collapse();
    }
    // Exiting zen mode
    else if (!zenMode && wasZenMode) {
      // Restore pre-zen state when exiting zen mode
      if (!preZenStateRef.current.left) {
        leftSidebarPanelRef.current?.expand();
      }
      if (!preZenStateRef.current.right) {
        rightSidebarPanelRef.current?.expand();
      }
    }
  }, [zenMode, leftSidebarCollapsed, rightSidebarCollapsed]);

  // Track left sidebar width for overlay positioning
  useEffect(() => {
    const el = leftSidebarDomRef.current;
    if (!el) return;

    const observer = new ResizeObserver(() => {
      sidebarWidthRef.current = leftSidebarCollapsed ? 0 : el.offsetWidth;
    });
    observer.observe(el);
    sidebarWidthRef.current = leftSidebarCollapsed ? 0 : el.offsetWidth;

    return () => observer.disconnect();
  }, [leftSidebarCollapsed]);

  return {
    // Sidebar state
    leftSidebarCollapsed,
    setLeftSidebarCollapsed,
    rightSidebarCollapsed,
    setRightSidebarCollapsed,
    sidebarWidthRef,

    // Panel refs
    leftSidebarPanelRef,
    rightSidebarPanelRef,
    bottomTerminalPanelRef,
    leftSidebarDomRef,

    // Toggle functions
    toggleLeftSidebar,
    toggleRightSidebar,
    toggleBottomTerminal,
    hideBottomTerminal,

    // Zen mode
    zenMode,
    setZenMode,
    zenModeRef,

    // Terminal visibility (per-session)
    showBottomTerminal,
    setTerminalPanelVisible,
    selectedSessionId,

    // Layout settings
    layoutOuter,
    setLayoutOuter,
    layoutInner,
    setLayoutInner,
    layoutVertical,
    setLayoutVertical,
    resetLayouts,
  };
}
