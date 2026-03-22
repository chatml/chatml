import { useEffect } from 'react';
import type { Attachment, SprintPhase } from '@/lib/types';

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
  /** Auto-advance sprint phase (dispatched by Primary Action button click) */
  'sprint-phase-advance': { phase: SprintPhase | null };
  /** Toggle sprint on/off (dispatched by /sprint slash command) */
  'toggle-sprint': void;
  /** Plan was approved (dispatched by ChatInput so toolbar can auto-advance sprint phase) */
  'plan-approved': void;
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
