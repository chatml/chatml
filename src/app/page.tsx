'use client';

import { useState, useCallback, useRef } from 'react';
import { Loader2 } from 'lucide-react';
import { useAppStore } from '@/stores/appStore';
import {
  useWorkspaceSelection,
  useConversationState,
  useFileTabState,
  useConversationHasMessages,
} from '@/stores/selectors';
import { useSettingsStore, getBranchPrefix, getWorkspaceBranchPrefix } from '@/stores/settingsStore';
import { navigate } from '@/lib/navigation';
import { useOnboarding } from '@/hooks/useOnboarding';
import { useAppInitialization } from '@/hooks/useAppInitialization';
import { useLayoutState } from '@/hooks/useLayoutState';
import { useMenuHandlers } from '@/hooks/useMenuHandlers';
import { useGlobalShortcuts } from '@/hooks/useGlobalShortcuts';
import { useOnboardingFlow } from '@/hooks/useOnboardingFlow';
import { useWebSocket } from '@/hooks/useWebSocket';
import { useSidecarLifecycle } from '@/hooks/useSidecarLifecycle';
import { useTabPersistence } from '@/hooks/useTabPersistence';
import { useAutoSave } from '@/hooks/useAutoSave';
import { useFileWatcher } from '@/hooks/useFileWatcher';
import { useExternalLinkGuard } from '@/hooks/useExternalLinkGuard';
import { useDesktopNotifications } from '@/hooks/useDesktopNotifications';
import { useFontSize } from '@/hooks/useFontSize';
import { useReviewTrigger } from '@/hooks/useReviewTrigger';
import { useMenuState } from '@/hooks/useMenuState';
import { useMessagePrefetch } from '@/hooks/useMessagePrefetch';
import { useToast } from '@/components/ui/toast';
import {
  createSession, createConversation, addRepo,
  mapSessionDTO, listConversations, type RepoDTO,
} from '@/lib/api';
import { registerSession, getSessionDirName, openFolderDialog } from '@/lib/tauri';
import { useBranchCacheStore } from '@/stores/branchCacheStore';
import { useRecentlyClosedStore } from '@/stores/recentlyClosedStore';
import { captureClosedConversation, useRestoreConversation } from '@/hooks/useRecentlyClosed';
import { useShortcut } from '@/hooks/useShortcut';
import type { SetupInfo } from '@/lib/types';

import { OnboardingScreen } from '@/components/shared/OnboardingScreen';
import { OnboardingWizard } from '@/components/onboarding/OnboardingWizard';
import { GuidedTour } from '@/components/onboarding/GuidedTour';
import { BackendStatus } from '@/components/shared/BackendStatus';
import { ErrorBoundary } from '@/components/shared/ErrorBoundary';
import { StreamingWarningHandler } from '@/components/shared/StreamingWarningHandler';
import { ConnectionStatusHandler } from '@/components/shared/ConnectionStatusHandler';
import { ConnectionBanner } from '@/components/shared/ConnectionBanner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { HEALTH_CHECK_MAX_RETRIES, HEALTH_CHECK_INITIAL_DELAY_MS } from '@/lib/constants';

import { WorkspaceSidebar } from '@/components/navigation/WorkspaceSidebar';
import { SessionToolbarContent } from '@/components/navigation/SessionToolbarContent';
import { ConversationArea } from '@/components/conversation/ConversationArea';
import { ChatInput } from '@/components/conversation/ChatInput';
import { ChangesPanel } from '@/components/panels/ChangesPanel';
import { BottomTerminal } from '@/components/layout/BottomTerminal';
import { MainToolbar, ContentActionBar } from '@/components/layout/MainToolbar';
import { SidebarToolbar } from '@/components/layout/SidebarToolbar';
import { ContentRouter } from '@/components/layout/ContentRouter';
import { DialogManager, type DialogManagerHandles } from '@/components/layout/DialogManager';
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@/components/ui/resizable';
import { cn } from '@/lib/utils';

// Pre-computed skeleton widths (avoids Math.random() during render)
const SKELETON_WIDTHS = [72, 88, 65, 81];

