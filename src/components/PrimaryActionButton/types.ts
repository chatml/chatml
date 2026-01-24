import type { LucideIcon } from 'lucide-react';

export type PrimaryActionType =
  | 'resolve-conflicts'
  | 'fix-issues'
  | 'continue-rebase'
  | 'continue-merge'
  | 'continue-cherry-pick'
  | 'continue-revert'
  | 'sync-branch'
  | 'commit-changes'
  | 'push-changes'
  | 'update-pr'
  | 'view-pr'
  | 'create-pr'
  | 'archive-session'
  | 'disabled';

export type ButtonVariant = 'default' | 'destructive' | 'success' | 'warning' | 'info' | 'secondary';

export interface DropdownAction {
  label: string;
  message: string;
  icon?: LucideIcon;
}

export interface PrimaryAction {
  type: PrimaryActionType;
  label: string;
  icon: LucideIcon;
  variant: ButtonVariant;
  message?: string; // Message to send to agent (undefined for 'view-pr' and 'archive-session')
  prUrl?: string; // For 'view-pr' action
  sessionId?: string; // For 'archive-session' action
  dropdownActions?: DropdownAction[]; // Multiple dropdown options
  secondaryAction?: {
    label: string;
    message: string;
  };
}

export interface ActionButtonProps {
  action: PrimaryAction | null;
  isLoading: boolean;
  disabled: boolean;
  onSendMessage: (content: string) => void;
  onArchiveSession?: (sessionId: string) => void;
}
