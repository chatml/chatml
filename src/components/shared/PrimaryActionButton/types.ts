import type { LucideIcon } from 'lucide-react';

export type PrimaryActionType =
  | 'resolve-conflicts'
  | 'fix-issues'
  | 'continue-rebase'
  | 'continue-merge'
  | 'continue-cherry-pick'
  | 'continue-revert'
  | 'sync-branch'
  | 'create-pr'
  | 'view-pr'
  | 'merge-pr'
  | 'archive-session'
  // Sprint phase actions
  | 'sprint-think'
  | 'sprint-review'
  | 'sprint-test'
  | 'sprint-ship'
  | 'sprint-deploy';

export type ButtonVariant = 'default' | 'destructive' | 'success' | 'warning';

export type ActionTier = 'alert' | 'action' | 'complete';

export type DropdownColor = 'blue' | 'purple' | 'teal' | 'green' | 'amber' | 'red' | 'pink';

export interface DropdownAction {
  label: string;
  message: string;
  description?: string;
  icon?: LucideIcon;
  color?: DropdownColor;
  shortcut?: string;
  nextPhase?: import('@/lib/types').SprintPhase | null; // Auto-advance sprint phase on click
}

export interface PrimaryAction {
  type: PrimaryActionType;
  tier: ActionTier;
  label: string;
  icon: LucideIcon;
  variant: ButtonVariant;
  message?: string; // Message to send to agent (undefined for 'view-pr' and 'archive-session')
  prUrl?: string; // For 'view-pr' action
  sessionId?: string; // For 'archive-session' action
  nextPhase?: import('@/lib/types').SprintPhase | null; // Auto-advance sprint phase on click
  dropdownActions?: DropdownAction[]; // Multiple dropdown options
  secondaryAction?: {
    label: string;
    message: string;
  };
}

export interface ActionButtonProps {
  action: PrimaryAction | null;
  isLoading: boolean;
  onSendMessage: (content: string, actionType: PrimaryActionType) => void;
  onFixIssues?: () => void;
  onArchiveSession?: (sessionId: string) => void;
  className?: string;
}
