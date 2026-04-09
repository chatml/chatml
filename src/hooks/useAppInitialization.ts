'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useAppStore } from '@/stores/appStore';
import { usePageActions } from '@/stores/selectors';
import { useSettingsStore, applyWorkspaceOrder } from '@/stores/settingsStore';
import { useAuthStore } from '@/stores/authStore';
import { useLinearAuthStore } from '@/stores/linearAuthStore';
import { useBranchCacheStore } from '@/stores/branchCacheStore';
import { useTabStore } from '@/stores/tabStore';
import { useNavigationStore } from '@/stores/navigationStore';
import { ENABLE_BROWSER_TABS, HEALTH_CHECK_MAX_RETRIES, HEALTH_CHECK_INITIAL_DELAY_MS } from '@/lib/constants';
import { initAuth, listenForOAuthCallback, validateStoredToken, OAUTH_TIMEOUT_MS } from '@/lib/auth';
import { getLinearAuthStatus } from '@/lib/linearAuth';
import { registerSession, getSessionDirName } from '@/lib/tauri';
import { navigate } from '@/lib/navigation';
import { expandGroupsForSession } from '@/hooks/useSidebarSessions';
import { useToast } from '@/components/ui/toast';
import {
  listRepos, listAllSessions, listConversations, listWorkspaceConversations,
  mapSessionDTO, getConversationMessages, toStoreMessage,
  type RepoDTO, type ConversationDTO, type MessageDTO,
} from '@/lib/api';
import { trackEvent } from '@/lib/telemetry';
import type { SetupInfo } from '@/lib/types';

/**
 * Handles app lifecycle initialization:
 * - Hydration guard (mounted state)
 * - Backend connection via BackendStatus callback
 * - OAuth initialization and validation (GitHub + Linear)
 * - Initial data loading (workspaces, sessions, conversations)
 * - Lazy conversation loading per workspace switch
 */
