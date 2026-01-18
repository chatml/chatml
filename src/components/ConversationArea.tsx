'use client';

import { useState } from 'react';
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
  Zap,
  MessageSquare,
  Circle,
  SquareCheck,
  Square,
  GitBranch,
} from 'lucide-react';
import { cn } from '@/lib/utils';
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
  } = useAppStore();

  const currentSession = sessions.find((s) => s.id === selectedSessionId);
  const sessionConversations = conversations.filter(
    (c) => c.sessionId === selectedSessionId
  );
  const conversationMessages = messages.filter(
    (m) => m.conversationId === selectedConversationId
  );

  const handleNewConversation = () => {
    if (!selectedSessionId) return;
    const newConversation = {
      id: crypto.randomUUID(),
      sessionId: selectedSessionId,
      title: 'New conversation',
      isActive: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    addConversation(newConversation);
    selectConversation(newConversation.id);
  };

  if (!selectedSessionId) {
    return (
      <div className="h-full flex flex-col">
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
    <div className="h-full flex flex-col">
      {/* Conversation Tabs */}
      <div className="flex items-center gap-1 px-3 py-1.5 border-b shrink-0">
        {sessionConversations.map((conv) => (
          <div
            key={conv.id}
            className={cn(
              'group flex items-center gap-1.5 px-2.5 py-1 rounded cursor-pointer text-xs font-medium transition-colors',
              selectedConversationId === conv.id
                ? 'bg-muted text-foreground'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
            )}
            onClick={() => selectConversation(conv.id)}
          >
            <MessageSquare className="w-3 h-3" />
            <span className="max-w-[100px] truncate">{conv.title}</span>
            {sessionConversations.length > 1 && (
              <button
                className="opacity-0 group-hover:opacity-100 transition-opacity hover:text-destructive"
                onClick={(e) => {
                  e.stopPropagation();
                  removeConversation(conv.id);
                }}
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        ))}
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 text-muted-foreground hover:text-foreground"
          onClick={handleNewConversation}
        >
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-auto min-h-0">
        <div className="p-4 space-y-1">
          {conversationMessages.length === 0 ? (
            <EmptyState sessionName={currentSession?.name} />
          ) : (
            conversationMessages.map((message, idx) => (
              <MessageBlock
                key={message.id}
                message={message}
                isFirst={idx === 0}
              />
            ))
          )}
        </div>
      </div>

      {/* Chat Input */}
      <div className="shrink-0">{children}</div>
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

  if (message.role === 'user') {
    return (
      <div className={cn('py-3', !isFirst && 'border-t border-border/50')}>
        <div className="flex items-start gap-3">
          <div className="w-5 h-5 rounded bg-muted flex items-center justify-center shrink-0 mt-0.5">
            <span className="text-[10px] font-semibold text-muted-foreground">U</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm leading-relaxed">{message.content}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={cn('py-3', !isFirst && 'border-t border-border/50')}>
      <div className="flex items-start gap-3">
        <div className="w-5 h-5 rounded bg-primary/15 flex items-center justify-center shrink-0 mt-0.5">
          <Zap className="w-3 h-3 text-primary" />
        </div>
        <div className="flex-1 min-w-0 space-y-3">
          {/* Verification Results */}
          {message.verificationResults && message.verificationResults.length > 0 && (
            <VerificationBlock results={message.verificationResults} />
          )}

          {/* Main Content */}
          {message.content && (
            <div className="group relative">
              <div className="prose prose-sm dark:prose-invert max-w-none prose-pre:bg-muted prose-pre:border prose-code:text-xs prose-code:before:content-none prose-code:after:content-none prose-p:leading-relaxed prose-headings:font-semibold prose-headings:tracking-tight">
                <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
                  {message.content}
                </ReactMarkdown>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="absolute top-0 right-0 h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={copyContent}
              >
                {copied ? (
                  <Check className="h-3 w-3 text-green-500" />
                ) : (
                  <Copy className="h-3 w-3" />
                )}
              </Button>
            </div>
          )}

          {/* File Changes */}
          {message.fileChanges && message.fileChanges.length > 0 && (
            <FileChangesBlock changes={message.fileChanges} />
          )}

          {/* Metadata */}
          {message.durationMs && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Clock className="w-3 h-3" />
              <span>{formatDuration(message.durationMs)}</span>
            </div>
          )}
        </div>
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
