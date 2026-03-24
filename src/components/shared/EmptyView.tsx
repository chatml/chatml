'use client';

import { useMemo } from 'react';
import { useWorkspaceSelection } from '@/stores/selectors';
import { useSettingsStore } from '@/stores/settingsStore';
import { isMacOS } from '@/lib/platform';
import { resolveWorkspaceColor } from '@/lib/workspace-colors';
import { FullContentLayout } from '@/components/layout/FullContentLayout';
import { QuickActions } from './smart-launcher/QuickActions';
import { SessionsList } from './smart-launcher/SessionsList';

interface EmptyViewProps {
  onOpenProject: () => void;
  onCloneFromUrl: () => void;
  onNewSession: () => void;
  onCreateSession: () => void;
  onOpenSettings?: () => void;
  onOpenShortcuts?: () => void;
  showLeftSidebar?: boolean;
}

function ShortcutHint({ keys, label }: { keys: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground/40">
      <kbd className="font-mono text-[10px] bg-surface-1/60 border border-border/20 rounded px-1.5 py-0.5">
        {keys}
      </kbd>
      {label}
    </span>
  );
}

export function EmptyView({
  onOpenProject,
  onCloneFromUrl,
  onNewSession,
  onCreateSession,
  onOpenSettings,
  onOpenShortcuts,
  showLeftSidebar = true,
}: EmptyViewProps) {
  const { workspaces, sessions, selectedWorkspaceId } = useWorkspaceSelection();
  const workspaceColors = useSettingsStore((s) => s.workspaceColors);

  const nonArchivedSessions = useMemo(
    () => sessions.filter((s) => !s.archived),
    [sessions]
  );

  const displaySessions = useMemo(
    () =>
      [...nonArchivedSessions]
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
        .slice(0, 8),
    [nonArchivedSessions]
  );

  const hasWorkspace = !!selectedWorkspaceId;
  const modKey = isMacOS() ? '⌘' : 'Ctrl+';

  const selectedWorkspace = useMemo(
    () => workspaces.find((w) => w.id === selectedWorkspaceId),
    [workspaces, selectedWorkspaceId]
  );

  const wsColor = selectedWorkspace
    ? resolveWorkspaceColor(selectedWorkspace.id, workspaceColors)
    : undefined;

  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
  }, []);

  return (
    <FullContentLayout
      onOpenSettings={onOpenSettings}
      onOpenShortcuts={onOpenShortcuts}
      showLeftSidebar={showLeftSidebar}
    >
      <div className="h-full overflow-y-auto bg-content-background @container">
        {/* Subtle brand gradient overlay */}
        <div className="relative">
          <div className="absolute inset-x-0 top-0 h-64 bg-[radial-gradient(ellipse_60%_50%_at_50%_-20%,oklch(0.707_0.165_292/0.06),transparent)] dark:bg-[radial-gradient(ellipse_60%_50%_at_50%_-20%,oklch(0.707_0.165_292/0.08),transparent)] pointer-events-none" />

          <div className="relative max-w-2xl mx-auto px-6 pt-12 pb-20 stagger-children">
            {/* Hero */}
            <div className="mb-10">
              <h1 className="font-display text-3xl tracking-display text-foreground">
                {greeting}
              </h1>
              <p className="text-base text-muted-foreground mt-1.5">
                What would you like to work on?
              </p>
              {selectedWorkspace && wsColor && (
                <div className="mt-3 inline-flex items-center gap-2 rounded-full border border-border/30 bg-surface-1/50 px-3 py-1">
                  <div
                    className="w-2 h-2 rounded-full"
                    style={{ backgroundColor: wsColor }}
                  />
                  <span className="text-xs text-muted-foreground">
                    {selectedWorkspace.name}
                  </span>
                </div>
              )}
            </div>

            {/* Quick Actions */}
            <div className="mb-10">
              <QuickActions
                onOpenProject={onOpenProject}
                onCloneFromUrl={onCloneFromUrl}
                onNewSession={onNewSession}
                onCreateSession={onCreateSession}
                hasWorkspace={hasWorkspace}
              />
            </div>

            {/* Unified Sessions List */}
            <div className="mb-8">
              <SessionsList
                sessions={displaySessions}
                workspaces={workspaces}
                workspaceColors={workspaceColors}
              />
            </div>

            {/* Keyboard shortcut hints */}
            <div className="flex items-center justify-center gap-4 pt-4">
              <ShortcutHint keys={`${modKey}K`} label="Commands" />
              <ShortcutHint keys={`${modKey}N`} label="New session" />
              <ShortcutHint keys={`${modKey}O`} label="Open project" />
              <ShortcutHint keys={`${modKey},`} label="Settings" />
            </div>
          </div>
        </div>
      </div>
    </FullContentLayout>
  );
}