export function useAppInitialization() {
  const [mounted, setMounted] = useState(false);
  const [backendConnected, setBackendConnected] = useState(false);
  const [shellReady, setShellReady] = useState(false);
  const [contentReady, setContentReady] = useState(false);

  const { error: showError } = useToast();

  // Prevent hydration mismatch - render nothing until client-side mounted
  useEffect(() => {
    setMounted(true);
  }, []);

  const {
    isLoading: authLoading,
    isAuthenticated,
    oauthState,
    setAuthenticated,
    completeOAuth,
    failOAuth,
  } = useAuthStore();

  const {
    setAuthenticated: setLinearAuthenticated,
    completeOAuth: completeLinearOAuth,
    failOAuth: failLinearOAuth,
  } = useLinearAuthStore();

  const {
    setWorkspaces, setSessions, setConversations,
    addSession, addConversation, selectWorkspace, selectSession, selectConversation,
    setMessagePage,
  } = usePageActions();

  const expandWorkspace = useSettingsStore((s) => s.expandWorkspace);

  // Initialize auth on mount
  useEffect(() => {
    let unlistenOAuth: (() => void) | null = null;

    const init = async () => {
      // Set up OAuth callback listener first
      try {
        console.log('[OAuth] page.tsx: Setting up callback listener...');
        unlistenOAuth = await listenForOAuthCallback(
          // GitHub callbacks
          (result) => {
            console.log('[OAuth] page.tsx: GitHub success, user:', result.user?.login);
            completeOAuth();
            setAuthenticated(true, result.user);
          },
          (error) => {
            console.log('[OAuth] page.tsx: GitHub error:', error.message);
            failOAuth(error.message);
          },
          // Linear callbacks
          (result) => {
            console.log('[OAuth] page.tsx: Linear success, user:', result.user?.displayName);
            completeLinearOAuth();
            setLinearAuthenticated(true, result.user);
          },
          (error) => {
            console.log('[OAuth] page.tsx: Linear error:', error.message);
            failLinearOAuth(error.message);
          },
        );
        console.log('[OAuth] page.tsx: Callback listener ready');
      } catch (e) {
        // Listener setup failed (not in Tauri), continue anyway
        console.log('[OAuth] page.tsx: Listener setup failed (expected in browser):', e);
      }

      // Check for existing auth
      try {
        console.log('[Auth] page.tsx: Calling initAuth...');
        const status = await initAuth();
        console.log('[Auth] page.tsx: initAuth returned:', status.authenticated);
        setAuthenticated(status.authenticated, status.user);
        console.log('[Auth] page.tsx: setAuthenticated called');
      } catch (e) {
        console.error('[Auth] page.tsx: initAuth failed:', e);
        setAuthenticated(false);
      }
    };

    init();

    return () => {
      if (unlistenOAuth) unlistenOAuth();
    };
  }, [setAuthenticated, completeOAuth, failOAuth, setLinearAuthenticated, completeLinearOAuth, failLinearOAuth]);

  // OAuth timeout - fail if pending for too long
  useEffect(() => {
    if (oauthState !== 'pending') return;

    const timeoutId = setTimeout(() => {
      failOAuth('Authentication timed out. Please try again.');
    }, OAUTH_TIMEOUT_MS);

    return () => clearTimeout(timeoutId);
  }, [oauthState, failOAuth]);

  // Validate token with backend after connection is established
  useEffect(() => {
    if (!backendConnected || !isAuthenticated) return;

    const validate = async () => {
      const user = await validateStoredToken();
      if (user) {
        // Token is valid - update user info
        setAuthenticated(true, user);
      } else {
        // Token is invalid/expired - show onboarding
        setAuthenticated(false);
      }
    };

    validate();
  }, [backendConnected, isAuthenticated, setAuthenticated]);

  // Check Linear auth status after backend connects
  useEffect(() => {
    if (!backendConnected) return;

    const checkLinear = async () => {
      try {
        const status = await getLinearAuthStatus();
        setLinearAuthenticated(status.authenticated, status.user);
      } catch {
        // Non-fatal — Linear auth is optional
      }
    };

    checkLinear();
  }, [backendConnected, setLinearAuthenticated]);

  // Map backend Repo to frontend Workspace
  const repoToWorkspace = useCallback((repo: RepoDTO) => ({
    id: repo.id,
    name: repo.name,
    path: repo.path,
    defaultBranch: repo.branch,
    remote: repo.remote || 'origin',
    branchPrefix: repo.branchPrefix || '',
    customPrefix: repo.customPrefix || '',
    createdAt: repo.createdAt,
  }), []);

  // Map backend MessageDTO to frontend Message
  const messageToMessage = useCallback((msg: MessageDTO, conversationId: string) => ({
    id: msg.id,
    conversationId,
    role: msg.role as 'user' | 'assistant' | 'system',
    content: msg.content,
    setupInfo: msg.setupInfo,
    runSummary: msg.runSummary,
    timestamp: msg.timestamp,
  }), []);

  // Map backend ConversationDTO to frontend Conversation
  const conversationToConversation = useCallback((conv: ConversationDTO) => ({
    id: conv.id,
    sessionId: conv.sessionId,
    type: conv.type,
    name: conv.name,
    // Reset 'active' status to 'idle' on load - no agent is running when app starts
    status: conv.status === 'active' ? 'idle' : conv.status,
    messages: conv.messages.map(m => messageToMessage(m, conv.id)),
    messageCount: conv.messageCount,
    toolSummary: conv.toolSummary.map(t => ({
      id: t.id,
      tool: t.tool,
      target: t.target,
      success: t.success,
    })),
    createdAt: conv.createdAt,
    updatedAt: conv.updatedAt,
  }), [messageToMessage]);

  // Load data from backend (only when connected)
  useEffect(() => {
    if (!backendConnected) return;

    async function loadData() {
      try {
        // Phase 1: Fetch workspaces + sessions in parallel (independent calls)
        const [repos, sessionDTOs] = await Promise.all([
          listRepos(),
          listAllSessions(true),
        ]);

        // Process workspaces
        let mappedWorkspaces = repos.map(repoToWorkspace);
        const { workspaceOrder } = useSettingsStore.getState();
        const reordered = applyWorkspaceOrder(mappedWorkspaces, workspaceOrder);
        if (reordered) mappedWorkspaces = reordered;
        setWorkspaces(mappedWorkspaces);

        // Prefetch branch lists for all workspaces (fire-and-forget)
        const { fetchBranches: prefetchBranches } = useBranchCacheStore.getState();
        for (const ws of mappedWorkspaces) {
          prefetchBranches(ws.id).catch(() => {});
        }

        // Process sessions
        const allSessions = sessionDTOs.map(s => mapSessionDTO(s));
        setSessions(allSessions);

        // Register non-archived sessions with the global file watcher for event routing
        for (const session of allSessions) {
          if (session.worktreePath && !session.archived) {
            const dirName = getSessionDirName(session.worktreePath);
            if (dirName) {
              registerSession(dirName, session.id);
            }
          }
        }

        // Determine target workspace and session from persisted tab state
        const tabState = ENABLE_BROWSER_TABS ? useTabStore.getState() : null;
        const activeTab = tabState?.tabs[tabState.activeTabId];
        const hasPersistedTab = ENABLE_BROWSER_TABS && activeTab && tabState!.tabOrder.length > 0 &&
          (activeTab.selectedWorkspaceId || activeTab.contentView.type !== 'conversation');

        const workspaceValid = hasPersistedTab && activeTab.selectedWorkspaceId &&
          mappedWorkspaces.some(w => w.id === activeTab.selectedWorkspaceId);
        const targetWorkspaceId = workspaceValid
          ? activeTab.selectedWorkspaceId
          : mappedWorkspaces[0]?.id ?? null;

        // Determine target session before fetching conversations (only need active session's convs)
        const sessionValid = hasPersistedTab && activeTab.selectedSessionId &&
          allSessions.some(s => s.id === activeTab.selectedSessionId && !s.archived);
        const targetSessionId = sessionValid
          ? activeTab.selectedSessionId
          : allSessions.find(s => s.workspaceId === targetWorkspaceId && !s.archived)?.id ?? null;

        const contentViewWorkspaceId = activeTab?.contentView &&
          'workspaceId' in activeTab.contentView
          ? (activeTab.contentView as { workspaceId?: string }).workspaceId
          : undefined;
        const contentViewWorkspaceValid = contentViewWorkspaceId
          ? mappedWorkspaces.some(w => w.id === contentViewWorkspaceId)
          : true;
        const hasValidPersistedState = workspaceValid || sessionValid ||
          (hasPersistedTab && activeTab.contentView.type !== 'conversation' && contentViewWorkspaceValid);

        // Restore workspace/session selections
        if (hasValidPersistedState) {
          if (workspaceValid) {
            selectWorkspace(activeTab.selectedWorkspaceId);
            if (!sessionValid) {
              const fallbackSession = allSessions.find(s => s.workspaceId === activeTab.selectedWorkspaceId && !s.archived);
              if (fallbackSession) selectSession(fallbackSession.id);
            }
          }
          if (sessionValid) selectSession(activeTab.selectedSessionId);
          useSettingsStore.getState().setContentView(activeTab!.contentView);
          useNavigationStore.getState().setActiveTabId(tabState!.activeTabId);
        } else if (mappedWorkspaces.length > 0) {
          selectWorkspace(mappedWorkspaces[0].id);
          if (targetSessionId) {
            selectSession(targetSessionId);
          }
        }

        // Auto-expand collapsed sidebar groups so the restored session is visible
        const selectedId = useAppStore.getState().selectedSessionId;
        if (selectedId) {
          const selectedSession = allSessions.find(s => s.id === selectedId && !s.archived);
          if (selectedSession) expandGroupsForSession(selectedSession);
        }

        // Shell is ready — sidebar, toolbar, and layout chrome can render
        setShellReady(true);

        // Phase 2: Fetch conversations for active session only (not all sessions in workspace)
        // Start conversation fetch
        const convsPromise = targetSessionId && targetWorkspaceId
          ? listConversations(targetWorkspaceId, targetSessionId).catch(() => [] as ConversationDTO[])
          : Promise.resolve([] as ConversationDTO[]);

        // Speculative: start loading messages before confirming conversation exists.
        // If the persisted ID is stale, the result is discarded when conversationValid is false.
        const conversationIdFromTab = sessionValid ? activeTab.selectedConversationId : null;
        const earlyMsgPromise = conversationIdFromTab
          ? getConversationMessages(conversationIdFromTab, { limit: 50, compact: true }).catch(() => null)
          : Promise.resolve(null);

        // Await conversations
        const activeSessionConvs = await convsPromise;
        const allConversations = activeSessionConvs.map(conversationToConversation);
        setConversations(allConversations);

        // Select conversation and handle empty session
        const conversationValid = conversationIdFromTab &&
          allConversations.some(c => c.id === conversationIdFromTab);

        if (conversationValid) {
          selectConversation(conversationIdFromTab);
        } else if (targetSessionId) {
          // Persisted conversation is stale or missing — fall back to first available
          const fallbackConv = allConversations.find(c => c.sessionId === targetSessionId);
          if (fallbackConv) {
            selectConversation(fallbackConv.id);
          }
        }

        if (!hasValidPersistedState && targetSessionId) {
          // No persisted state — check if session has conversations, create one if needed
          const sessionConvs = allConversations.filter(c => c.sessionId === targetSessionId);
          if (sessionConvs.length === 0) {
            const firstSession = allSessions.find(s => s.id === targetSessionId);
            if (firstSession) {
              const convId = `conv-${firstSession.id}`;
              addConversation({
                id: convId,
                sessionId: firstSession.id,
                type: 'task',
                name: firstSession.task || 'Task #1',
                status: 'idle',
                messages: [],
                toolSummary: [],
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              });
            }
          }
        }

        // Load messages for the initially-selected conversation
        const initialConvId = useAppStore.getState().selectedConversationId;
        if (initialConvId) {
          try {
            // Reuse early-fetched messages if they match, otherwise fetch now
            const page = initialConvId === conversationIdFromTab
              ? await earlyMsgPromise
              : await getConversationMessages(initialConvId, { limit: 50, compact: true });
            if (page) {
              const messages = page.messages.map((m) => toStoreMessage(m, initialConvId, { compacted: true }));
              setMessagePage(initialConvId, messages, page.hasMore, page.oldestPosition ?? 0, page.totalCount);
            }
          } catch (err) {
            console.error('Failed to eagerly load messages for initial conversation:', err);
          }
        }
        // Step 6: Background prefetch conversations for other workspaces at idle
        const otherWorkspaceIds = mappedWorkspaces
          .filter(w => w.id !== targetWorkspaceId)
          .map(w => w.id);
        if (otherWorkspaceIds.length > 0) {
          const prefetchOtherWorkspaces = async () => {
            const results = await Promise.allSettled(
              otherWorkspaceIds.map(wsId => listWorkspaceConversations(wsId))
            );
            const allMapped = results
              .filter((r): r is PromiseFulfilledResult<ConversationDTO[]> => r.status === 'fulfilled')
              .flatMap(r => r.value.map(conversationToConversation));
            if (allMapped.length > 0) {
              const existing = useAppStore.getState().conversations;
              const existingIds = new Set(existing.map(c => c.id));
              const deduped = allMapped.filter(c => !existingIds.has(c.id));
              if (deduped.length > 0) {
                setConversations([...existing, ...deduped]);
              }
            }
            for (const r of results) {
              if (r.status === 'rejected') {
                console.debug('Failed to prefetch workspace conversations:', r.reason);
              }
            }
          };
          if (typeof requestIdleCallback === 'function') {
            requestIdleCallback(() => { prefetchOtherWorkspaces(); }, { timeout: 3000 });
          } else {
            setTimeout(prefetchOtherWorkspaces, 500);
          }
        }
      } catch (error) {
        console.error('Failed to load data from backend:', error);
        showError('Failed to load workspace data. Try reloading the app.', 'Data Load Error');
      } finally {
        setShellReady(true);
        setContentReady(true);
        trackEvent('app_opened');
      }
    }

    loadData();
  }, [backendConnected, repoToWorkspace, conversationToConversation, setWorkspaces, setSessions, setConversations, selectWorkspace, selectSession, selectConversation, addConversation, setMessagePage, showError]);

  // Lazy-load conversations when switching to a workspace whose sessions don't have conversations loaded yet
  const selectedWorkspaceId = useAppStore((s) => s.selectedWorkspaceId);
  const selectedSessionId = useAppStore((s) => s.selectedSessionId);

  useEffect(() => {
    if (!contentReady || !backendConnected || !selectedWorkspaceId) return;

    const state = useAppStore.getState();
    const workspaceSessions = state.sessions.filter(s => s.workspaceId === selectedWorkspaceId && !s.archived);
    // Check if any session in this workspace already has conversations loaded
    const hasConversations = workspaceSessions.some(s =>
      state.conversations.some(c => c.sessionId === s.id)
    );
    if (hasConversations || workspaceSessions.length === 0) return;

    // Fetch all conversations for the new workspace in a single request
    listWorkspaceConversations(selectedWorkspaceId)
      .then(convDTOs => {
        const newConvs = convDTOs.map(conversationToConversation);
        if (newConvs.length > 0) {
          // Append to existing conversations (don't overwrite other workspaces)
          const existing = useAppStore.getState().conversations;
          const existingIds = new Set(existing.map(c => c.id));
          const deduped = newConvs.filter(c => !existingIds.has(c.id));
          if (deduped.length > 0) {
            setConversations([...existing, ...deduped]);
          }
        }
      })
      .catch((err) => {
        console.debug('Failed to fetch conversations for workspace', selectedWorkspaceId, err);
      });
  }, [selectedWorkspaceId, contentReady, backendConnected, conversationToConversation, setConversations]);

  // Lazy-load conversations when switching to a session that doesn't have conversations loaded yet
  useEffect(() => {
    if (!contentReady || !backendConnected || !selectedSessionId) return;

    const state = useAppStore.getState();
    const session = state.sessions.find(s => s.id === selectedSessionId);
    if (!session || session.archived) return;

    // Skip if this session already has conversations
    const hasConversations = state.conversations.some(c => c.sessionId === selectedSessionId);
    if (hasConversations) return;

    listConversations(session.workspaceId, selectedSessionId)
      .then(convs => {
        const mapped = convs.map(conversationToConversation);
        if (mapped.length > 0) {
          const existing = useAppStore.getState().conversations;
          const existingIds = new Set(existing.map(c => c.id));
          const deduped = mapped.filter(c => !existingIds.has(c.id));
          if (deduped.length > 0) {
            setConversations([...existing, ...deduped]);
          }
        }
      })
      .catch(() => {});
  }, [selectedSessionId, contentReady, backendConnected, conversationToConversation, setConversations]);

  return {
    mounted,
    backendConnected,
    setBackendConnected,
    shellReady,
    contentReady,
    authLoading,
    isAuthenticated,
    repoToWorkspace,
    conversationToConversation,
    expandWorkspace,
  };
}
