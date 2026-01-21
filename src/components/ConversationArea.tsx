'use client';

import { useState, useEffect, useRef, useCallback, useMemo, memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { useAppStore } from '@/stores/appStore';
import {
  useConversationState,
  useFileTabState,
  useMessages,
  useConversationsWithUserMessages,
} from '@/stores/selectors';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  X,
  CheckCircle2,
  XCircle,
  Loader2,
  Copy,
  Check,
  ChevronRight,
  ChevronDown,
  FileCode,
  Terminal,
  Clock,
  MessageSquare,
  Circle,
  Sparkles,
  GitBranch,
  FileQuestion,
  FileText,
  BookOpen,
} from 'lucide-react';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { cn } from '@/lib/utils';
import type { FileTab, Conversation } from '@/lib/types';
import { CodeViewer } from '@/components/CodeViewer';
import { FileTabIcon } from '@/components/FileTabIcon';
import { TabBar, type TabItemData } from '@/components/tabs';
import { StreamingMessage } from '@/components/StreamingMessage';
import { RunSummaryBlock } from '@/components/RunSummaryBlock';
import { ToolUsageHistory } from '@/components/ToolUsageHistory';
import { SystemInfoCard } from '@/components/SystemInfoCard';
import { MarkdownPre, MarkdownCode } from '@/components/MarkdownCodeBlock';
import type { Message, VerificationResult, FileChange } from '@/lib/types';
import { COPY_FEEDBACK_DURATION_MS } from '@/lib/constants';
import { getSessionFileContent, getSessionFileDiff } from '@/lib/api';

interface ConversationAreaProps {
  children?: React.ReactNode;
}

