'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
import { useScheduledTaskStore } from '@/stores/scheduledTaskStore';
import { useAppStore } from '@/stores/appStore';
import { useShallow } from 'zustand/react/shallow';
import { FullContentLayout } from '@/components/layout/FullContentLayout';
import { useMainToolbarContent } from '@/hooks/useMainToolbarContent';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { AlertCircle, Clock, Plus, RefreshCw, MoreVertical, Play, Pencil, Trash2, Info } from 'lucide-react';
import { ScheduledTaskDialog } from './ScheduledTaskDialog';
import type { ScheduledTask } from '@/lib/types';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

function formatSchedule(task: ScheduledTask): string {
  const time = `${String(task.scheduleHour).padStart(2, '0')}:${String(task.scheduleMinute).padStart(2, '0')}`;
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  switch (task.frequency) {
    case 'hourly':
      return `Every hour at :${String(task.scheduleMinute).padStart(2, '0')}`;
    case 'daily':
      return `Every day at ${time}`;
    case 'weekly':
      return `Every ${days[task.scheduleDayOfWeek]} at ${time}`;
    case 'monthly':
      return `Monthly on the ${task.scheduleDayOfMonth}${ordinalSuffix(task.scheduleDayOfMonth)} at ${time}`;
    default:
      return `Every day at ${time}`;
  }
}

function ordinalSuffix(n: number): string {
  if (n >= 11 && n <= 13) return 'th';
  switch (n % 10) {
    case 1: return 'st';
    case 2: return 'nd';
    case 3: return 'rd';
    default: return 'th';
  }
}

export function ScheduledTasksDashboard() {
  const { tasks, isLoading, error, fetchTasks, toggleEnabled, deleteTask, triggerNow } =
    useScheduledTaskStore();
  const workspaces = useAppStore(useShallow((s) => s.workspaces));

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<ScheduledTask | null>(null);
  const [deletingTask, setDeletingTask] = useState<ScheduledTask | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  const workspaceMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const ws of workspaces) {
      map[ws.id] = ws.name;
    }
    return map;
  }, [workspaces]);

  const handleEdit = useCallback((task: ScheduledTask) => {
    setEditingTask(task);
    setDialogOpen(true);
  }, []);

  const handleNewTask = useCallback(() => {
    setEditingTask(null);
    setDialogOpen(true);
  }, []);

  const handleTriggerNow = useCallback(async (taskId: string) => {
    setActionError(null);
    try {
      await triggerNow(taskId);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to trigger task');
    }
  }, [triggerNow]);

  const handleConfirmDelete = useCallback(async () => {
    if (!deletingTask) return;
    setActionError(null);
    try {
      await deleteTask(deletingTask.id);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to delete task');
    } finally {
      setDeletingTask(null);
    }
  }, [deletingTask, deleteTask]);

  const handleDialogClose = useCallback(() => {
    setDialogOpen(false);
    setEditingTask(null);
  }, []);

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
          <Button variant="ghost" size="icon" onClick={fetchTasks} className="h-7 w-7">
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      ),
    }),
    [isLoading, fetchTasks]
  );
  useMainToolbarContent(toolbarConfig);

  return (
    <FullContentLayout>
      <div className="h-full flex flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto">
          {/* Page header */}
          <div className="px-6 pt-6 pb-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-2xl font-bold">Scheduled tasks</h2>
                <p className="text-muted-foreground mt-1">
                  Run tasks on a schedule or whenever you need them.
                </p>
              </div>
              <Button onClick={handleNewTask} className="gap-1.5">
                <Plus className="w-4 h-4" />
                New task
              </Button>
            </div>
          </div>

          {/* Info banner */}
          <div className="mx-6 mb-4 flex items-center gap-2 text-sm text-muted-foreground bg-muted/50 border rounded-lg px-4 py-3">
            <Info className="w-4 h-4 shrink-0" />
            Local tasks only run while your computer is awake.
          </div>

          {/* Action error */}
          {actionError && (
            <div className="mx-6 mb-4 flex items-center gap-2 text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-4 py-3">
              <AlertCircle className="w-4 h-4 shrink-0" />
              {actionError}
              <Button variant="ghost" size="sm" className="ml-auto h-6 px-2 text-xs" onClick={() => setActionError(null)}>
                Dismiss
              </Button>
            </div>
          )}

          {/* Loading state */}
          {isLoading && tasks.length === 0 && (
            <div className="flex items-center justify-center py-20">
              <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          )}

          {/* Error state */}
          {error && (
            <div className="text-center py-12">
              <p className="text-destructive">{error}</p>
              <Button variant="outline" onClick={fetchTasks} className="mt-4">
                Retry
              </Button>
            </div>
          )}

          {/* Empty state */}
          {!isLoading && !error && tasks.length === 0 && (
            <div className="text-center py-20">
              <Clock className="h-12 w-12 text-muted-foreground/40 mx-auto mb-4" />
              <p className="text-muted-foreground text-lg">No scheduled tasks yet.</p>
              <p className="text-muted-foreground text-sm mt-1">
                Create a task to run on a recurring schedule.
              </p>
              <Button onClick={handleNewTask} className="mt-4 gap-1.5">
                <Plus className="w-4 h-4" />
                New task
              </Button>
            </div>
          )}

          {/* Task cards */}
          {tasks.length > 0 && (
            <div className="px-6 pb-6 grid grid-cols-1 md:grid-cols-2 gap-3">
              {tasks.map((task) => (
                <div
                  key={task.id}
                  className="border rounded-lg p-4 bg-card hover:bg-accent/30 transition-colors"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold truncate">{task.name}</h3>
                        <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground border">
                          Local
                        </span>
                      </div>
                      {task.description && (
                        <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                          {task.description}
                        </p>
                      )}
                      {workspaceMap[task.workspaceId] && (
                        <p className="text-xs text-muted-foreground mt-1.5">
                          {workspaceMap[task.workspaceId]}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <Switch
                        checked={task.enabled}
                        onCheckedChange={() => toggleEnabled(task.id)}
                      />
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-7 w-7">
                            <MoreVertical className="w-3.5 h-3.5" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => handleTriggerNow(task.id)}>
                            <Play className="w-3.5 h-3.5 mr-2" />
                            Run now
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleEdit(task)}>
                            <Pencil className="w-3.5 h-3.5 mr-2" />
                            Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => setDeletingTask(task)}
                            className="text-destructive focus:text-destructive"
                          >
                            <Trash2 className="w-3.5 h-3.5 mr-2" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>

                  {/* Schedule badge */}
                  <div className="mt-3">
                    <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full border border-green-200 dark:border-green-800 text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-950">
                      <Clock className="w-3 h-3" />
                      {formatSchedule(task)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <ScheduledTaskDialog
        open={dialogOpen}
        onOpenChange={handleDialogClose}
        editTask={editingTask}
      />

      {/* Delete confirmation dialog */}
      <Dialog open={!!deletingTask} onOpenChange={(open) => !open && setDeletingTask(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete scheduled task</DialogTitle>
            <DialogDescription>
              This will permanently delete &ldquo;{deletingTask?.name}&rdquo; and all its run history. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeletingTask(null)}>
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
