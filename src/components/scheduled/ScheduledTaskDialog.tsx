'use client';

import { useState, useEffect, useMemo } from 'react';
import { useAppStore } from '@/stores/appStore';
import { useScheduledTaskStore } from '@/stores/scheduledTaskStore';
import { useShallow } from 'zustand/react/shallow';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { AlertCircle, Info } from 'lucide-react';
import { MODELS as SHARED_MODELS, toShortDisplayName, getModelDescription, isDefaultRecommended, deduplicateById, deduplicateByName, sortModelEntries } from '@/lib/models';
import type { ScheduledTask, ScheduledTaskFrequency } from '@/lib/types';

interface ScheduledTaskDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editTask?: ScheduledTask | null;
}

const FREQUENCY_OPTIONS: { value: ScheduledTaskFrequency; label: string }[] = [
  { value: 'hourly', label: 'Hourly' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
];

const PERMISSION_OPTIONS = [
  { value: 'default', label: 'Ask permissions' },
  { value: 'acceptEdits', label: 'Accept edits' },
  { value: 'bypassPermissions', label: 'Bypass permissions' },
  { value: 'dontAsk', label: "Don't ask" },
];

const DAY_OF_WEEK_OPTIONS = [
  { value: '0', label: 'Sunday' },
  { value: '1', label: 'Monday' },
  { value: '2', label: 'Tuesday' },
  { value: '3', label: 'Wednesday' },
  { value: '4', label: 'Thursday' },
  { value: '5', label: 'Friday' },
  { value: '6', label: 'Saturday' },
];

export function ScheduledTaskDialog({ open, onOpenChange, editTask }: ScheduledTaskDialogProps) {
  const workspaces = useAppStore(useShallow((s) => s.workspaces));
  const dynamicModels = useAppStore(useShallow((s) => s.supportedModels));
  const { createTask, updateTask } = useScheduledTaskStore();

  const modelOptions = useMemo(() => {
    if (dynamicModels.length === 0) {
      return SHARED_MODELS.map((m) => ({ id: m.id, name: m.name, description: m.description }));
    }
    const entries = dynamicModels
      .filter((m) => !isDefaultRecommended(m.displayName))
      .map((m) => ({ id: m.value, name: toShortDisplayName(m.value, m.displayName), description: getModelDescription(m.value) }));
    return sortModelEntries(deduplicateByName(deduplicateById(entries)));
  }, [dynamicModels]);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [prompt, setPrompt] = useState('');
  const [model, setModel] = useState('');
  const [permissionMode, setPermissionMode] = useState('default');
  const [workspaceId, setWorkspaceId] = useState('');
  const [frequency, setFrequency] = useState<ScheduledTaskFrequency>('daily');
  const [scheduleHour, setScheduleHour] = useState(9);
  const [scheduleMinute, setScheduleMinute] = useState(0);
  const [scheduleDayOfWeek, setScheduleDayOfWeek] = useState(1);
  const [scheduleDayOfMonth, setScheduleDayOfMonth] = useState(1);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const isEditing = !!editTask;

  // Reset state when dialog opens
  useEffect(() => {
    if (!open) return;
    setError('');

    if (editTask) {
      setName(editTask.name);
      setDescription(editTask.description);
      setPrompt(editTask.prompt);
      setModel(editTask.model || '');
      setPermissionMode(editTask.permissionMode || 'default');
      setWorkspaceId(editTask.workspaceId);
      setFrequency(editTask.frequency);
      setScheduleHour(editTask.scheduleHour);
      setScheduleMinute(editTask.scheduleMinute);
      setScheduleDayOfWeek(editTask.scheduleDayOfWeek);
      setScheduleDayOfMonth(editTask.scheduleDayOfMonth);
    } else {
      setName('');
      setDescription('');
      setPrompt('');
      setModel('');
      setPermissionMode('default');
      setWorkspaceId(workspaces[0]?.id || '');
      setFrequency('daily');
      setScheduleHour(9);
      setScheduleMinute(0);
      setScheduleDayOfWeek(1);
      setScheduleDayOfMonth(1);
    }
  }, [open, editTask, workspaces]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!name.trim()) {
      setError('Name is required');
      return;
    }
    if (!prompt.trim()) {
      setError('Prompt is required');
      return;
    }
    if (!workspaceId) {
      setError('Please select a workspace');
      return;
    }

    setLoading(true);
    try {
      if (isEditing) {
        await updateTask(editTask.id, {
          name: name.trim(),
          description: description.trim(),
          prompt: prompt.trim(),
          model: model.trim() || undefined,
          permissionMode,
          frequency,
          scheduleHour,
          scheduleMinute,
          scheduleDayOfWeek,
          scheduleDayOfMonth,
        });
      } else {
        await createTask(workspaceId, {
          name: name.trim(),
          description: description.trim(),
          prompt: prompt.trim(),
          model: model.trim() || undefined,
          permissionMode,
          frequency,
          scheduleHour,
          scheduleMinute,
          scheduleDayOfWeek,
          scheduleDayOfMonth,
        });
      }
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save task');
    } finally {
      setLoading(false);
    }
  };

  const timeValue = `${String(scheduleHour).padStart(2, '0')}:${String(scheduleMinute).padStart(2, '0')}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEditing ? 'Edit scheduled task' : 'New scheduled task'}</DialogTitle>
          <DialogDescription>
            <span className="flex items-center gap-1.5 text-xs mt-1">
              <Info className="w-3.5 h-3.5" />
              Local tasks only run while your computer is awake.
            </span>
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit}>
          <div className="space-y-4 py-2">
            {/* Name */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium">
                Name <span className="text-destructive">*</span>
              </label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="daily-code-review"
                autoFocus
              />
            </div>

            {/* Description */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Description</label>
              <Input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Review yesterday's commits and flag anything concerning"
              />
            </div>

            {/* Prompt */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium">
                Prompt <span className="text-destructive">*</span>
              </label>
              <Textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Look at the commits from the last 24 hours. Summarize what changed, call out any risky patterns or missing tests, and note anything worth following up on."
                rows={4}
                className="resize-none"
              />
            </div>

            {/* Permission mode & Model row */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Permissions</label>
                <Select value={permissionMode} onValueChange={setPermissionMode}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PERMISSION_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Model</label>
                <Select value={model} onValueChange={setModel}>
                  <SelectTrigger>
                    <SelectValue placeholder="Default" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value=" " textValue="Default">
                      <span className="text-muted-foreground">Default</span>
                    </SelectItem>
                    {modelOptions.map((m) => (
                      <SelectItem key={m.id} value={m.id} textValue={m.name}>
                        <div className="flex flex-col">
                          <span>{m.name}</span>
                          {m.description && (
                            <span className="text-xs text-muted-foreground">{m.description}</span>
                          )}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Workspace */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Workspace</label>
              <Select
                value={workspaceId}
                onValueChange={setWorkspaceId}
                disabled={isEditing}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select workspace" />
                </SelectTrigger>
                <SelectContent>
                  {workspaces.map((ws) => (
                    <SelectItem key={ws.id} value={ws.id}>
                      {ws.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Frequency section */}
            <div className="space-y-3 pt-2 border-t">
              <h3 className="text-sm font-semibold">Frequency</h3>
              <Select
                value={frequency}
                onValueChange={(v) => setFrequency(v as ScheduledTaskFrequency)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FREQUENCY_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* Time picker */}
              {frequency !== 'hourly' && (
                <div className="flex items-center gap-3">
                  <input
                    type="time"
                    value={timeValue}
                    onChange={(e) => {
                      const [h, m] = e.target.value.split(':').map(Number);
                      if (!isNaN(h)) setScheduleHour(h);
                      if (!isNaN(m)) setScheduleMinute(m);
                    }}
                    className="h-9 px-3 rounded-md border bg-background text-sm"
                  />
                </div>
              )}

              {frequency === 'hourly' && (
                <div className="flex items-center gap-2">
                  <label className="text-sm text-muted-foreground">At minute:</label>
                  <Input
                    type="number"
                    min={0}
                    max={59}
                    value={scheduleMinute}
                    onChange={(e) => setScheduleMinute(Number(e.target.value))}
                    className="w-20"
                  />
                </div>
              )}

              {/* Day of week (weekly) */}
              {frequency === 'weekly' && (
                <Select
                  value={String(scheduleDayOfWeek)}
                  onValueChange={(v) => setScheduleDayOfWeek(Number(v))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DAY_OF_WEEK_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}

              {/* Day of month (monthly) */}
              {frequency === 'monthly' && (
                <div className="flex items-center gap-2">
                  <label className="text-sm text-muted-foreground">Day of month:</label>
                  <Input
                    type="number"
                    min={1}
                    max={28}
                    value={scheduleDayOfMonth}
                    onChange={(e) => setScheduleDayOfMonth(Number(e.target.value))}
                    className="w-20"
                  />
                </div>
              )}

              <p className="text-xs text-muted-foreground">
                Scheduled tasks use a randomized delay of several minutes.
              </p>
            </div>

            {/* Error */}
            {error && (
              <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 p-3 rounded-lg">
                <AlertCircle className="w-4 h-4 shrink-0" />
                {error}
              </div>
            )}
          </div>

          <DialogFooter className="mt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading || !name.trim() || !prompt.trim()}>
              {loading ? 'Saving...' : isEditing ? 'Save changes' : 'Create task'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
