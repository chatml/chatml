'use client';

import { useNavigationStore, type NavigationEntry } from '@/stores/navigationStore';
import { useAppStore } from '@/stores/appStore';
import { useShallow } from 'zustand/react/shallow';
import { useSettingsStore } from '@/stores/settingsStore';
import { buildNavigationLabel, goToBackEntry, goToForwardEntry } from '@/lib/navigation';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  MessageSquare,
  LayoutDashboard,
  GitBranch,
  GitPullRequest,
  FolderGit2,
  Layers,
  Circle,
} from 'lucide-react';
import { cn } from '@/lib/utils';

function EntryIcon({ contentViewType, className }: { contentViewType: string; className?: string }) {
  switch (contentViewType) {
    case 'conversation':
      return <MessageSquare className={className} />;
    case 'global-dashboard':
    case 'workspace-dashboard':
      return <LayoutDashboard className={className} />;
    case 'branches':
      return <GitBranch className={className} />;
    case 'pr-dashboard':
      return <GitPullRequest className={className} />;
    case 'repositories':
      return <FolderGit2 className={className} />;
    case 'session-manager':
      return <Layers className={className} />;
    default:
      return <Circle className={className} />;
  }
}

function formatRelativeTime(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

interface HistoryEntryRowProps {
  entry: NavigationEntry;
  onClick: () => void;
  isCurrent?: boolean;
}

function HistoryEntryRow({ entry, onClick, isCurrent }: HistoryEntryRowProps) {
  return (
    <button
      onClick={isCurrent ? undefined : onClick}
      disabled={isCurrent}
      className={cn(
        'flex items-center gap-2 w-full px-3 py-1.5 text-left text-sm',
        isCurrent
          ? 'bg-accent font-medium cursor-default'
          : 'hover:bg-accent/50 cursor-pointer'
      )}
    >
      <EntryIcon contentViewType={entry.contentView.type} className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
      <span className="truncate flex-1">{entry.label}</span>
      {!isCurrent && (
        <span className="text-[10px] text-muted-foreground shrink-0">
          {formatRelativeTime(entry.timestamp)}
        </span>
      )}
    </button>
  );
}

export function NavigationHistoryPopover({ onClose }: { onClose?: () => void }) {
  const activeTabId = useNavigationStore((s) => s.activeTabId);
  const tab = useNavigationStore((s) => s.tabs[activeTabId]);
  const contentView = useSettingsStore((s) => s.contentView);

  const backStack = tab?.backStack ?? [];
  const forwardStack = tab?.forwardStack ?? [];

  // Subscribe reactively so the label updates if data changes while the popover is open
  const { selectedSessionId, selectedConversationId, sessions, conversations, workspaces } =
    useAppStore(useShallow((s) => ({
      selectedSessionId: s.selectedSessionId,
      selectedConversationId: s.selectedConversationId,
      sessions: s.sessions,
      conversations: s.conversations,
      workspaces: s.workspaces,
    })));
  const currentLabel = buildNavigationLabel(contentView, {
    selectedSessionId,
    selectedConversationId,
    sessions,
    conversations,
    workspaces,
  });

  const handleBackClick = (displayIndex: number) => {
    goToBackEntry(displayIndex);
    onClose?.();
  };

  const handleForwardClick = (actualIndex: number) => {
    goToForwardEntry(actualIndex);
    onClose?.();
  };

  if (backStack.length === 0 && forwardStack.length === 0) {
    return (
      <div className="py-6 px-3 text-center text-sm text-muted-foreground">
        No navigation history
      </div>
    );
  }

  // Display layout (top to bottom): forward oldest→newest, current, back newest→oldest
  //
  // Forward stack array order: [oldest, ..., newest].
  // We render in natural array order (oldest at top, newest near current).
  // goToForwardIndex expects: index 0 = most recent = last in array.
  // So display index i maps to forwardStack actual index i, and we pass i
  // directly — goToForwardIndex does actualIndex = length-1-index internally.
  // Since we render in array order (not reversed), display index i corresponds
  // to the entry at forwardStack[i]. We need actualIndex = i, so we pass
  // (forwardStack.length - 1 - i) to invert goToForwardIndex's reversal.
  //
  // Back stack array order: [oldest, ..., newest].
  // We reverse for display (newest at top). reversedBack[i] = backStack[len-1-i].
  // goToBackIndex expects: index 0 = most recent = last in array.
  // So display index i in reversedBack IS the correct goToBackIndex index.
  const reversedBack = [...backStack].reverse();

  return (
    <ScrollArea className="max-h-80">
      <div className="py-1">
        {/* Forward entries (where you can go forward to) — oldest at top, newest near current */}
        {forwardStack.map((entry, i) => (
          <HistoryEntryRow
            key={`fwd-${entry.timestamp}`}
            entry={entry}
            onClick={() => handleForwardClick(forwardStack.length - 1 - i)}
          />
        ))}

        {/* Current location */}
        <div className="flex items-center gap-2 w-full px-3 py-1.5 bg-accent font-medium text-sm">
          <EntryIcon contentViewType={contentView.type} className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <span className="truncate flex-1">{currentLabel}</span>
        </div>

        {/* Back entries (where you came from) — newest at top, oldest at bottom */}
        {reversedBack.map((entry, i) => (
          <HistoryEntryRow
            key={`back-${entry.timestamp}`}
            entry={entry}
            onClick={() => handleBackClick(i)}
          />
        ))}
      </div>
    </ScrollArea>
  );
}
