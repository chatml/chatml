'use client';

import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Circle, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useBackgroundTasks } from '@/stores/selectors';
import { useAppStore } from '@/stores/appStore';
import { stopBackgroundTask } from '@/lib/api/conversations';
import { useToast } from '@/components/ui/toast';
import type { BackgroundTask } from '@/lib/types';

function formatTokensCompact(tokens: number): string {
  if (tokens < 1000) return `${tokens}`;
  if (tokens < 10000) return `${(tokens / 1000).toFixed(1)}k`;
  return `${Math.round(tokens / 1000)}k`;
}

function TaskElapsedTime({ startTime }: { startTime: number }) {
  const [elapsed, setElapsed] = useState(() => Math.floor((Date.now() - startTime) / 1000));
  const startRef = useRef(startTime);

  useEffect(() => {
    startRef.current = startTime;
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startRef.current) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [startTime]);

  if (elapsed < 1) return null;
  return (
    <span className="text-2xs text-muted-foreground/70 font-mono tabular-nums shrink-0">
      {elapsed}s
    </span>
  );
}

function formatDuration(startTime: number, endTime?: number): string {
  const ms = (endTime ?? Date.now()) - startTime;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
}

interface TaskRowProps {
  task: BackgroundTask;
  conversationId: string;
}

const TaskRow = memo(function TaskRow({ task, conversationId }: TaskRowProps) {
  const isRunning = task.status === 'running';
  const { error: showError } = useToast();

  const handleStop = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await stopBackgroundTask(conversationId, task.taskId);
      // Optimistically reflect stopped state; task_stopped WS event will confirm
      useAppStore.getState().stopBackgroundTask(conversationId, task.taskId);
    } catch {
      showError('Failed to stop background task');
    }
  }, [conversationId, task.taskId, showError]);

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-surface-2 transition-colors">
      {/* Status indicator */}
      <span className="flex items-center justify-center w-3 h-3 shrink-0">
        {isRunning ? (
          <span className="block w-2 h-2 rounded-full border-[1.5px] border-primary border-t-transparent animate-spin" />
        ) : (
          <Circle className="w-2 h-2 fill-text-success text-text-success" />
        )}
      </span>

      {/* Description */}
      <span className={cn(
        'flex-1 min-w-0 truncate',
        isRunning ? 'text-foreground' : 'text-muted-foreground'
      )}>
        {task.description || 'Background task'}
      </span>

      {/* Last tool name */}
      {task.lastToolName && (
        <span className="text-2xs text-muted-foreground/70 shrink-0 max-w-[120px] truncate">
          {task.lastToolName}
        </span>
      )}

      {/* Elapsed time or duration */}
      {isRunning ? (
        <TaskElapsedTime startTime={task.startTime} />
      ) : task.endTime ? (
        <span className="text-2xs text-muted-foreground/70 font-mono tabular-nums shrink-0">
          {formatDuration(task.startTime, task.endTime)}
        </span>
      ) : null}

      {/* Token usage */}
      {task.usage && task.usage.totalTokens > 0 && (
        <span className="text-2xs text-muted-foreground/70 font-mono tabular-nums shrink-0">
          {formatTokensCompact(task.usage.totalTokens)}
        </span>
      )}

      {/* Stop button */}
      {isRunning && (
        <Button
          variant="ghost"
          size="icon"
          className="h-5 w-5 shrink-0"
          onClick={handleStop}
          title="Stop task"
          aria-label="Stop task"
        >
          <Square className="h-2.5 w-2.5 fill-destructive text-destructive" />
        </Button>
      )}
    </div>
  );
});

interface BackgroundTasksPanelProps {
  conversationId: string | null;
}

export function BackgroundTasksPanel({ conversationId }: BackgroundTasksPanelProps) {
  const tasks = useBackgroundTasks(conversationId);

  if (!conversationId || tasks.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
        No background tasks
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      {tasks.map((task) => (
        <TaskRow key={task.taskId} task={task} conversationId={conversationId} />
      ))}
    </div>
  );
}
