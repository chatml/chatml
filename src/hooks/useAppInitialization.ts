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
import { useToast } from '@/components/ui/toast';
import {
  listRepos, listAllSessions, listConversations,
  mapSessionDTO, getConversationMessages, toStoreMessage,
  type RepoDTO, type ConversationDTO, type MessageDTO,
} from '@/lib/api';
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
  const [isLoadingData, setIsLoadingData] = useState(true);

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
      setIsLoadingData(true);
      try {
        // Step 1: Fetch all workspaces
        const repos = await listRepos();
        let mappedWorkspaces = repos.map(repoToWorkspace);

        // Apply persisted workspace order (if any)
        const { workspaceOrder } = useSettingsStore.getState();
        const reordered = applyWorkspaceOrder(mappedWorkspaces, workspaceOrder);
        if (reordered) mappedWorkspaces = reordered;

        setWorkspaces(mappedWorkspaces);

        // Prefetch branch lists for all workspaces (fire-and-forget)
        const { fetchBranches: prefetchBranches } = useBranchCacheStore.getState();
        for (const ws of mappedWorkspaces) {
          prefetchBranches(ws.id).catch(() => {});
        }

        // Step 2: Fetch all sessions across all workspaces in a single request
        const sessionDTOs = await listAllSessions(true);
        const allSessions = sessionDTOs.map(s => mapSessionDTO(s));
        setSessions(allSessions);

        // Register all sessions with the global file watcher for event routing
        for (const session of allSessions) {
          if (session.worktreePath) {
            const dirName = getSessionDirName(session.worktreePath);
            if (dirName) {
              registerSession(dirName, session.id);
            }
          }
        }

        // Determine which workspace to select (needed to scope conversation fetching)
        const tabState = ENABLE_BROWSER_TABS ? useTabStore.getState() : null;
        const activeTab = tabState?.tabs[tabState.activeTabId];
        const hasPersistedTab = ENABLE_BROWSER_TABS && activeTab && tabState!.tabOrder.length > 0 &&
          (activeTab.selectedWorkspaceId || activeTab.contentView.type !== 'conversation');

        const workspaceValid = hasPersistedTab && activeTab.selectedWorkspaceId &&
          mappedWorkspaces.some(w => w.id === activeTab.selectedWorkspaceId);
        const targetWorkspaceId = workspaceValid
          ? activeTab.selectedWorkspaceId
          : mappedWorkspaces[0]?.id ?? null;

        // Step 3: Fetch conversations for the target workspace's non-archived sessions in parallel
        const targetSessions = targetWorkspaceId
          ? allSessions.filter(s => s.workspaceId === targetWorkspaceId && !s.archived)
          : [];
        const convsBySession = await Promise.all(
          targetSessions.map(s =>
            listConversations(targetWorkspaceId!, s.id).catch(() => [] as ConversationDTO[])
          )
        );
        const allConversations = convsBySession.flat().map(conversationToConversation);
        setConversations(allConversations);

        // Step 4: Restore persisted state or select defaults
        const sessionValid = hasPersistedTab && activeTab.selectedSessionId &&
          allSessions.some(s => s.id === activeTab.selectedSessionId && !s.archived);
        const conversationValid = sessionValid && activeTab.selectedConversationId &&
          allConversations.some(c => c.id === activeTab.selectedConversationId);
        const contentViewWorkspaceId = activeTab?.contentView &&
          'workspaceId' in activeTab.contentView
          ? (activeTab.contentView as { workspaceId?: string }).workspaceId
          : undefined;
        const contentViewWorkspaceValid = contentViewWorkspaceId
          ? mappedWorkspaces.some(w => w.id === contentViewWorkspaceId)
          : true;
        const hasValidPersistedState = workspaceValid || sessionValid ||
          (hasPersistedTab && activeTab.contentView.type !== 'conversation' && contentViewWorkspaceValid);

        if (hasValidPersistedState) {
          if (workspaceValid) {
            selectWorkspace(activeTab.selectedWorkspaceId);
            if (!sessionValid) {
              const fallbackSession = allSessions.find(s => s.workspaceId === activeTab.selectedWorkspaceId && !s.archived);
              if (fallbackSession) selectSession(fallbackSession.id);
            }
          }
          if (sessionValid) selectSession(activeTab.selectedSessionId);
          if (conversationValid) selectConversation(activeTab.selectedConversationId);
          useSettingsStore.getState().setContentView(activeTab!.contentView);
          useNavigationStore.getState().setActiveTabId(tabState!.activeTabId);
        } else if (mappedWorkspaces.length > 0) {
          selectWorkspace(mappedWorkspaces[0].id);
          const firstSession = allSessions.find(s => s.workspaceId === mappedWorkspaces[0].id && !s.archived);
          if (firstSession) {
            const sessionConvs = allConversations.filter(c => c.sessionId === firstSession.id);
            if (sessionConvs.length === 0) {
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
            selectSession(firstSession.id);
          }
        }

        // Step 5: Eagerly load messages for the initially-selected conversation
        const initialConvId = useAppStore.getState().selectedConversationId;
        if (initialConvId) {
          try {
            const page = await getConversationMessages(initialConvId, { limit: 50 });
            const messages = page.messages.map((m) => toStoreMessage(m, initialConvId));
            setMessagePage(initialConvId, messages, page.hasMore, page.oldestPosition ?? 0, page.totalCount);
          } catch (err) {
            console.error('Failed to eagerly load messages for initial conversation:', err);
          }
        }
      } catch (error) {
        console.error('Failed to load data from backend:', error);
        showError('Failed to load workspace data. Try reloading the app.', 'Data Load Error');
      } finally {
        setIsLoadingData(false);
      }
    }

    loadData();
  }, [backendConnected, repoToWorkspace, conversationToConversation, setWorkspaces, setSessions, setConversations, selectWorkspace, selectSession, selectConversation, addConversation, setMessagePage, showError]);

  // Lazy-load conversations when switching to a workspace whose sessions don't have conversations loaded yet
  const selectedWorkspaceId = useAppStore((s) => s.selectedWorkspaceId);

  useEffect(() => {
    if (isLoadingData || !backendConnected || !selectedWorkspaceId) return;

    const state = useAppStore.getState();
    const workspaceSessions = state.sessions.filter(s => s.workspaceId === selectedWorkspaceId && !s.archived);
    // Check if any session in this workspace already has conversations loaded
    const hasConversations = workspaceSessions.some(s =>
      state.conversations.some(c => c.sessionId === s.id)
    );
    if (hasConversations || workspaceSessions.length === 0) return;

    // Fetch conversations for all non-archived sessions in the new workspace
    Promise.all(
      workspaceSessions.map(s =>
        listConversations(selectedWorkspaceId, s.id).catch(() => [] as ConversationDTO[])
      )
    ).then(convsBySession => {
      const newConvs = convsBySession.flat().map(conversationToConversation);
      if (newConvs.length > 0) {
        // Append to existing conversations (don't overwrite other workspaces)
        const existing = useAppStore.getState().conversations;
        const existingIds = new Set(existing.map(c => c.id));
        const deduped = newConvs.filter(c => !existingIds.has(c.id));
        if (deduped.length > 0) {
          setConversations([...existing, ...deduped]);
        }
      }
    }).catch(() => {});
  }, [selectedWorkspaceId, isLoadingData, backendConnected, conversationToConversation, setConversations]);

  return {
    mounted,
    backendConnected,
    setBackendConnected,
    isLoadingData,
    authLoading,
    isAuthenticated,
    repoToWorkspace,
    conversationToConversation,
    expandWorkspace,
  };
}