export function ConversationArea({ children }: ConversationAreaProps) {
  // Use selector hooks for optimized subscriptions
  const {
    conversations,
    selectedConversationId,
    selectConversation,
    addConversation,
    removeConversation,
    updateConversation,
  } = useConversationState();

  const {
    fileTabs,
    selectedFileTabId,
    selectFileTab,
    closeFileTab,
    pinFileTab,
    closeOtherTabs,
    closeTabsToRight,
    reorderFileTabs,
    updateFileTab,
    setPendingCloseFileTabId,
  } = useFileTabState();

  // Targeted selectors for remaining state
  const sessions = useAppStore((s) => s.sessions);
  const selectedSessionId = useAppStore((s) => s.selectedSessionId);
  const streamingState = useAppStore((s) => s.streamingState);

  // Use messages selector scoped to the selected conversation
  const conversationMessages = useMessages(selectedConversationId);
  // Get Set of conversation IDs that have user messages (avoids subscribing to all messages)
  const conversationsWithUserMessages = useConversationsWithUserMessages();

  // Rename dialog state for conversations
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [renameConvId, setRenameConvId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

// Filter tabs for current session only (strict session isolation)
  // All tabs are now session-scoped - no more workspace-level tabs
  const { visibleTabs, sessionTabs } = useMemo(() => {
    const session: FileTab[] = [];

    for (const tab of fileTabs) {
      if (tab.sessionId === selectedSessionId) {
        session.push(tab);
      }
      // Skip tabs from other sessions (complete isolation)
    }

    return { visibleTabs: session, sessionTabs: session };
  }, [fileTabs, selectedSessionId]);

  const currentSession = useMemo(
    () => sessions.find((s) => s.id === selectedSessionId),
    [sessions, selectedSessionId]
  );
  const sessionConversations = useMemo(
    () => conversations.filter((c) => c.sessionId === selectedSessionId),
    [conversations, selectedSessionId]
  );

  // Check if a conversation is fresh (no user messages yet)
  const isFreshConversation = useCallback(
    (convId: string) => !conversationsWithUserMessages.has(convId),
    [conversationsWithUserMessages]
  );

  // Get status indicator for conversation tabs
  const getStatusIndicator = useCallback(
    (conv: Conversation) => {
      const streaming = streamingState[conv.id];
      if (streaming?.isStreaming) {
        return <Loader2 className="w-2.5 h-2.5 animate-spin text-primary" />;
      }
      if (streaming?.error) {
        return <Circle className="w-2.5 h-2.5 text-destructive fill-destructive" />;
      }
      if (conv.status === 'idle' && isFreshConversation(conv.id)) {
        return <Sparkles className="w-2.5 h-2.5 text-orange-500" />;
      }
      switch (conv.status) {
        case 'active':
          return <Loader2 className="w-2.5 h-2.5 animate-spin text-primary" />;
        case 'completed':
          return <CheckCircle2 className="w-2.5 h-2.5 text-green-500" />;
        case 'idle':
        default:
          return <Circle className="w-2.5 h-2.5 text-muted-foreground/50" />;
      }
    },
    [streamingState, isFreshConversation]
  );

  // Convert FileTab to TabItemData
  const fileTabToTabItem = useCallback(
    (tab: FileTab, group: 'session'): TabItemData => ({
      id: tab.id,
      type: 'file',
      label: tab.name,
      icon: <FileTabIcon filename={tab.name} className="w-3 h-3" />,
      isDirty: tab.isDirty,
      isPinned: tab.isPinned,
      isActive: selectedFileTabId === tab.id,
      group,
      fileTab: tab,
    }),
    [selectedFileTabId]
  );

  // Convert Conversation to TabItemData
  const conversationToTabItem = useCallback(
    (conv: Conversation): TabItemData => ({
      id: conv.id,
      type: 'conversation',
      label: conv.name,
      isDirty: false,
      isPinned: false,
      isActive: selectedFileTabId === null && selectedConversationId === conv.id,
      group: 'conversation',
      conversation: conv,
    }),
    [selectedFileTabId, selectedConversationId]
  );

  // Convert session tabs to TabItemData (all tabs are now session-scoped)
  const sessionTabItems = useMemo(
    () => sessionTabs.map((tab) => fileTabToTabItem(tab, 'session')),
    [sessionTabs, fileTabToTabItem]
  );

  const conversationTabItems = useMemo(
    () => sessionConversations.map(conversationToTabItem),
    [sessionConversations, conversationToTabItem]
  );

  // Get current active tab ID for TabBar
  const activeTabId = useMemo(() => {
    if (selectedFileTabId !== null) return selectedFileTabId;
    if (selectedConversationId !== null) return selectedConversationId;
    return null;
  }, [selectedFileTabId, selectedConversationId]);

  // Auto-scroll management
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [isUserScrolled, setIsUserScrolled] = useState(false);

  // Check if user has scrolled away from bottom
  const handleScroll = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const { scrollTop, scrollHeight, clientHeight } = container;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;
    setIsUserScrolled(!isAtBottom);
  }, []);

  // Auto-scroll to bottom when new content arrives
  const scrollToBottom = useCallback(() => {
    const container = scrollContainerRef.current;
    if (container && !isUserScrolled) {
      container.scrollTop = container.scrollHeight;
    }
  }, [isUserScrolled]);

  // Force scroll to bottom (for manual button click)
  const forceScrollToBottom = useCallback(() => {
    const container = scrollContainerRef.current;
    if (container) {
      container.scrollTop = container.scrollHeight;
      setIsUserScrolled(false);
    }
  }, []);

  // Scroll when messages change or streaming updates
  const streamingText = useMemo(
    () => selectedConversationId ? streamingState[selectedConversationId]?.text : null,
    [selectedConversationId, streamingState]
  );

  // Check if plan mode is active for the current conversation
  const planModeActive = useMemo(
    () => selectedConversationId ? streamingState[selectedConversationId]?.planModeActive : false,
    [selectedConversationId, streamingState]
  );

  useEffect(() => {
    scrollToBottom();
  }, [conversationMessages.length, streamingText, scrollToBottom]);

  // Reset scroll state when conversation changes
  useEffect(() => {
    queueMicrotask(() => setIsUserScrolled(false));
    // Scroll to bottom immediately when switching conversations
    setTimeout(() => {
      const container = scrollContainerRef.current;
      if (container) {
        container.scrollTop = container.scrollHeight;
      }
    }, 0);
  }, [selectedConversationId]);

  // Get current file tab from visible tabs
  const currentFileTab = visibleTabs.find((t) => t.id === selectedFileTabId);

  // Determine what's currently active (conversation or file)
  // File is active only if selected tab is visible
  const isFileActive = selectedFileTabId !== null && currentFileTab !== undefined;

  // Load content for selected file tab on mount/restore (e.g., after refresh)
  useEffect(() => {
    if (!currentFileTab || currentFileTab.isLoading) return;

    // For regular file view without content, load it from session's worktree
    if (currentFileTab.viewMode !== 'diff' && !currentFileTab.content && !currentFileTab.isBinary && !currentFileTab.isTooLarge && currentFileTab.sessionId) {
      const loadContent = async () => {
        updateFileTab(currentFileTab.id, { isLoading: true });
        try {
          const fileData = await getSessionFileContent(currentFileTab.workspaceId, currentFileTab.sessionId, currentFileTab.path);
          updateFileTab(currentFileTab.id, {
            content: fileData.content,
            originalContent: fileData.content,
            isLoading: false,
          });
        } catch (error) {
          console.error('Failed to load file:', error);
          updateFileTab(currentFileTab.id, {
            content: `// Error loading file: ${error instanceof Error ? error.message : 'Unknown error'}`,
            isLoading: false,
          });
        }
      };
      loadContent();
    }

    // For diff view without diff content, load it
    if (currentFileTab.viewMode === 'diff' && !currentFileTab.diff && !currentFileTab.isBinary && !currentFileTab.isTooLarge && currentFileTab.sessionId) {
      const loadDiff = async () => {
        updateFileTab(currentFileTab.id, { isLoading: true });
        try {
          const diffData = await getSessionFileDiff(currentFileTab.workspaceId, currentFileTab.sessionId, currentFileTab.path);
          updateFileTab(currentFileTab.id, {
            diff: {
              oldContent: diffData.oldContent ?? '',
              newContent: diffData.newContent ?? '',
            },
            isLoading: false,
          });
        } catch (error) {
          console.error('Failed to load diff:', error);
          updateFileTab(currentFileTab.id, {
            content: `// Error loading diff: ${error instanceof Error ? error.message : 'Unknown error'}`,
            isLoading: false,
          });
        }
      };
      loadDiff();
    }
  }, [currentFileTab?.id, currentFileTab?.content, currentFileTab?.diff, currentFileTab?.isLoading, updateFileTab]);

  const handleNewConversation = (type: 'task' | 'review' | 'chat' = 'task') => {
    if (!selectedSessionId) return;
    const newConversation = {
      id: crypto.randomUUID(),
      sessionId: selectedSessionId,
      type,
      name: 'Untitled',
      status: 'idle' as const,
      messages: [],
      toolSummary: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    addConversation(newConversation);
    selectConversation(newConversation.id);
    selectFileTab(null); // Deselect file tab
  };

  const handleSelectConversation = (id: string) => {
    selectConversation(id);
    selectFileTab(null); // Deselect file tab when selecting conversation
  };

  const handleSelectFileTab = useCallback(async (id: string) => {
    selectFileTab(id);

    // Find the tab and check if it needs content loaded
    const tab = fileTabs.find((t) => t.id === id);
    if (!tab || tab.isLoading) return;

    // For regular file view without content, load it from session's worktree
    if (tab.viewMode !== 'diff' && !tab.content && !tab.isBinary && !tab.isTooLarge && tab.sessionId) {
      updateFileTab(id, { isLoading: true });
      try {
        const fileData = await getSessionFileContent(tab.workspaceId, tab.sessionId, tab.path);
        updateFileTab(id, {
          content: fileData.content,
          originalContent: fileData.content,
          isLoading: false,
        });
      } catch (error) {
        console.error('Failed to load file:', error);
        updateFileTab(id, {
          content: `// Error loading file: ${error instanceof Error ? error.message : 'Unknown error'}`,
          isLoading: false,
        });
      }
    }

    // For diff view without diff content, load it
    if (tab.viewMode === 'diff' && !tab.diff && !tab.isBinary && !tab.isTooLarge && tab.sessionId) {
      updateFileTab(id, { isLoading: true });
      try {
        const diffData = await getSessionFileDiff(tab.workspaceId, tab.sessionId, tab.path);
        updateFileTab(id, {
          diff: {
            oldContent: diffData.oldContent ?? '',
            newContent: diffData.newContent ?? '',
          },
          isLoading: false,
        });
      } catch (error) {
        console.error('Failed to load diff:', error);
        updateFileTab(id, {
          content: `// Error loading diff: ${error instanceof Error ? error.message : 'Unknown error'}`,
          isLoading: false,
        });
      }
    }
  }, [fileTabs, selectFileTab, updateFileTab]);

  const handleCloseFileTab = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const tab = fileTabs.find((t) => t.id === id);
    // If tab is dirty, set pending close ID to show confirmation dialog
    if (tab?.isDirty) {
      setPendingCloseFileTabId(id);
      return;
    }
    closeFileTab(id);
  };

  // Save editor state (cursor/scroll position) when switching tabs
  const handleEditorStateChange = useCallback((state: {
    cursorPosition?: { line: number; column: number };
    scrollPosition?: { top: number; left: number };
  }) => {
    if (selectedFileTabId) {
      updateFileTab(selectedFileTabId, {
        cursorPosition: state.cursorPosition,
        scrollPosition: state.scrollPosition,
      });
    }
  }, [selectedFileTabId, updateFileTab]);

  // Unified tab select handler for TabBar
  const handleTabSelect = useCallback(
    (id: string, type: 'file' | 'conversation') => {
      if (type === 'file') {
        handleSelectFileTab(id);
      } else {
        handleSelectConversation(id);
      }
    },
    [handleSelectFileTab, handleSelectConversation]
  );

  // Unified tab close handler for TabBar
  const handleTabClose = useCallback(
    (id: string, type: 'file' | 'conversation', e?: React.MouseEvent) => {
      if (type === 'file') {
        const tab = fileTabs.find((t) => t.id === id);
        if (tab?.isDirty) {
          setPendingCloseFileTabId(id);
          return;
        }
        closeFileTab(id);
      } else {
        removeConversation(id);
      }
    },
    [fileTabs, closeFileTab, removeConversation, setPendingCloseFileTabId]
  );

  // Close others handler for TabBar
  const handleCloseOthers = useCallback(
    (id: string, type: 'file' | 'conversation') => {
      if (type === 'file') {
        closeOtherTabs(id);
      } else {
        sessionConversations
          .filter((c) => c.id !== id)
          .forEach((c) => removeConversation(c.id));
      }
    },
    [closeOtherTabs, sessionConversations, removeConversation]
  );

  // Close to right handler for TabBar (files only)
  const handleCloseToRight = useCallback(
    (id: string, type: 'file' | 'conversation') => {
      if (type === 'file') {
        closeTabsToRight(id);
      }
    },
    [closeTabsToRight]
  );

  // Rename conversation handler for TabBar
  const handleRenameConversation = useCallback(
    (id: string) => {
      const conv = conversations.find((c) => c.id === id);
      if (conv) {
        setRenameConvId(id);
        setRenameValue(conv.name);
        setRenameDialogOpen(true);
      }
    },
    [conversations]
  );

  // Submit rename handler
  const handleRenameSubmit = useCallback(() => {
    if (renameConvId && renameValue.trim()) {
      updateConversation(renameConvId, { name: renameValue.trim() });
    }
    setRenameDialogOpen(false);
    setRenameConvId(null);
    setRenameValue('');
  }, [renameConvId, renameValue, updateConversation]);

  if (!selectedSessionId) {
    return (
      <div className="flex-1 min-h-0 flex flex-col">
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center max-w-md px-6">
            <div className="w-12 h-12 rounded-lg bg-muted/50 flex items-center justify-center mx-auto mb-4">
              <Terminal className="w-6 h-6 text-muted-foreground" />
            </div>
            <h3 className="text-base font-medium mb-2">No session selected</h3>
            <p className="text-sm text-muted-foreground">
              Select a session from the sidebar to begin.
            </p>
          </div>
        </div>
        <div className="shrink-0">{children}</div>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {/* VS Code-style unified TabBar */}
      <TabBar
        workspaceTabs={[]}
        sessionTabs={sessionTabItems}
        conversationTabs={conversationTabItems.map((tab) => ({
          ...tab,
          // Add status indicator for conversation tabs
          icon: tab.conversation ? getStatusIndicator(tab.conversation) : undefined,
        }))}
        activeTabId={activeTabId}
        onSelectTab={handleTabSelect}
        onCloseTab={handleTabClose}
        onPinTab={(id, pinned) => pinFileTab(id, pinned)}
        onCloseOthers={handleCloseOthers}
        onCloseToRight={handleCloseToRight}
        onReorder={reorderFileTabs}
        onNewSession={() => handleNewConversation('task')}
        onRenameConversation={handleRenameConversation}
      />

      {/* Content Area - Either file viewer or messages */}
      {isFileActive && currentFileTab ? (
        <>
          <div className="flex-1 min-h-0">
            {currentFileTab.isBinary ? (
              // Binary file placeholder
              <div className="h-full flex items-center justify-center">
                <div className="text-center">
                  <FileQuestion className="w-12 h-12 mx-auto mb-3 text-muted-foreground/50" />
                  <p className="text-sm font-medium text-foreground mb-1">{currentFileTab.name}</p>
                  <p className="text-xs text-muted-foreground">Binary file cannot be displayed</p>
                </div>
              </div>
            ) : currentFileTab.isTooLarge ? (
              // Large file placeholder
              <div className="h-full flex items-center justify-center">
                <div className="text-center">
                  <FileQuestion className="w-12 h-12 mx-auto mb-3 text-muted-foreground/50" />
                  <p className="text-sm font-medium text-foreground mb-1">{currentFileTab.name}</p>
                  <p className="text-xs text-muted-foreground">File is too large to display</p>
                </div>
              </div>
            ) : currentFileTab.viewMode === 'diff' && currentFileTab.diff ? (
              // Diff view - uses CodeViewer with oldContent for diff mode
              <CodeViewer
                content={currentFileTab.diff.newContent}
                oldContent={currentFileTab.diff.oldContent}
                filename={currentFileTab.name}
                isLoading={currentFileTab.isLoading}
                onStateChange={handleEditorStateChange}
                initialCursorPosition={currentFileTab.cursorPosition}
                initialScrollPosition={currentFileTab.scrollPosition}
              />
            ) : (
              // Regular file view
              <CodeViewer
                content={currentFileTab.content || ''}
                filename={currentFileTab.name}
                isLoading={currentFileTab.isLoading}
                onStateChange={handleEditorStateChange}
                initialCursorPosition={currentFileTab.cursorPosition}
                initialScrollPosition={currentFileTab.scrollPosition}
              />
            )}
          </div>
          {/* No chat input when viewing files */}
        </>
      ) : (
        <>
          {/* Plan Mode Banner */}
          {planModeActive && (
            <div className="shrink-0 flex items-center gap-2 px-4 py-2 bg-amber-500/10 border-b border-amber-500/20">
              <BookOpen className="w-4 h-4 text-amber-500" />
              <span className="text-sm text-amber-600 dark:text-amber-400 font-medium">
                Plan Mode Active
              </span>
              <span className="text-xs text-amber-500/70">
                Claude is in read-only planning mode
              </span>
            </div>
          )}

          {/* Messages */}
          <div className="relative flex-1 min-h-0">
            <div
              ref={scrollContainerRef}
              onScroll={handleScroll}
              className="h-full overflow-auto"
            >
              <div className="p-4 space-y-1">
              {conversationMessages.length === 0 && !selectedConversationId ? (
                <EmptyState sessionName={currentSession?.name} />
              ) : (
                <>
                  {conversationMessages.map((message, idx) => (
                    <MessageBlock
                      key={message.id}
                      message={message}
                      isFirst={idx === 0}
                    />
                  ))}
                  {/* Streaming message */}
                  {selectedConversationId && (
                    <StreamingMessage conversationId={selectedConversationId} />
                  )}
                </>
              )}
              </div>
            </div>
            {/* Fade overlay at bottom of messages */}
            <div className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-background to-transparent pointer-events-none" />
          </div>

          {/* Chat Input with floating scroll button */}
          <div className="shrink-0 relative">
            {/* Scroll to bottom button - floating */}
            <div className={cn(
              "absolute -top-7 right-4 z-10 transition-opacity duration-200",
              isUserScrolled ? "opacity-100" : "opacity-0 pointer-events-none"
            )}>
              <Button
                variant="secondary"
                size="sm"
                className="h-6 gap-1 pl-1 pr-2 text-[11px] rounded-full border border-border/50 bg-background/30 backdrop-blur-sm text-muted-foreground/70 hover:text-muted-foreground hover:bg-background/50 transition-colors"
                onClick={forceScrollToBottom}
              >
                <ChevronDown className="h-3 w-3" />
                Scroll to bottom
              </Button>
            </div>
            {children}
          </div>
        </>
      )}

      {/* Rename Conversation Dialog */}
      <Dialog open={renameDialogOpen} onOpenChange={setRenameDialogOpen}>
        <DialogContent className="sm:max-w-[300px]">
          <DialogHeader>
            <DialogTitle>Rename Conversation</DialogTitle>
          </DialogHeader>
          <Input
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                handleRenameSubmit();
              }
            }}
            placeholder="Enter new name"
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleRenameSubmit}>Rename</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function EmptyState({ sessionName }: { sessionName?: string }) {
  return (
    <div className="py-12 px-4">
      <div className="max-w-lg mx-auto text-center">
        {sessionName && (
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/10 text-primary text-sm font-medium mb-6">
            <GitBranch className="w-4 h-4" />
            {sessionName}
          </div>
        )}
        <h2 className="text-lg font-semibold mb-2">New Session</h2>
        <p className="text-sm text-muted-foreground mb-6">
          Describe your task below. An AI agent will work on it in an isolated git branch.
        </p>
        <div className="text-left bg-muted/50 rounded-lg p-4 space-y-3">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Example tasks</p>
          <div className="space-y-2 text-sm">
            <p className="text-muted-foreground">&quot;Add user authentication with JWT tokens&quot;</p>
            <p className="text-muted-foreground">&quot;Write unit tests for the payment service&quot;</p>
            <p className="text-muted-foreground">&quot;Refactor the API to use async/await&quot;</p>
          </div>
        </div>
      </div>
    </div>
  );
}

