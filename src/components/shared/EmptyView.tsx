'use client';

import { useMemo } from 'react';
import Image from 'next/image';
import { useWorkspaceSelection } from '@/stores/selectors';
import { useSettingsStore } from '@/stores/settingsStore';
import { isMacOS } from '@/lib/platform';
import { FullContentLayout } from '@/components/layout/FullContentLayout';
import { QuickActions } from './smart-launcher/QuickActions';
import { RecentSessions } from './smart-launcher/RecentSessions';
import { LiveActivityStrip } from './smart-launcher/LiveActivityStrip';

interface EmptyViewProps {
  onOpenProject: () => void;
  onCloneFromUrl: () => void;
  onNewSession: () => void;
  onCreateSession: () => void;
  onOpenSettings?: () => void;
  onOpenShortcuts?: () => void;
  showLeftSidebar?: boolean;
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

  const recentSessions = useMemo(
    () =>
      [...nonArchivedSessions]
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
        .slice(0, 5),
    [nonArchivedSessions]
  );

  const hasWorkspace = !!selectedWorkspaceId;
  const modKey = isMacOS() ? '⌘' : 'Ctrl+';

  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
  }, []);

  return (
    <FullContentLayout
      title="Home"
      onOpenSettings={onOpenSettings}
      onOpenShortcuts={onOpenShortcuts}
      showLeftSidebar={showLeftSidebar}
    >
      <div className="h-full overflow-y-auto bg-content-background">
        <div className="max-w-xl mx-auto px-6 pt-8 pb-16 stagger-children">
          {/* Compact Hero */}
          <div className="flex items-center gap-3 mb-8">
            <div className="relative shrink-0">
              <div className="absolute inset-0 rounded-full bg-brand/10 blur-xl pointer-events-none" />
              <div className="relative w-10 h-10 rounded-full ring-1 ring-border/50 overflow-hidden">
                <Image
                  src="/mascot.png"
                  alt="ChatML mascot"
                  width={40}
                  height={40}
                  className="w-full h-full object-cover"
                  priority
                />
              </div>
            </div>
            <div>
              <h1 className="text-base font-semibold text-foreground">
                {greeting}
              </h1>
              <p className="text-sm text-muted-foreground">
                What would you like to work on?
              </p>
            </div>
          </div>

          {/* Hero Action Grid */}
          <div className="mb-6">
            <QuickActions
              onOpenProject={onOpenProject}
              onCloneFromUrl={onCloneFromUrl}
              onNewSession={onNewSession}
              onCreateSession={onCreateSession}
              hasWorkspace={hasWorkspace}
            />
          </div>

          {/* Live Activity Strip */}
          <div className="mb-6">
            <LiveActivityStrip
              sessions={nonArchivedSessions}
              workspaces={workspaces}
              workspaceColors={workspaceColors}
            />
          </div>

          {/* Recent Sessions */}
          <div className="mb-8">
            <RecentSessions
              sessions={recentSessions}
              workspaces={workspaces}
              workspaceColors={workspaceColors}
            />
          </div>

          {/* Cmd+K hint */}
          <p className="text-center text-[11px] text-muted-foreground/40 pt-2">
            {modKey}K for commands
          </p>
        </div>
      </div>
    </FullContentLayout>
  );
}
