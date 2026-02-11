'use client';

import { useState, useCallback, useMemo, memo } from 'react';
import { Button } from '@/components/ui/button';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { Copy, Check, FileText, Brain, ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Message } from '@/lib/types';
import { COPY_FEEDBACK_DURATION_MS } from '@/lib/constants';
import { copyToClipboard } from '@/lib/tauri';
import { ToolUsageHistory } from '@/components/conversation/ToolUsageHistory';
import { ToolUsageBlock } from '@/components/conversation/ToolUsageBlock';
import { VerificationBlock } from '@/components/conversation/VerificationBlock';
import { FileChangesBlock } from '@/components/conversation/FileChangesBlock';
import { RunSummaryBlock } from '@/components/conversation/RunSummaryBlock';
import { SystemInfoCard } from '@/components/shared/SystemInfoCard';
import { CachedMarkdown } from '@/components/shared/CachedMarkdown';
import { highlightSearchMatches } from '@/components/conversation/ChatSearchBar';
import { ErrorBoundary } from '@/components/shared/ErrorBoundary';
import { InlineErrorFallback } from '@/components/shared/ErrorFallbacks';
import { AttachmentGrid } from '@/components/conversation/AttachmentGrid';
import { MentionText } from '@/components/conversation/MentionText';
import { useSettingsStore } from '@/stores/settingsStore';

export interface MessageBlockProps {
  message: Message;
  isFirst: boolean;
  searchQuery?: string;
  currentMatchIndex?: number;
  matchOffset?: number;
  hasMatches?: boolean;
}