const MessageBlock = memo(function MessageBlock({ message, isFirst }: { message: Message; isFirst: boolean }) {
  const [copied, setCopied] = useState(false);

  const copyContent = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      setTimeout(() => setCopied(false), COPY_FEEDBACK_DURATION_MS);
    } catch (error) {
      console.error('Failed to copy to clipboard:', error);
    }
  }, [message.content]);

  // System messages (setup info, etc.)
  if (message.role === 'system') {
    if (message.setupInfo) {
      return (
        <div className={cn('py-3', !isFirst && 'pt-4')}>
          <SystemInfoCard setupInfo={message.setupInfo} />
        </div>
      );
    }
    // Fallback for system messages without setup info
    return (
      <div className={cn('py-2', !isFirst && 'pt-3')}>
        <div className="text-xs text-muted-foreground italic">{message.content}</div>
      </div>
    );
  }

  if (message.role === 'user') {
    return (
      <div className={cn('py-2 flex justify-end', !isFirst && 'pt-3')}>
        <div className="max-w-[85%] border border-purple-400/20 bg-purple-500/10 rounded-2xl rounded-br-md px-4 py-2">
          <p className="text-[13px] leading-relaxed">{message.content}</p>
        </div>
      </div>
    );
  }

  return (
    <div className={cn('py-2', !isFirst && 'border-t border-border/50')}>
      <div className="space-y-1.5">
          {/* Tool Usage History */}
          {message.toolUsage && message.toolUsage.length > 0 && (
            <ToolUsageHistory tools={message.toolUsage} />
          )}

          {/* Verification Results */}
          {message.verificationResults && message.verificationResults.length > 0 && (
            <VerificationBlock results={message.verificationResults} />
          )}

          {/* Main Content */}
          {message.content && (
            <ContextMenu>
              <ContextMenuTrigger asChild>
                <div className="group relative">
                  <div className="prose prose-sm dark:prose-invert max-w-none text-[13px] leading-relaxed prose-p:my-1 prose-pre:my-2 prose-pre:bg-muted/50 prose-pre:border prose-pre:border-border/50 prose-pre:text-xs prose-code:text-[11px] prose-code:before:content-none prose-code:after:content-none prose-headings:text-sm prose-headings:font-semibold prose-headings:my-2 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5 prose-ul:marker:text-primary prose-ol:marker:text-primary">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      rehypePlugins={[rehypeHighlight]}
                      components={{ pre: MarkdownPre, code: MarkdownCode }}
                    >
                      {message.content}
                    </ReactMarkdown>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="absolute top-0 right-0 h-5 w-5 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={copyContent}
                  >
                    {copied ? (
                      <Check className="h-2.5 w-2.5 text-green-500" />
                    ) : (
                      <Copy className="h-2.5 w-2.5" />
                    )}
                  </Button>
                </div>
              </ContextMenuTrigger>
              <ContextMenuContent>
                <ContextMenuItem onClick={copyContent}>
                  <Copy className="mr-2 h-4 w-4" />
                  Copy
                </ContextMenuItem>
                <ContextMenuItem onClick={copyContent}>
                  <FileText className="mr-2 h-4 w-4" />
                  Copy as Markdown
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          )}

          {/* File Changes */}
          {message.fileChanges && message.fileChanges.length > 0 && (
            <FileChangesBlock changes={message.fileChanges} />
          )}

          {/* Run Summary */}
          {message.runSummary && (
            <RunSummaryBlock summary={message.runSummary} />
          )}
      </div>
    </div>
  );
}, (prevProps, nextProps) => {
  // Custom comparison: only re-render if message content/id changed or isFirst changed
  return prevProps.message.id === nextProps.message.id &&
         prevProps.message.content === nextProps.message.content &&
         prevProps.message.timestamp === nextProps.message.timestamp &&
         prevProps.isFirst === nextProps.isFirst;
});

