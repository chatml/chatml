import type { LucideIcon } from 'lucide-react';
import {
  Minus,
  AlertTriangle,
  ArrowUp,
  Equal,
  ArrowDown,
} from 'lucide-react';
import type { SessionPriority, SessionTaskStatus } from './types';

export interface PriorityOption {
  value: SessionPriority;
  label: string;
  icon: LucideIcon;
  color: string;
}

export const PRIORITY_OPTIONS: PriorityOption[] = [
  { value: 0, label: 'No priority', icon: Minus, color: 'text-muted-foreground' },
  { value: 1, label: 'Urgent', icon: AlertTriangle, color: 'text-text-error' },
  { value: 2, label: 'High', icon: ArrowUp, color: 'text-orange-500' },
  { value: 3, label: 'Medium', icon: Equal, color: 'text-yellow-500' },
  { value: 4, label: 'Low', icon: ArrowDown, color: 'text-blue-400' },
];

export interface TaskStatusOption {
  value: SessionTaskStatus;
  label: string;
}

export const TASK_STATUS_OPTIONS: TaskStatusOption[] = [
  { value: 'backlog', label: 'Backlog' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'in_review', label: 'In Review' },
  { value: 'done', label: 'Done' },
  { value: 'cancelled', label: 'Cancelled' },
];

export function getPriorityOption(value: number): PriorityOption {
  return PRIORITY_OPTIONS.find((o) => o.value === value) ?? PRIORITY_OPTIONS[0];
}

export function getTaskStatusOption(value: string): TaskStatusOption {
  return TASK_STATUS_OPTIONS.find((o) => o.value === value) ?? TASK_STATUS_OPTIONS[0];
}
