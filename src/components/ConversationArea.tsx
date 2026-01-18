'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { useAppStore } from '@/stores/appStore';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  Plus,
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
  SquareCheck,
  Square,
  GitBranch,
  FileQuestion,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { CodeViewer } from '@/components/CodeViewer';
import { FileTabIcon } from '@/components/FileTabIcon';
import { ConversationTabs } from '@/components/ConversationTabs';
import { StreamingMessage } from '@/components/StreamingMessage';
import { RunSummaryBlock } from '@/components/RunSummaryBlock';
import { ToolUsageHistory } from '@/components/ToolUsageHistory';
import { DiffViewer } from '@/components/DiffViewer';
import { SystemInfoCard } from '@/components/SystemInfoCard';
import type { Message, VerificationResult, FileChange } from '@/lib/types';

interface ConversationAreaProps {
  children?: React.ReactNode;
}

export function ConversationArea({ children }: ConversationAreaProps) {
  const {
    conversations,
    messages,
    sessions,
    selectedSessionId,
    selectedConversationId,
    selectConversation,
    addConversation,
    removeConversation,
    fileTabs,
    selectedFileTabId,
    selectFileTab,
    closeFileTab,
    streamingState,
  } = useAppStore();

  const currentSession = sessions.find((s) => s.id === selectedSessionId);
  const sessionConversations = conversations.filter(
    (c) => c.sessionId === selectedSessionId
  );
  const conversationMessages = messages.filter(
    (m) => m.conversationId === selectedConversationId
  );

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

  // Scroll when messages change or streaming updates
  const streamingText = selectedConversationId
    ? streamingState[selectedConversationId]?.text
    : null;

  useEffect(() => {
    scrollToBottom();
  }, [conversationMessages.length, streamingText, scrollToBottom]);

  // Reset scroll state when conversation changes
  useEffect(() => {
    setIsUserScrolled(false);
    // Scroll to bottom immediately when switching conversations
    setTimeout(() => {
      const container = scrollContainerRef.current;
      if (container) {
        container.scrollTop = container.scrollHeight;
      }
    }, 0);
  }, [selectedConversationId]);

  // Get current file tab
  const currentFileTab = fileTabs.find((t) => t.id === selectedFileTabId);

  // Determine what's currently active (conversation or file)
  const isFileActive = selectedFileTabId !== null;

  const handleNewConversation = (type: 'task' | 'review' | 'chat' = 'task') => {
    if (!selectedSessionId) return;
    const existingConvs = conversations.filter(c => c.sessionId === selectedSessionId && c.type === type);
    const typeLabel = type.charAt(0).toUpperCase() + type.slice(1);
    const newConversation = {
      id: crypto.randomUUID(),
      sessionId: selectedSessionId,
      type,
      name: `${typeLabel} #${existingConvs.length + 1}`,
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

  const handleSelectFileTab = (id: string) => {
    selectFileTab(id);
  };

  const handleCloseFileTab = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    closeFileTab(id);
  };

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
      {/* Tabs Row - File tab first, then conversations */}
      <div className="flex items-center gap-1 px-1.5 py-1 border-b shrink-0 overflow-x-auto">
        {/* File Tab - always first, only one */}
        {fileTabs.length > 0 && fileTabs[0] && (
          <>
            <div
              className={cn(
                'group flex items-center gap-1.5 px-2.5 py-1 rounded cursor-pointer text-xs font-medium transition-colors shrink-0',
                selectedFileTabId === fileTabs[0].id
                  ? 'bg-muted text-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
              )}
              onClick={() => handleSelectFileTab(fileTabs[0].id)}
            >
              <FileTabIcon filename={fileTabs[0].name} className="w-3 h-3" />
              <span className="max-w-[120px] truncate">{fileTabs[0].name}</span>
              {fileTabs[0].isDirty && (
                <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
              )}
              <button
                className="opacity-0 group-hover:opacity-100 transition-opacity hover:text-destructive"
                onClick={(e) => handleCloseFileTab(fileTabs[0].id, e)}
              >
                <X className="h-3 w-3" />
              </button>
            </div>
            {/* Separator between file and conversations */}
            <div className="h-4 w-px bg-border mx-1 shrink-0" />
          </>
        )}

        {/* Conversation Tabs */}
        <ConversationTabs
          sessionId={selectedSessionId}
          onNewConversation={handleNewConversation}
        />
      </div>

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
              // Diff view
              <DiffViewer
                oldContent={currentFileTab.diff.oldContent}
                newContent={currentFileTab.diff.newContent}
                oldFilename={currentFileTab.name}
                newFilename={currentFileTab.name}
              />
            ) : (
              // Regular file view
              <CodeViewer
                content={currentFileTab.content || ''}
                filename={currentFileTab.name}
                isLoading={currentFileTab.isLoading}
              />
            )}
          </div>
          {/* No chat input when viewing files */}
        </>
      ) : (
        <>
          {/* Messages */}
          <div
            ref={scrollContainerRef}
            onScroll={handleScroll}
            className="flex-1 overflow-auto min-h-0"
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

          {/* Chat Input */}
          <div className="shrink-0">{children}</div>
        </>
      )}
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

function MessageBlock({ message, isFirst }: { message: Message; isFirst: boolean }) {
  const [copied, setCopied] = useState(false);

  const copyContent = () => {
    navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const formatDuration = (ms?: number) => {
    if (!ms) return '';
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    if (minutes > 0) return `${minutes}m ${remainingSeconds}s`;
    return `${seconds}s`;
  };

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
        <div className="max-w-[85%] bg-primary text-primary-foreground rounded-2xl rounded-br-md px-4 py-2">
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
            <div className="group relative">
              <div className="prose prose-sm dark:prose-invert max-w-none text-[13px] leading-relaxed prose-p:my-1 prose-pre:my-2 prose-pre:bg-muted prose-pre:border prose-pre:text-xs prose-code:text-[11px] prose-code:before:content-none prose-code:after:content-none prose-headings:text-sm prose-headings:font-semibold prose-headings:my-2 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5">
                <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
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
}

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