function VerificationBlock({ results }: { results: VerificationResult[] }) {
  const [isOpen, setIsOpen] = useState(true);
  const allPassed = results.every((r) => r.status === 'pass');
  const hasFailed = results.some((r) => r.status === 'fail');
  const isRunning = results.some((r) => r.status === 'running');

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger className="flex items-center gap-2 text-xs font-medium hover:text-foreground transition-colors w-full">
        {isOpen ? (
          <ChevronDown className="w-3 h-3" />
        ) : (
          <ChevronRight className="w-3 h-3" />
        )}
        <span>Verification</span>
        {isRunning ? (
          <Loader2 className="w-3 h-3 animate-spin text-primary" />
        ) : allPassed ? (
          <CheckCircle2 className="w-3 h-3 text-green-500" />
        ) : hasFailed ? (
          <XCircle className="w-3 h-3 text-red-500" />
        ) : null}
        <span className="text-muted-foreground font-normal">
          {results.filter((r) => r.status === 'pass').length}/{results.length} passed
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-2 rounded border bg-muted/30 divide-y divide-border/50">
          {results.map((result, idx) => (
            <div key={idx} className="flex items-center gap-2 px-3 py-2 text-xs">
              {result.status === 'pass' && (
                <CheckCircle2 className="w-3.5 h-3.5 text-green-500 shrink-0" />
              )}
              {result.status === 'fail' && (
                <XCircle className="w-3.5 h-3.5 text-red-500 shrink-0" />
              )}
              {result.status === 'running' && (
                <Loader2 className="w-3.5 h-3.5 text-primary animate-spin shrink-0" />
              )}
              {result.status === 'skipped' && (
                <Circle className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              )}
              <span className="font-mono flex-1 truncate">{result.name}</span>
              {result.details && (
                <span className="text-muted-foreground truncate max-w-[200px]">
                  {result.details}
                </span>
              )}
            </div>
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function FileChangesBlock({ changes }: { changes: FileChange[] }) {
  const [isOpen, setIsOpen] = useState(false);
  const totalAdditions = changes.reduce((sum, c) => sum + c.additions, 0);
  const totalDeletions = changes.reduce((sum, c) => sum + c.deletions, 0);

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger className="flex items-center gap-2 text-xs font-medium hover:text-foreground transition-colors">
        {isOpen ? (
          <ChevronDown className="w-3 h-3" />
        ) : (
          <ChevronRight className="w-3 h-3" />
        )}
        <FileCode className="w-3 h-3" />
        <span>{changes.length} file{changes.length !== 1 ? 's' : ''} changed</span>
        <span className="font-mono text-green-500">+{totalAdditions}</span>
        <span className="font-mono text-red-500">-{totalDeletions}</span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-2 rounded border bg-muted/30 divide-y divide-border/50">
          {changes.map((change, idx) => (
            <div
              key={idx}
              className="flex items-center gap-2 px-3 py-1.5 text-xs font-mono hover:bg-muted/50 cursor-pointer"
            >
              <FileCode className="w-3 h-3 text-muted-foreground shrink-0" />
              <span className="flex-1 truncate">{change.path}</span>
              <span className="text-green-500">+{change.additions}</span>
              <span className="text-red-500">-{change.deletions}</span>
            </div>
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

