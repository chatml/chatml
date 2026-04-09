import { useEffect } from 'react';
import type { Attachment } from '@/lib/types';
import type { AllBottomPanelTab } from '@/stores/settingsStore';

/**
 * Typed custom event map. Add new events here for compile-time safety
 * on both dispatch and listener sides.
 */
export interface AppCustomEventMap {
  'branch-sync-rebase': { baseBranch: string };
  'branch-sync-merge': { baseBranch: string };
  'branch-sync-accepted': void;
  'branch-sync-rejected': void;
  'git-create-pr': void;
  'chat-message-submitted': void;
  /** Insert text and/or instruction attachments into the composer without auto-submitting */
  'compose-action': { text: string; attachments?: Attachment[] };
  /** Investigate: structured 5-phase debugging with root cause analysis */
  'investigate': void;
  /** Autoplan: orchestrated product/design/code/architecture review pipeline */
  'autoplan': void;
  /** Document-release: post-ship documentation audit */
  'document-release': void;
  /** Execute a primary action from the session hover card (select session first, then dispatch) */
  'primary-action-execute': { message: string; templateKey?: string | null; templateContent?: string; workspaceId: string };
  /** Switch the sidebar bottom panel to a specific tab (e.g. 'background' when a task starts) */
  'sidebar-switch-bottom-tab': { tab: AllBottomPanelTab; sessionId: string };
  /** Dashboard spend data needs refresh (fired when a message with cost data arrives) */
  'dashboard-spend-invalidate': void;
}

type EventDetail<K extends keyof AppCustomEventMap> =
  AppCustomEventMap[K] extends void ? undefined : AppCustomEventMap[K];

/**
 * Dispatch a typed custom event on `window`.
 */
export function dispatchAppEvent<K extends keyof AppCustomEventMap>(
  name: K,
  ...args: AppCustomEventMap[K] extends void ? [] : [detail: AppCustomEventMap[K]]
): void {
  const detail = args[0] as EventDetail<K>;
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

/**
 * React hook that listens for a typed custom event on `window`.
 * Cleans up on unmount automatically.
 */
export function useAppEventListener<K extends keyof AppCustomEventMap>(
  name: K,
  handler: (detail: EventDetail<K>) => void,
  deps: React.DependencyList = [],
): void {
  useEffect(() => {
    const listener = (e: Event) => {
      handler((e as CustomEvent).detail as EventDetail<K>);
    };
    window.addEventListener(name, listener);
    return () => window.removeEventListener(name, listener);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, ...deps]);
}
