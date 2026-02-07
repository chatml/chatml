import { useEffect, useRef } from 'react';
import { useAppStore } from '@/stores/appStore';
import { useDisclosureStore } from '@/stores/disclosureStore';
import { useSettingsStore } from '@/stores/settingsStore';
import type { PanelImperativeHandle } from '@/components/ui/resizable';

interface UseAutoExpandPanelsOptions {
  rightSidebarPanelRef: React.RefObject<PanelImperativeHandle | null>;
  bottomTerminalPanelRef: React.RefObject<PanelImperativeHandle | null>;
  /** Set to true only when the inner panel group is mounted (not loading, session selected, conversation view). */
  panelReady: boolean;
}

/**
 * Watches session stats and fullModeEnabled to auto-expand/collapse panels.
 *
 * The right sidebar starts collapsed (via effectiveLayoutInner in page.tsx).
 * This hook only EXPANDS it when:
 * - Session stats arrive with non-zero changes (first time per session)
 * - fullModeEnabled is toggled on
 */
export function useAutoExpandPanels({
  rightSidebarPanelRef,
  bottomTerminalPanelRef,
  panelReady,
}: UseAutoExpandPanelsOptions) {
  const selectedSessionId = useAppStore((s) => s.selectedSessionId);

  // Derive a stable boolean — avoids re-renders from new stats object references.
  const sessionHasChanges = useAppStore((s) => {
    if (!s.selectedSessionId) return false;
    const session = s.sessions.find((sess) => sess.id === s.selectedSessionId);
    if (!session?.stats) return false;
    return session.stats.additions > 0 || session.stats.deletions > 0;
  });

  const fullModeEnabled = useDisclosureStore((s) => s.fullModeEnabled);
  const setShowBottomTerminal = useSettingsStore((s) => s.setShowBottomTerminal);

  const prevFullModeRef = useRef(fullModeEnabled);

  // Track which sessions we've auto-expanded for (local ref, no store writes)
  const expandedSessionsRef = useRef(new Set<string>());

  // Auto-expand right sidebar when session first gets file changes.
  // panelReady ensures we don't fire before the inner panel group mounts
  // (e.g. during initial data loading when the skeleton is shown).
  useEffect(() => {
    if (!panelReady) return;
    if (!selectedSessionId || !sessionHasChanges || fullModeEnabled) return;
    if (expandedSessionsRef.current.has(selectedSessionId)) return;

    expandedSessionsRef.current.add(selectedSessionId);
    rightSidebarPanelRef.current?.expand();
  }, [panelReady, selectedSessionId, sessionHasChanges, fullModeEnabled, rightSidebarPanelRef]);

  // Handle fullModeEnabled toggle transitions
  useEffect(() => {
    const wasFullMode = prevFullModeRef.current;
    prevFullModeRef.current = fullModeEnabled;

    if (fullModeEnabled && !wasFullMode) {
      rightSidebarPanelRef.current?.expand();
      setShowBottomTerminal(true);
    } else if (!fullModeEnabled && wasFullMode) {
      rightSidebarPanelRef.current?.collapse();
      setShowBottomTerminal(false);
    }
  }, [fullModeEnabled, rightSidebarPanelRef, bottomTerminalPanelRef, setShowBottomTerminal]);
}