// Loading skeleton for conversation area
function ConversationSkeleton() {
  return (
    <div className="flex flex-col h-full" aria-busy="true" aria-label="Loading conversations">
      {/* Skeleton TopBar */}
      <div className="h-10 border-b flex items-center px-3 gap-2">
        <div className="h-5 w-5 bg-muted-foreground/20 rounded animate-pulse" />
        <div className="h-4 w-32 bg-muted-foreground/20 rounded animate-pulse" />
        <div className="flex-1" />
        <div className="h-6 w-16 bg-muted-foreground/20 rounded animate-pulse" />
      </div>

      {/* Skeleton messages area */}
      <div className="flex-1 overflow-hidden p-4 space-y-4">
        {/* System message skeleton */}
        <div className="flex gap-3">
          <div className="w-8 h-8 rounded-full bg-muted-foreground/20 animate-pulse shrink-0" />
          <div className="flex-1 space-y-2">
            <div className="h-3 w-24 bg-muted-foreground/20 rounded animate-pulse" />
            <div className="h-16 w-full bg-muted-foreground/10 rounded-lg animate-pulse" />
          </div>
        </div>

        {/* User message skeleton */}
        <div className="flex gap-3 justify-end">
          <div className="flex-1 max-w-[80%] space-y-2">
            <div className="h-3 w-16 bg-muted-foreground/20 rounded animate-pulse ml-auto" />
            <div className="h-12 w-full bg-primary/10 rounded-lg animate-pulse" />
          </div>
        </div>

        {/* Assistant message skeleton */}
        <div className="flex gap-3">
          <div className="w-8 h-8 rounded-full bg-muted-foreground/20 animate-pulse shrink-0" />
          <div className="flex-1 space-y-2">
            <div className="h-3 w-20 bg-muted-foreground/20 rounded animate-pulse" />
            <div className="space-y-1.5">
              {SKELETON_WIDTHS.map((width, i) => (
                <div
                  key={i}
                  className="h-4 bg-muted-foreground/10 rounded animate-pulse"
                  style={{ width: `${width}%`, animationDelay: `${i * 100}ms` }}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Loading indicator */}
        <div className="flex items-center justify-center py-6">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-sm">Loading workspace data...</span>
          </div>
        </div>
      </div>

      {/* Skeleton input area */}
      <div className="px-4 pb-4">
        <div className="h-28 rounded-lg border bg-muted/50 animate-pulse" />
      </div>
    </div>
  );
}

export default function Home() {
  // ─── Initialization ───────────────────────────────────────────────────
  const {
    mounted,
    backendConnected,
    setBackendConnected,
    isLoadingData,
    authLoading,
    isAuthenticated,
    repoToWorkspace,
    conversationToConversation,
    expandWorkspace,
  } = useAppInitialization();

  // ─── Layout State ─────────────────────────────────────────────────────
  const layout = useLayoutState();

  // ─── Store Selectors ──────────────────────────────────────────────────
  const { workspaces, sessions, selectedWorkspaceId, selectedSessionId } = useWorkspaceSelection();
  const { conversations, selectedConversationId, removeConversation } = useConversationState();
  const { fileTabs, closeFileTab, pendingCloseFileTabId, setPendingCloseFileTabId } = useFileTabState();
  // Boolean check only — avoids subscribing to the full messages array,
  // which would cause page-level re-renders on every message during streaming.
  const conversationHasMessages = useConversationHasMessages(selectedConversationId);
  const selectNextTab = useAppStore((s) => s.selectNextTab);
  const selectPreviousTab = useAppStore((s) => s.selectPreviousTab);
  const confirmCloseActiveTab = useSettingsStore((s) => s.confirmCloseActiveTab);
  const contentView = useSettingsStore((s) => s.contentView);

  const { error: showError } = useToast();
  const { showWizard, showGuidedTour, completeWizard, completeTour, skipAll } = useOnboarding();

  // ─── Dialog Manager Ref ───────────────────────────────────────────────
  const dialogRef = useRef<DialogManagerHandles>(null);

  // ─── Close Tab State ──────────────────────────────────────────────────
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const [pendingCloseConvId, setPendingCloseConvId] = useState<string | null>(null);

  // ─── Computed ─────────────────────────────────────────────────────────
  const isFullContentView = contentView.type !== 'conversation';
  const isInOnboarding = !isAuthenticated || showWizard;
  const selectedSession = selectedSessionId
    ? sessions.find((s) => s.id === selectedSessionId)
    : null;

  // ─── Onboarding Window Size ───────────────────────────────────────────
  useOnboardingFlow(isInOnboarding, authLoading);

  // ─── WebSocket & Side-Effect Hooks ────────────────────────────────────
  const { reconnect } = useWebSocket(backendConnected);

  // Monitor sidecar lifecycle and auto-restart on crash
  const { manualRestart } = useSidecarLifecycle(reconnect);

  // Listen for /review, /deep-review, /security slash commands
  useReviewTrigger();
  useMenuState();
  useTabPersistence();
  useFileWatcher(backendConnected);
  useExternalLinkGuard();
  useDesktopNotifications();
  useFontSize();
  useMessagePrefetch(!isLoadingData && backendConnected);

  // ─── Auto-Save ────────────────────────────────────────────────────────
  const handleSaveError = useCallback((filePath: string, error: unknown) => {
    const fileName = filePath.split('/').pop() ?? filePath;
    const reason = error instanceof Error ? error.message : 'Unknown error';
    showError(`Failed to save ${fileName}: ${reason}`, 'Auto-save Error');
  }, [showError]);
  const { saveCurrentTab, saveTab } = useAutoSave({ onError: handleSaveError });

  // ─── Session & Conversation Actions ───────────────────────────────────
  const { addSession, addConversation, selectConversation } = useAppStore.getState();

  const handleNewSession = useCallback(async () => {
    if (!selectedWorkspaceId) return;

    try {
      const workspace = workspaces.find(w => w.id === selectedWorkspaceId);
      const branchPrefix = workspace?.branchPrefix
        ? getWorkspaceBranchPrefix(workspace)
        : getBranchPrefix();
      const newSession = await createSession(selectedWorkspaceId, {
        ...(branchPrefix !== undefined && { branchPrefix }),
      });

      if (newSession.worktreePath) {
        const dirName = getSessionDirName(newSession.worktreePath);
        if (dirName) {
          registerSession(dirName, newSession.id);
        }
      }

      useAppStore.getState().addSession(mapSessionDTO(newSession));

      let firstConvId: string | null = null;
      try {
        const conversations = await listConversations(selectedWorkspaceId, newSession.id);
        conversations.forEach((conv) => {
          if (!firstConvId) firstConvId = conv.id;
          useAppStore.getState().addConversation({
            id: conv.id,
            sessionId: conv.sessionId,
            type: conv.type,
            name: conv.name,
            status: conv.status,
            messages: [],
            toolSummary: conv.toolSummary,
            createdAt: conv.createdAt,
            updatedAt: conv.updatedAt,
          });
        });
      } catch (error) {
        console.error('Failed to load conversations for new session:', error);
      }

      navigate({
        workspaceId: newSession.workspaceId,
        sessionId: newSession.id,
        conversationId: firstConvId ?? undefined,
        contentView: { type: 'conversation' },
      });
    } catch (error) {
      console.error('Failed to create session:', error);
      showError(error instanceof Error ? error.message : 'Failed to create session. Please try again.', 'Session Error');
    }
  }, [selectedWorkspaceId, workspaces, showError]);

  const handleNewConversation = useCallback(async () => {
    if (!selectedWorkspaceId || !selectedSessionId) return;

    try {
      const newConv = await createConversation(selectedWorkspaceId, selectedSessionId, {
        type: 'task',
      });

      useAppStore.getState().addConversation({
        id: newConv.id,
        sessionId: newConv.sessionId,
        type: newConv.type,
        name: newConv.name,
        status: newConv.status,
        messages: newConv.messages.map((m) => ({
          id: m.id,
          conversationId: newConv.id,
          role: m.role as 'user' | 'assistant' | 'system',
          content: m.content,
          setupInfo: m.setupInfo,
          runSummary: m.runSummary,
          timestamp: m.timestamp,
        })),
        toolSummary: newConv.toolSummary.map((t) => ({
          id: t.id,
          tool: t.tool,
          target: t.target,
          success: t.success,
        })),
        createdAt: newConv.createdAt,
        updatedAt: newConv.updatedAt,
      });
      useAppStore.getState().selectConversation(newConv.id);
    } catch (error) {
      console.error('Failed to create conversation:', error);
      showError(error instanceof Error ? error.message : 'Failed to create conversation. Please try again.', 'Conversation Error');
    }
  }, [selectedWorkspaceId, selectedSessionId, showError]);

  // ─── Close Tab Handlers ───────────────────────────────────────────────
  const doCloseTab = useCallback(async (convId: string) => {
    const currentConvs = conversations.filter((c) => c.sessionId === selectedSessionId);
    const currentIndex = currentConvs.findIndex((c) => c.id === convId);
    const conv = conversations.find((c) => c.id === convId);

    try {
      // Capture metadata for recently-closed before removing from store
      if (conv && selectedWorkspaceId) {
        captureClosedConversation(conv, selectedWorkspaceId);
      }

      // Remove from local store (do NOT delete from backend — keep for restore)
      removeConversation(convId);

      if (currentConvs.length > 1) {
        const nextConv = currentConvs[currentIndex + 1] || currentConvs[currentIndex - 1];
        if (nextConv) {
          useAppStore.getState().selectConversation(nextConv.id);
        }
      }
    } catch (error) {
      console.error('Failed to close tab:', error);
      showError('Failed to close conversation. Please try again.');
    }
  }, [selectedSessionId, selectedWorkspaceId, conversations, removeConversation, showError]);

  const handleCloseTab = useCallback(async () => {
    if (!selectedConversationId) return;

    if (conversationHasMessages && confirmCloseActiveTab) {
      setPendingCloseConvId(selectedConversationId);
      setShowCloseConfirm(true);
      return;
    }

    await doCloseTab(selectedConversationId);
  }, [selectedConversationId, conversationHasMessages, confirmCloseActiveTab, doCloseTab]);

  const handleConfirmClose = useCallback(async () => {
    if (pendingCloseConvId) {
      await doCloseTab(pendingCloseConvId);
      setPendingCloseConvId(null);
    }
  }, [pendingCloseConvId, doCloseTab]);

  // ─── Restore Closed Conversation Handler ────────────────────────────────
  const handleRestoreConversation = useRestoreConversation(showError);

  // ─── Reopen Last Closed Tab Shortcut (Cmd+Shift+T) ─────────────────────
  useShortcut('reopenClosedTab', useCallback(() => {
    if (!selectedSessionId) return;
    const entry = useRecentlyClosedStore.getState().closedConversations
      .find((c) => c.sessionId === selectedSessionId);
    if (entry) handleRestoreConversation(entry.id);
  }, [selectedSessionId, handleRestoreConversation]));

  // ─── Workspace Registration Helper ────────────────────────────────────
  const registerAndNavigateWorkspace = useCallback(async (repo: RepoDTO) => {
    const workspace = repoToWorkspace(repo);
    useAppStore.getState().addWorkspace(workspace);

    useBranchCacheStore.getState().fetchBranches(workspace.id).catch(() => {});

    const prefix = workspace.branchPrefix
      ? getWorkspaceBranchPrefix(workspace)
      : getBranchPrefix();
    const session = await createSession(workspace.id, {
      ...(prefix !== undefined && { branchPrefix: prefix }),
    });

    useAppStore.getState().addSession(mapSessionDTO(session));

    const convs = await listConversations(workspace.id, session.id);
    convs.forEach((conv) => {
      useAppStore.getState().addConversation({
        id: conv.id,
        sessionId: conv.sessionId,
        type: conv.type,
        name: conv.name,
        status: conv.status,
        messages: conv.messages.map((m) => ({
          id: m.id,
          conversationId: conv.id,
          role: m.role as 'user' | 'assistant' | 'system',
          content: m.content,
          setupInfo: (m as { setupInfo?: SetupInfo }).setupInfo,
          timestamp: m.timestamp,
        })),
        toolSummary: conv.toolSummary,
        createdAt: conv.createdAt,
        updatedAt: conv.updatedAt,
      });
    });

    expandWorkspace(workspace.id);
    navigate({
      workspaceId: workspace.id,
      sessionId: session.id,
      conversationId: convs.length > 0 ? convs[0].id : undefined,
      contentView: { type: 'conversation' },
    });
  }, [repoToWorkspace, expandWorkspace]);

  const handleOpenProject = useCallback(async () => {
    const selectedPath = await openFolderDialog('Select Repository');
    if (!selectedPath) return;

    try {
      const repo = await addRepo(selectedPath);
      await registerAndNavigateWorkspace(repo);
    } catch (error) {
      console.error('Failed to add workspace directly:', error);
      showError(error instanceof Error ? error.message : 'Failed to add workspace. Please try again.', 'Workspace Error');
    }
  }, [registerAndNavigateWorkspace]);

  const handleCloned = useCallback(async (repo: RepoDTO) => {
    try {
      await registerAndNavigateWorkspace(repo);
    } catch (error) {
      console.error('Failed to register cloned workspace:', error);
    }
  }, [registerAndNavigateWorkspace]);

  // ─── File Tab Handlers ────────────────────────────────────────────────
  const handleCloseFileTab = useCallback((tabId: string) => {
    const tab = fileTabs.find((t) => t.id === tabId);
    if (!tab) return;

    if (tab.isDirty) {
      setPendingCloseFileTabId(tabId);
      return;
    }

    closeFileTab(tabId);
  }, [fileTabs, closeFileTab, setPendingCloseFileTabId]);

  const handleSaveAndCloseFile = useCallback(async () => {
    if (!pendingCloseFileTabId) return;
    const tab = fileTabs.find((t) => t.id === pendingCloseFileTabId);
    if (tab) {
      await saveTab(tab);
      closeFileTab(pendingCloseFileTabId);
    }
    setPendingCloseFileTabId(null);
  }, [pendingCloseFileTabId, fileTabs, saveTab, closeFileTab, setPendingCloseFileTabId]);

  const handleDontSaveAndCloseFile = useCallback(() => {
    if (!pendingCloseFileTabId) return;
    closeFileTab(pendingCloseFileTabId);
    setPendingCloseFileTabId(null);
  }, [pendingCloseFileTabId, closeFileTab, setPendingCloseFileTabId]);

  // ─── Menu Handlers & Global Shortcuts ─────────────────────────────────
  useMenuHandlers({
    handleNewSession,
    handleNewConversation,
    handleCloseTab,
    handleCloseFileTab,
    saveCurrentTab,
    toggleLeftSidebar: layout.toggleLeftSidebar,
    toggleRightSidebar: layout.toggleRightSidebar,
    toggleBottomTerminal: layout.toggleBottomTerminal,
    expandBottomTerminal: () => layout.bottomTerminalPanelRef.current?.expand(),
    selectNextTab,
    selectPreviousTab,
    setZenMode: layout.setZenMode,
    zenModeRef: layout.zenModeRef,
    resetLayouts: layout.resetLayouts,
    onOpenSettings: (category?: string) => dialogRef.current?.openSettings(category),
    onCloseSettings: () => dialogRef.current?.closeSettings(),
    onShowAddWorkspace: () => dialogRef.current?.showAddWorkspace(),
    onShowCreateFromPR: () => dialogRef.current?.showCreateFromPR(),
    onShowShortcuts: () => dialogRef.current?.showShortcuts(),
    onShowBottomTerminal: () => {
      if (layout.selectedSessionId) {
        layout.setTerminalPanelVisible(layout.selectedSessionId, true);
      }
    },
  });

  useGlobalShortcuts({
    sessions,
    toggleBottomTerminal: layout.toggleBottomTerminal,
    selectNextTab,
    selectPreviousTab,
    setZenMode: layout.setZenMode,
    zenModeRef: layout.zenModeRef,
  });

  // ─── Early Returns ────────────────────────────────────────────────────
  if (!mounted) {
    return null;
  }

  if (authLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <OnboardingScreen />;
  }

  if (!backendConnected) {
    return (
      <BackendStatus
        onConnected={() => setBackendConnected(true)}
        maxRetries={HEALTH_CHECK_MAX_RETRIES}
        initialDelay={HEALTH_CHECK_INITIAL_DELAY_MS}
      />
    );
  }

  // ─── Render ───────────────────────────────────────────────────────────
  return (
    <>
      <StreamingWarningHandler />
      <ConnectionStatusHandler />
      <TooltipProvider>
        <div className="h-screen overflow-hidden flex relative bg-background">
        {/* OUTER GROUP: Left Sidebar | Main Content */}
        <ResizablePanelGroup
          direction="horizontal"
          className="flex-1"
          defaultLayout={layout.layoutOuter}
          onLayoutChange={layout.setLayoutOuter}
        >
          {/* Left Sidebar */}
          <ResizablePanel
            ref={layout.leftSidebarPanelRef}
            id="left-sidebar"
            defaultSize={22}
            minSize="200px"
            maxSize="400px"
            collapsible={true}
            collapsedSize={0}
            onResize={(size) => {
              const collapsed = size.asPercentage === 0;
              layout.setLeftSidebarCollapsed((prev) => prev === collapsed ? prev : collapsed);
            }}
            className={cn(layout.zenMode && "hidden")}
          >
            <div ref={layout.leftSidebarDomRef} className="h-full flex flex-col">
              <SidebarToolbar />
              <div className="flex-1 min-h-0">
              <ErrorBoundary section="Sidebar">
                <WorkspaceSidebar
                  onOpenProject={handleOpenProject}
                  onCloneFromUrl={() => dialogRef.current?.showCloneFromUrl()}
                  onGitHubRepos={() => dialogRef.current?.showGitHubRepos()}
                  onOpenWorkspaceSettings={(workspaceId) => {
                    dialogRef.current?.openWorkspaceSettings(workspaceId);
                  }}
                />
              </ErrorBoundary>
              </div>
            </div>
          </ResizablePanel>

          <ResizableHandle
            direction="horizontal"
            className={cn(
              "after:bg-transparent",
              (layout.leftSidebarCollapsed || layout.zenMode) && "hidden"
            )}
          />

          {/* Main Content */}
          <ResizablePanel id="main-content" defaultSize={78} minSize={30} className="!overflow-visible">
            <div className="flex flex-col h-full">
              <MainToolbar
                showLeftSidebar={!layout.leftSidebarCollapsed}
                showRightSidebar={!layout.rightSidebarCollapsed}
                showBottomPanel={layout.showBottomTerminal}
                hasSecondaryPanels={!isFullContentView && !!selectedSessionId}
                onToggleLeftSidebar={layout.toggleLeftSidebar}
                onToggleRightSidebar={layout.toggleRightSidebar}
                onToggleBottomPanel={layout.toggleBottomTerminal}
                onOpenSettings={() => dialogRef.current?.openSettings()}
                onOpenShortcuts={() => dialogRef.current?.showShortcuts()}
              />

              <div className={cn(
                "flex flex-col flex-1 min-h-0 border-t border-border/75 overflow-hidden",
                !layout.leftSidebarCollapsed && !layout.zenMode && "border-l rounded-tl-lg"
              )}>
              <ContentActionBar />
              <ConnectionBanner onReconnect={reconnect} onManualSidecarRestart={manualRestart} />

              {/* Content Area */}
              <div className="flex-1 min-h-0">
                {isLoadingData ? (
                  <ConversationSkeleton />
                ) : isFullContentView || (!selectedSessionId && contentView.type === 'conversation') ? (
                  <ContentRouter
                    selectedSessionId={selectedSessionId}
                    showLeftSidebar={!layout.leftSidebarCollapsed}
                    onOpenProject={handleOpenProject}
                    onCloneFromUrl={() => dialogRef.current?.showCloneFromUrl()}
                    onGitHubRepos={() => dialogRef.current?.showGitHubRepos()}
                    onOpenSettings={() => dialogRef.current?.openSettings()}
                    onOpenShortcuts={() => dialogRef.current?.showShortcuts()}
                    onOpenWorkspaceSettings={(workspaceId) => dialogRef.current?.openWorkspaceSettings(workspaceId)}
                    onNewSession={handleNewSession}
                    onCreateFromPR={() => dialogRef.current?.showCreateFromPR()}
                  />
                ) : (
                  // INNER GROUP: Conversation + Terminal | Right Sidebar
                  <ResizablePanelGroup
                    direction="horizontal"
                    className="h-full"
                    defaultLayout={layout.layoutInner}
                    onLayoutChange={layout.setLayoutInner}
                  >
                    <ResizablePanel id="inner-content" minSize={30}>
                      {/* VERTICAL GROUP: Conversation | Bottom Terminal */}
                      <ResizablePanelGroup
                        direction="vertical"
                        className="h-full"
                        defaultLayout={layout.layoutVertical}
                        onLayoutChange={layout.setLayoutVertical}
                      >
                        <ResizablePanel id="conversation" minSize={20}>
                          {selectedSessionId ? (
                            <div className="flex flex-col h-full">
                              <SessionToolbarContent />
                              <ErrorBoundary section="Conversation">
                                <ConversationArea>
                                  <ChatInput />
                                </ConversationArea>
                              </ErrorBoundary>
                            </div>
                          ) : null}
                        </ResizablePanel>

                        <ResizableHandle
                          direction="vertical"
                          className={cn(!layout.showBottomTerminal && "hidden")}
                        />
                        <ResizablePanel
                          ref={(handle) => {
                            layout.bottomTerminalPanelRef.current = handle;
                            if (handle) {
                              // Sync collapse state on mount. Handles the case where the
                              // useLayoutEffect already ran before the panel mounted (ref was null).
                              queueMicrotask(() => {
                                // Guard: handle may be stale if component unmounted before microtask ran
                                if (layout.bottomTerminalPanelRef.current !== handle) return;
                                const state = useAppStore.getState();
                                const sid = state.selectedSessionId;
                                if (!sid) return;
                                const visible = state.terminalPanelVisible[sid] ?? false;
                                if (!visible && !handle.isCollapsed()) {
                                  handle.collapse();
                                }
                              });
                            }
                          }}
                          id="bottom-terminal"
                          defaultSize="250px"
                          minSize="100px"
                          maxSize="400px"
                          collapsible={true}
                          collapsedSize={0}
                          onResize={(size) => {
                            const collapsed = size.asPercentage === 0;
                            // Read store directly to avoid stale closure values from render.
                            // The useLayoutEffect may have just called expand() which triggers
                            // this handler before React re-renders with the new state.
                            const state = useAppStore.getState();
                            const sid = state.selectedSessionId;
                            if (!sid) return;
                            const visible = state.terminalPanelVisible[sid] ?? false;
                            // Sync manual drag-to-collapse -> store
                            if (collapsed && visible) {
                              layout.setTerminalPanelVisible(sid, false);
                            }
                            // Guard: re-collapse if panel expanded but store says hidden.
                            // Handles parent resize (sidebar toggle) inadvertently expanding the panel.
                            if (!collapsed && !visible) {
                              queueMicrotask(() => {
                                layout.bottomTerminalPanelRef.current?.collapse();
                              });
                            }
                          }}
                        >
                          <div className="h-full">
                            <ErrorBoundary section="Terminal">
                              <BottomTerminal
                                currentSessionId={selectedSessionId}
                                currentWorkspacePath={selectedSession?.worktreePath ?? null}
                                isExpanded={layout.showBottomTerminal}
                                onHide={layout.hideBottomTerminal}
                              />
                            </ErrorBoundary>
                          </div>
                        </ResizablePanel>
                      </ResizablePanelGroup>
                    </ResizablePanel>

                    <ResizableHandle
                      direction="horizontal"
                      className={cn(
                        (layout.rightSidebarCollapsed || layout.zenMode || !selectedSessionId) && "hidden"
                      )}
                    />

                    <ResizablePanel
                      ref={layout.rightSidebarPanelRef}
                      id="right-sidebar"
                      defaultSize="280px"
                      minSize="250px"
                      maxSize="500px"
                      collapsible={true}
                      collapsedSize={0}
                      onResize={(size) => {
                        const collapsed = size.asPercentage === 0;
                        layout.setRightSidebarCollapsed((prev) => prev === collapsed ? prev : collapsed);
                      }}
                      className={cn(
                        "overflow-hidden bg-content-background dark:bg-transparent",
                        (layout.zenMode || !selectedSessionId) && "hidden"
                      )}
                    >
                      <ErrorBoundary section="Changes">
                        <ChangesPanel />
                      </ErrorBoundary>
                    </ResizablePanel>
                  </ResizablePanelGroup>
                )}
              </div>
              </div>
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>

        {/* Onboarding Wizard Overlay */}
        {showWizard && (
          <OnboardingWizard
            onComplete={completeWizard}
            onSkip={skipAll}
            onOpenSettings={() => { skipAll(); dialogRef.current?.openSettings('ai-models'); }}
          />
        )}

        {/* Guided Tour Overlay */}
        {showGuidedTour && !isLoadingData && (
          <GuidedTour onComplete={completeTour} onDismiss={completeTour} />
        )}

        {/* All Dialogs */}
        <DialogManager
          ref={dialogRef}
          selectedWorkspaceId={selectedWorkspaceId}
          selectedSessionId={selectedSessionId}
          showCloseConfirm={showCloseConfirm}
          setShowCloseConfirm={setShowCloseConfirm}
          onConfirmClose={handleConfirmClose}
          pendingCloseFileTabId={pendingCloseFileTabId}
          setPendingCloseFileTabId={setPendingCloseFileTabId}
          pendingCloseFileName={fileTabs.find((t) => t.id === pendingCloseFileTabId)?.name || 'file'}
          onSaveAndCloseFile={handleSaveAndCloseFile}
          onDontSaveAndCloseFile={handleDontSaveAndCloseFile}
          onCloned={handleCloned}
          expandWorkspace={expandWorkspace}
        />

        </div>
      </TooltipProvider>
    </>
  );
}
