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

  return (
    <FullContentLayout
      title="Home"
      onOpenSettings={onOpenSettings}
      onOpenShortcuts={onOpenShortcuts}
      showLeftSidebar={showLeftSidebar}
    >
      <div className="h-full overflow-y-auto bg-content-background">
        <div className="max-w-2xl mx-auto px-6 pt-14 pb-16 stagger-children">
          {/* Mascot + Brand Hero */}
          <div className="flex flex-col items-center text-center mb-10">
            {/* Mascot with ambient glow */}
            <div className="relative mb-6">
              <div className="absolute inset-0 rounded-full bg-brand/15 blur-[40px] pointer-events-none" />
              <div className="relative w-20 h-20 rounded-full ring-[2.5px] ring-brand/40 ring-offset-[3px] ring-offset-background overflow-hidden shadow-xl shadow-brand/15">
                <Image
                  src="/mascot.png"
                  alt="ChatML mascot"
                  width={80}
                  height={80}
                  className="w-full h-full object-cover"
                  priority
                />
              </div>
            </div>

            {/* Brand wordmark */}
            <h1 className="font-mono font-bold text-2xl tracking-[-0.05em] mb-2">
              <span className="text-foreground/60">chat</span>
              <span className="text-brand">ml</span>
            </h1>

            {/* Contextual subtitle */}
            <p className="text-sm text-muted-foreground">
              What would you like to work on?
            </p>
          </div>

          {/* Hero Action Grid */}
          <div className="mb-10">
            <QuickActions
              onOpenProject={onOpenProject}
              onCloneFromUrl={onCloneFromUrl}
              onNewSession={onNewSession}
              onCreateSession={onCreateSession}
              hasWorkspace={hasWorkspace}
            />
          </div>

          {/* Live Activity Strip */}
          <div className="mb-10">
            <LiveActivityStrip
              sessions={nonArchivedSessions}
              workspaces={workspaces}
              workspaceColors={workspaceColors}
            />
          </div>

          {/* Recent Sessions */}
          <div className="mb-10">
            <RecentSessions
              sessions={recentSessions}
              workspaces={workspaces}
              workspaceColors={workspaceColors}
            />
          </div>

          {/* Cmd+K hint */}
          <p className="text-center text-xs text-muted-foreground/60 pt-4">
            Press{' '}
            <kbd className="inline-flex items-center justify-center min-w-[1.5rem] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-mono text-xs">
              {modKey}K
            </kbd>{' '}
            for commands
          </p>
        </div>
      </div>
    </FullContentLayout>
  );
}
