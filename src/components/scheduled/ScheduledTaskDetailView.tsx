'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
import { useScheduledTaskStore } from '@/stores/scheduledTaskStore';
import { useAppStore } from '@/stores/appStore';
import { useShallow } from 'zustand/react/shallow';
import { FullContentLayout } from '@/components/layout/FullContentLayout';
import { useMainToolbarContent } from '@/hooks/useMainToolbarContent';
import { navigate } from '@/lib/navigation';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertCircle,
  ChevronLeft,
  Clock,
  Folder,
  Pencil,
  Play,
  RefreshCw,
  Shield,
  Trash2,
} from 'lucide-react';
import { ScheduledTaskDialog } from './ScheduledTaskDialog';
import {
  formatSchedule,
  formatNextRun,
  formatRunTimestamp,
  getRunStatusDisplay,
} from './scheduled-utils';

interface ScheduledTaskDetailViewProps {
  taskId: string;
}

export function ScheduledTaskDetailView({ taskId }: ScheduledTaskDetailViewProps) {
  const { tasks, runs, fetchTasks, fetchRuns, toggleEnabled, deleteTask, triggerNow } =
    useScheduledTaskStore();
  const workspaces = useAppStore(useShallow((s) => s.workspaces));

  const task = useMemo(() => tasks.find((t) => t.id === taskId), [tasks, taskId]);
  const taskRuns = runs[taskId] ?? [];
  const workspace = useMemo(
    () => (task ? workspaces.find((w) => w.id === task.workspaceId) : undefined),
    [task, workspaces],
  );

  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isTriggering, setIsTriggering] = useState(false);

  useEffect(() => {
    fetchTasks();
    fetchRuns(taskId);
  }, [taskId, fetchTasks, fetchRuns]);

  // If task was deleted or not found (after tasks have loaded), navigate back
  const isLoading = useScheduledTaskStore((s) => s.isLoading);
  useEffect(() => {
    if (!task && !isLoading && tasks.length > 0) {
      navigate({ contentView: { type: 'scheduled-tasks' } });
    }
  }, [task, isLoading, tasks.length]);

  const handleBack = useCallback(() => {
    navigate({ contentView: { type: 'scheduled-tasks' } });
  }, []);

  const handleTriggerNow = useCallback(async () => {
    setActionError(null);
    setIsTriggering(true);
    try {
      await triggerNow(taskId);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to trigger task');
    } finally {
      setIsTriggering(false);
    }
  }, [taskId, triggerNow]);

  const handleConfirmDelete = useCallback(async () => {
    setActionError(null);
    try {
      await deleteTask(taskId);
      navigate({ contentView: { type: 'scheduled-tasks' } });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to delete task');
    } finally {
      setDeleteDialogOpen(false);
    }
  }, [taskId, deleteTask]);

  const handleToggleEnabled = useCallback(async () => {
    setActionError(null);
    try {
      await toggleEnabled(taskId);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to update task');
    }
  }, [taskId, toggleEnabled]);

  const handleRunClick = useCallback(
    (sessionId?: string) => {
      if (!sessionId || !task) return;
      navigate({
        workspaceId: task.workspaceId,
        sessionId,
        contentView: { type: 'conversation' },
      });
    },
    [task],
  );

  const toolbarConfig = useMemo(
    () => ({
      titlePosition: 'center' as const,
      title: (
        <span className="flex items-center gap-1.5 text-sm font-medium">
          <Clock className="w-4 h-4" />
          Scheduled
        </span>
      ),
      actions: (
        <div className="flex items-center gap-1.5">
          <Button variant="ghost" size="icon" onClick={() => fetchTasks()} className="h-7 w-7">
            <RefreshCw className="w-3.5 h-3.5" />
          </Button>
        </div>
      ),
    }),
    [fetchTasks],
  );
  useMainToolbarContent(toolbarConfig);

  if (!task) {
    return (
      <FullContentLayout>
        <div className="flex items-center justify-center h-full">
          {isLoading ? (
            <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
          ) : (
            <p className="text-sm text-muted-foreground">Task not found.</p>
          )}
        </div>
      </FullContentLayout>
    );
  }

  const permissionLabel =
    task.permissionMode === 'default'
      ? 'Ask permissions'
      : task.permissionMode === 'acceptEdits'
        ? 'Accept edits'
        : task.permissionMode === 'bypassPermissions'
          ? 'Bypass permissions'
          : task.permissionMode === 'plan'
            ? "Don't ask"
            : task.permissionMode;

  return (
    <FullContentLayout>
      <div className="h-full flex flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto">
          {/* Breadcrumb */}
          <div className="px-6 pt-4">
            <button
              onClick={handleBack}
              className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
              All scheduled tasks
            </button>
          </div>

          {/* Header */}
          <div className="px-6 pt-4 pb-2">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h2 className="text-2xl font-bold truncate">{task.name}</h2>
                <div className="flex items-center gap-2 mt-1.5">
                  <Badge
                    variant={task.enabled ? 'default' : 'secondary'}
                    className={
                      task.enabled
                        ? 'bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-400 border-green-200 dark:border-green-800'
                        : ''
                    }
                  >
                    {task.enabled ? 'Active' : 'Paused'}
                  </Badge>
                  <span className="text-sm text-muted-foreground">
                    {task.enabled
                      ? `Next run ${formatNextRun(task.nextRunAt)}`
                      : 'Disabled'}
                  </span>
                </div>
              </div>

              {/* Action buttons */}
              <div className="flex items-center gap-1.5 shrink-0">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => setEditDialogOpen(true)}
                >
                  <Pencil className="w-4 h-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-destructive hover:text-destructive"
                  onClick={() => setDeleteDialogOpen(true)}
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
                <Button
                  onClick={handleTriggerNow}
                  disabled={isTriggering}
                  className="gap-1.5"
                >
                  {isTriggering ? (
                    <RefreshCw className="w-4 h-4 animate-spin" />
                  ) : (
                    <Play className="w-4 h-4" />
                  )}
                  Run now
                </Button>
              </div>
            </div>
          </div>

          {/* Action error */}
          {actionError && (
            <div className="mx-6 mb-4 flex items-center gap-2 text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-4 py-3">
              <AlertCircle className="w-4 h-4 shrink-0" />
              {actionError}
              <Button
                variant="ghost"
                size="sm"
                className="ml-auto h-6 px-2 text-xs"
                onClick={() => setActionError(null)}
              >
                Dismiss
              </Button>
            </div>
          )}

          {/* Configuration sections */}
          <div className="px-6 py-4 space-y-6">
            {/* Description & Instructions row */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Description */}
              {task.description && (
                <div>
                  <h3 className="text-sm font-medium text-muted-foreground mb-1.5">Description</h3>
                  <p className="text-sm">{task.description}</p>
                </div>
              )}

              {/* Instructions */}
              <div className={task.description ? '' : 'lg:col-span-2'}>
                <h3 className="text-sm font-medium text-muted-foreground mb-1.5">Instructions</h3>
                <div className="text-sm bg-muted/50 border rounded-lg px-4 py-3 whitespace-pre-wrap max-h-40 overflow-y-auto">
                  {task.prompt}
                </div>
              </div>
            </div>

            {/* Folder & Repeats row */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Folder */}
              <div>
                <h3 className="text-sm font-medium text-muted-foreground mb-1.5">Folder</h3>
                <div className="flex items-center gap-2 text-sm">
                  <Folder className="w-4 h-4 text-muted-foreground shrink-0" />
                  <span className="truncate">{workspace?.name ?? task.workspaceId}</span>
                </div>
              </div>

              {/* Repeats */}
              <div>
                <h3 className="text-sm font-medium text-muted-foreground mb-1.5">Repeats</h3>
                <div className="flex items-center gap-3">
                  <Switch checked={task.enabled} onCheckedChange={handleToggleEnabled} />
                  <span className="text-sm">{formatSchedule(task)}</span>
                </div>
              </div>
            </div>

            {/* Permissions */}
            <div>
              <h3 className="text-sm font-medium text-muted-foreground mb-1.5">Permissions</h3>
              <div className="flex items-center gap-2 text-sm">
                <Shield className="w-4 h-4 text-muted-foreground shrink-0" />
                <span>{permissionLabel}</span>
              </div>
            </div>

            {/* Divider */}
            <div className="border-t" />

            {/* History */}
            <div>
              <h3 className="text-sm font-medium text-muted-foreground mb-3">History</h3>
              {taskRuns.length === 0 ? (
                <p className="text-sm text-muted-foreground">No runs yet.</p>
              ) : (
                <div className="space-y-1">
                  {taskRuns.map((run) => {
                    const statusDisplay = getRunStatusDisplay(run.status);
                    const timestamp = run.startedAt ?? run.triggeredAt;
                    return (
                      <div key={run.id}>
                        <button
                          onClick={() => handleRunClick(run.sessionId)}
                          disabled={!run.sessionId}
                          className="flex items-center justify-between w-full px-3 py-2 rounded-md text-sm hover:bg-accent/50 transition-colors disabled:opacity-50 disabled:cursor-default disabled:hover:bg-transparent text-left"
                        >
                          <span className="text-muted-foreground">
                            {formatRunTimestamp(timestamp)}
                          </span>
                          <span className={statusDisplay.className}>
                            {statusDisplay.label}
                          </span>
                        </button>
                        {run.errorMessage && (run.status === 'failed' || run.status === 'skipped') && (
                          <p className="px-3 pb-1 text-xs text-muted-foreground/70">
                            {run.errorMessage}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Edit dialog */}
      <ScheduledTaskDialog
        open={editDialogOpen}
        onOpenChange={(open) => !open && setEditDialogOpen(false)}
        editTask={task}
      />

      {/* Delete confirmation dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={(open) => !open && setDeleteDialogOpen(false)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete scheduled task</DialogTitle>
            <DialogDescription>
              This will permanently delete &ldquo;{task.name}&rdquo; and all its run history. This
              cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleConfirmDelete}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </FullContentLayout>
  );
}
