'use client';

import { X, TerminalSquare, ListTodo } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/stores/appStore';
import { useBottomPanelActiveTab, useBackgroundTasks } from '@/stores/selectors';
import { BottomTerminal } from './BottomTerminal';
import { BackgroundTasksPanel } from './BackgroundTasksPanel';

interface BottomPanelProps {
  currentSessionId: string | null;
  currentConversationId: string | null;
  currentWorkspacePath: string | null;
  isExpanded: boolean;
  onHide: () => void;
}

export function BottomPanel({
  currentSessionId,
  currentConversationId,
  currentWorkspacePath,
  isExpanded,
  onHide,
}: BottomPanelProps) {
  const activeTab = useBottomPanelActiveTab(currentSessionId);
  const tasks = useBackgroundTasks(currentConversationId);
  const runningCount = tasks.filter((t) => t.status === 'running').length;

  const setTab = (tab: 'terminal' | 'tasks') => {
    if (currentSessionId) {
      useAppStore.getState().setBottomPanelActiveTab(currentSessionId, tab);
    }
  };

  return (
    <div className="flex flex-col h-full bg-background border-t">
      {/* Top-level tab bar */}
      <div className="flex items-center gap-1 px-2 py-1 border-b bg-muted/30 shrink-0">
        <div className="flex items-center gap-1 flex-1 min-w-0">
          {/* Terminal tab */}
          <button
            role="tab"
            aria-selected={activeTab === 'terminal'}
            onClick={() => setTab('terminal')}
            className={cn(
              'flex items-center gap-1 px-2 py-1 text-xs rounded-sm shrink-0',
              'hover:bg-surface-2 transition-colors',
              activeTab === 'terminal'
                ? 'bg-accent text-accent-foreground'
                : 'text-muted-foreground'
            )}
          >
            <TerminalSquare className="h-3 w-3" />
            <span>Terminal</span>
          </button>

          {/* Tasks tab */}
          <button
            role="tab"
            aria-selected={activeTab === 'tasks'}
            onClick={() => setTab('tasks')}
            className={cn(
              'flex items-center gap-1 px-2 py-1 text-xs rounded-sm shrink-0',
              'hover:bg-surface-2 transition-colors',
              activeTab === 'tasks'
                ? 'bg-accent text-accent-foreground'
                : 'text-muted-foreground'
            )}
          >
            <ListTodo className="h-3 w-3" />
            <span>Tasks</span>
            {runningCount > 0 && (
              <span className="ml-0.5 px-1 py-0 text-2xs rounded-full bg-primary/20 text-primary font-medium tabular-nums">
                {runningCount}
              </span>
            )}
          </button>
        </div>

        {/* Close button */}
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 shrink-0"
          onClick={onHide}
          title="Hide panel"
          aria-label="Hide panel"
        >
          <X className="h-3 w-3" />
        </Button>
      </div>

      {/* Tab content */}
      <div className="flex-1 min-h-0">
        {activeTab === 'terminal' ? (
          <BottomTerminal
            currentSessionId={currentSessionId}
            currentWorkspacePath={currentWorkspacePath}
            isExpanded={isExpanded}
            onHide={onHide}
          />
        ) : (
          <BackgroundTasksPanel conversationId={currentConversationId} />
        )}
      </div>
    </div>
  );
}