export const MessageBlock = memo(function MessageBlock({
  message,
  isFirst,
  searchQuery = '',
  currentMatchIndex = 0,
  matchOffset = 0,
  // hasMatches is intentionally not destructured — it's only used by the memo
  // comparator below to skip re-renders for messages without search matches.
}: MessageBlockProps) {
  const [copied, setCopied] = useState(false);
  const [isThinkingExpanded, setIsThinkingExpanded] = useState(false);
  const showThinkingBlocks = useSettingsStore((s) => s.showThinkingBlocks);

  const copyContent = useCallback(async () => {
    const success = await copyToClipboard(message.content);
    if (success) {
      setCopied(true);
      setTimeout(() => setCopied(false), COPY_FEEDBACK_DURATION_MS);
    }
  }, [message.content]);

  // Highlighted content for plain text messages
  const highlightedContent = useMemo(() => {
    if (!searchQuery) return null;
    return highlightSearchMatches(message.content, searchQuery, currentMatchIndex, matchOffset);
  }, [message.content, searchQuery, currentMatchIndex, matchOffset]);

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
        <div className="text-base text-muted-foreground">
          {highlightedContent || message.content}
        </div>
      </div>
    );
  }

  if (message.role === 'user') {
    return (
      <div className={cn('py-2 flex justify-end', !isFirst && 'pt-3')}>
        <div className="bg-surface-2 dark:bg-[#090909] rounded-lg px-4 py-2.5">
          {message.attachments && message.attachments.length > 0 && (
            <AttachmentGrid attachments={message.attachments} readOnly />
          )}
          <p className="text-base leading-relaxed whitespace-pre-wrap">
            {highlightedContent || <MentionText content={message.content} />}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={cn('py-2', !isFirst && 'border-t border-border')}>
      <div className="space-y-1.5">
        {/* Thinking/Reasoning Content */}
        {message.role === 'assistant' && showThinkingBlocks && message.thinkingContent && (
          <div className="flex flex-col gap-1">
            <button
              onClick={() => setIsThinkingExpanded(!isThinkingExpanded)}
              className="flex items-center gap-2 text-xs text-ai-thinking hover:text-ai-thinking/80 transition-colors"
            >
              <Brain className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              <span className="font-medium">Thinking</span>
              {isThinkingExpanded ? (
                <ChevronDown className="w-3 h-3" />
              ) : (
                <ChevronRight className="w-3 h-3" />
              )}
            </button>
            {isThinkingExpanded && (
              <div className="ml-5 text-xs px-2 py-1.5 rounded bg-ai-thinking/10 text-muted-foreground font-mono border border-ai-thinking/20 whitespace-pre-wrap max-h-[300px] overflow-y-auto">
                {message.thinkingContent}
              </div>
            )}
          </div>
        )}

        {/* Interleaved timeline rendering (preserves text/tool ordering from streaming) */}
        {message.timeline && message.timeline.length > 0 && message.toolUsage ? (
          <>
            {message.timeline.map((entry, idx) => {
              if (entry.type === 'text') {
                return (
                  <div
                    key={`tl-text-${idx}`}
                    className="prose prose-base dark:prose-invert max-w-none text-base leading-relaxed prose-p:my-3 prose-pre:my-2 prose-pre:bg-muted/50 prose-pre:border prose-pre:border-border/50 prose-pre:text-xs prose-code:text-xs prose-code:before:content-none prose-code:after:content-none prose-headings:font-semibold prose-headings:my-2 prose-ul:my-1.5 prose-ol:my-1.5 prose-li:my-0.5 prose-ul:marker:text-primary prose-ol:marker:text-primary"
                  >
                    <CachedMarkdown
                      cacheKey={`msg:${message.id}:tl:${idx}`}
                      content={entry.content}
                    />
                  </div>
                );
              } else {
                const tool = message.toolUsage!.find(t => t.id === entry.toolId);
                if (!tool) return null;
                return (
                  <ToolUsageBlock
                    key={`tl-tool-${entry.toolId}`}
                    id={tool.id}
                    tool={tool.tool}
                    params={tool.params}
                    isActive={false}
                    success={tool.success}
                    summary={tool.summary}
                    duration={tool.durationMs}
                    stdout={tool.stdout}
                    stderr={tool.stderr}
                  />
                );
              }
            })}
          </>
        ) : (
          <>
            {/* Legacy fallback: Tool Usage History (collapsed) + full content */}
            {message.toolUsage && message.toolUsage.length > 0 && (
              <ErrorBoundary
                section="ToolUsage"
                fallback={<InlineErrorFallback message="Unable to display tool usage" />}
              >
                <ToolUsageHistory tools={message.toolUsage} />
              </ErrorBoundary>
            )}

            {/* Main Content */}
            {message.content && (
              <ContextMenu>
                <ContextMenuTrigger asChild>
                  <div className="group relative">
                    <div className="prose prose-base dark:prose-invert max-w-none text-base leading-relaxed prose-p:my-3 prose-pre:my-2 prose-pre:bg-muted/50 prose-pre:border prose-pre:border-border/50 prose-pre:text-xs prose-code:text-xs prose-code:before:content-none prose-code:after:content-none prose-headings:font-semibold prose-headings:my-2 prose-ul:my-1.5 prose-ol:my-1.5 prose-li:my-0.5 prose-ul:marker:text-primary prose-ol:marker:text-primary">
                      <ErrorBoundary
                        section="MessageContent"
                        fallback={
                          <div className="text-sm text-muted-foreground italic">
                            Unable to render message content
                          </div>
                        }
                      >
                        <CachedMarkdown
                          cacheKey={`msg:${message.id}`}
                          content={message.content}
                        />
                      </ErrorBoundary>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="absolute top-0 right-0 h-5 w-5 opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={copyContent}
                    >
                      {copied ? (
                        <Check className="h-2.5 w-2.5 text-text-success" />
                      ) : (
                        <Copy className="h-2.5 w-2.5" />
                      )}
                    </Button>
                  </div>
                </ContextMenuTrigger>
                <ContextMenuContent>
                  <ContextMenuItem onClick={copyContent}>
                    <Copy className="size-4" />
                    Copy
                  </ContextMenuItem>
                  <ContextMenuItem onClick={copyContent}>
                    <FileText className="size-4" />
                    Copy as Markdown
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            )}
          </>
        )}

        {/* Verification Results */}
        {message.verificationResults && message.verificationResults.length > 0 && (
          <VerificationBlock results={message.verificationResults} />
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
  const prev = prevProps.message;
  const next = nextProps.message;

  // Core fields
  if (prev.id !== next.id ||
    prev.content !== next.content ||
    prev.timestamp !== next.timestamp ||
    prev.role !== next.role ||
    prev.thinkingContent !== next.thinkingContent ||
    prevProps.isFirst !== nextProps.isFirst ||
    prevProps.searchQuery !== nextProps.searchQuery) {
    return false;
  }

  // Structured fields — reference equality (updateMessage spreads new objects/arrays)
  if (prev.toolUsage !== next.toolUsage ||
    prev.timeline !== next.timeline ||
    prev.fileChanges !== next.fileChanges ||
    prev.verificationResults !== next.verificationResults ||
    prev.attachments !== next.attachments ||
    prev.runSummary !== next.runSummary ||
    prev.setupInfo !== next.setupInfo) {
    return false;
  }

  // Search navigation — only compare when relevant
  if (nextProps.hasMatches || prevProps.hasMatches) {
    if (prevProps.currentMatchIndex !== nextProps.currentMatchIndex ||
      prevProps.matchOffset !== nextProps.matchOffset) {
      return false;
    }
  }

  return true;
});
