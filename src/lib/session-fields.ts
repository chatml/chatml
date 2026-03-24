import type { LucideIcon } from 'lucide-react';
import {
  Minus,
  AlertTriangle,
  ArrowUp,
  Equal,
  ArrowDown,
  Lightbulb,
  Map,
  Hammer,
  Eye,
  TestTube,
  Rocket,
  BookOpen,
} from 'lucide-react';
import type { SessionPriority, SessionTaskStatus, SprintPhase, WorktreeSession } from './types';

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

// Sprint phase configuration
// Keep in sync with: backend/models/types.go, agent-runner/src/mcp/tools/sprint.ts, src/lib/types.ts
export interface SprintPhaseOption {
  value: SprintPhase;
  label: string;
  icon: LucideIcon;
  color: string;        // Tailwind text color class (full, for JIT extraction)
  activeClass: string;  // Combined bg + text classes for active state (full, for JIT extraction)
  description: string;
}

export const SPRINT_PHASE_OPTIONS: SprintPhaseOption[] = [
  { value: 'think', label: 'Think', icon: Lightbulb, color: 'text-amber-500', activeClass: 'bg-amber-500/15 text-amber-500', description: 'Challenge assumptions and explore alternatives' },
  { value: 'plan', label: 'Plan', icon: Map, color: 'text-blue-500', activeClass: 'bg-blue-500/15 text-blue-500', description: 'Create detailed implementation plan' },
  { value: 'build', label: 'Build', icon: Hammer, color: 'text-green-500', activeClass: 'bg-green-500/15 text-green-500', description: 'Implement the approved plan' },
  { value: 'review', label: 'Review', icon: Eye, color: 'text-purple-500', activeClass: 'bg-purple-500/15 text-purple-500', description: 'Review changes critically' },
  { value: 'test', label: 'Test', icon: TestTube, color: 'text-teal-500', activeClass: 'bg-teal-500/15 text-teal-500', description: 'Run tests and verify coverage' },
  { value: 'ship', label: 'Ship', icon: Rocket, color: 'text-orange-500', activeClass: 'bg-orange-500/15 text-orange-500', description: 'Create PR and prepare for merge' },
  { value: 'reflect', label: 'Reflect', icon: BookOpen, color: 'text-pink-500', activeClass: 'bg-pink-500/15 text-pink-500', description: 'Summarize lessons learned' },
];

export function getSprintPhaseOption(value: SprintPhase): SprintPhaseOption {
  return SPRINT_PHASE_OPTIONS.find((o) => o.value === value) ?? SPRINT_PHASE_OPTIONS[0];
}

export interface PRStatusInfo {
  text: string;
  color: string;
}

export function getPRStatusInfo(session: WorktreeSession): PRStatusInfo | null {
  const hasPR = session.prStatus && session.prStatus !== 'none';
  if (!hasPR) return null;
  if (session.hasMergeConflict) return { text: 'Merge conflict', color: 'text-text-warning' };
  if (session.hasCheckFailures) return { text: 'Checks failing', color: 'text-text-error' };
  if (session.prStatus === 'merged') return { text: 'Merged', color: 'text-nav-icon-prs' };
  if (session.prStatus === 'closed') return { text: 'Closed', color: 'text-muted-foreground' };
  if (session.prStatus === 'open') {
    if (session.checkStatus === 'pending') return { text: 'Checks running', color: 'text-amber-500' };
    return { text: 'Ready to merge', color: 'text-text-success' };
  }
  return null;
}
