'use client';

import { useEffect } from 'react';
import { sendNotification } from '@/lib/tauri';
import { playSound } from '@/lib/sounds';
import { useSettingsStore } from '@/stores/settingsStore';
import { useAppStore } from '@/stores/appStore';

const DEBOUNCE_MS = 5000;
const FOCUS_NAVIGATE_WINDOW_MS = 3000;

// Module-level state so notifyDesktop can be called outside of React hooks
let lastNotification: { conversationId: string; time: number } | null = null;
const debounceMap = new Map<string, number>();

/**
 * Send a desktop notification if the app is not focused and notifications are enabled.
 * This is a module-level function so it can be called from useWebSocket's getState() pattern.
 */
export function notifyDesktop(conversationId: string, title: string, body: string): void {
  const { desktopNotifications } = useSettingsStore.getState();
  if (!desktopNotifications) return;
  if (typeof document !== 'undefined' && document.hasFocus()) return;

  // Debounce per conversation
  const lastTime = debounceMap.get(conversationId);
  if (lastTime && Date.now() - lastTime < DEBOUNCE_MS) return;

  // Prune stale entries to prevent unbounded growth in long-running sessions
  if (debounceMap.size > 200) {
    const now = Date.now();
    for (const [k, v] of debounceMap) {
      if (now - v > DEBOUNCE_MS) debounceMap.delete(k);
    }
  }

  debounceMap.set(conversationId, Date.now());
  lastNotification = { conversationId, time: Date.now() };
  sendNotification(title, body).catch(() => {});

  // Play sound effect if enabled
  const { soundEffects, soundEffectType } = useSettingsStore.getState();
  if (soundEffects) {
    playSound(soundEffectType);
  }
}

/**
 * Get a human-readable label for a conversation (conversation name or session name).
 */
export function getConversationLabel(conversationId: string): string {
  const state = useAppStore.getState();
  const conversation = state.conversations.find((c) => c.id === conversationId);
  if (!conversation) return '';

  if (conversation.name) return conversation.name;

  const session = state.sessions.find((s) => s.id === conversation.sessionId);
  return session?.name || '';
}

/**
 * Navigate to a conversation by selecting its session and conversation.
 * Uses getState() so it always reads the latest store values.
 */
function navigateToConversation(conversationId: string): void {
  const state = useAppStore.getState();
  const conversation = state.conversations.find((c) => c.id === conversationId);
  if (!conversation) return;

  const session = state.sessions.find((s) => s.id === conversation.sessionId);
  if (session) {
    const { collapsedWorkspaces, expandWorkspace, contentView, setContentView } = useSettingsStore.getState();

    // Expand the workspace if collapsed
    if (collapsedWorkspaces.includes(session.workspaceId)) {
      expandWorkspace(session.workspaceId);
    }

    // Ensure we're in conversation view
    if (contentView.type !== 'conversation') {
      setContentView({ type: 'conversation' });
    }

    state.selectSession(session.id);
  }
  state.selectConversation(conversationId);
}

/**
 * Hook that listens for window focus events and navigates to the conversation
 * that triggered the most recent notification. Mount once at the app level.
 */
export function useDesktopNotifications(): void {
  useEffect(() => {
    const onFocus = () => {
      if (!lastNotification) return;
      if (Date.now() - lastNotification.time > FOCUS_NAVIGATE_WINDOW_MS) {
        lastNotification = null;
        return;
      }

      const { conversationId } = lastNotification;
      lastNotification = null;
      navigateToConversation(conversationId);
    };

    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);
}
