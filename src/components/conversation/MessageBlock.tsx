'use client';

import { useState, useCallback, useMemo, memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { Button } from '@/components/ui/button';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { Copy, Check, FileText } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Message } from '@/lib/types';
import { COPY_FEEDBACK_DURATION_MS } from '@/lib/constants';
import { copyToClipboard } from '@/lib/tauri';
import { ToolUsageHistory } from '@/components/conversation/ToolUsageHistory';
import { VerificationBlock } from '@/components/conversation/VerificationBlock';
import { FileChangesBlock } from '@/components/conversation/FileChangesBlock';
import { RunSummaryBlock } from '@/components/conversation/RunSummaryBlock';
import { SystemInfoCard } from '@/components/shared/SystemInfoCard';
import { MarkdownPre, MarkdownCode } from '@/components/shared/MarkdownCodeBlock';
import { highlightSearchMatches } from '@/components/conversation/ChatSearchBar';
import { ErrorBoundary } from '@/components/shared/ErrorBoundary';
import { InlineErrorFallback } from '@/components/shared/ErrorFallbacks';

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
        <div className="text-xs text-muted-foreground italic">
          {highlightedContent || message.content}
        </div>
      </div>
    );
  }

  if (message.role === 'user') {
    return (
      <div className={cn('py-2 flex justify-end', !isFirst && 'pt-3')}>
        <div className="max-w-[85%] border border-purple-400/20 bg-purple-500/10 rounded-2xl rounded-br-md px-4 py-2">
          <p className="text-sm leading-relaxed whitespace-pre-wrap">
            {highlightedContent || message.content}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={cn('py-2', !isFirst && 'border-t border-border')}>
      <div className="space-y-1.5">
          {/* Tool Usage History */}
          {message.toolUsage && message.toolUsage.length > 0 && (
            <ErrorBoundary
              section="ToolUsage"
              fallback={<InlineErrorFallback message="Unable to display tool usage" />}
            >
              <ToolUsageHistory tools={message.toolUsage} />
            </ErrorBoundary>
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
                  <div className="prose prose-sm dark:prose-invert max-w-none text-sm leading-relaxed prose-p:my-1.5 prose-pre:my-2 prose-pre:bg-muted/50 prose-pre:border prose-pre:border-border/50 prose-pre:text-xs prose-code:text-xs prose-code:before:content-none prose-code:after:content-none prose-headings:text-base prose-headings:font-semibold prose-headings:my-2 prose-ul:my-1.5 prose-ol:my-1.5 prose-li:my-0.5 prose-ul:marker:text-primary prose-ol:marker:text-primary">
                    <ErrorBoundary
                      section="MessageContent"
                      fallback={
                        <div className="text-sm text-muted-foreground italic">
                          Unable to render message content
                        </div>
                      }
                    >
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        rehypePlugins={[rehypeHighlight]}
                        components={{ pre: MarkdownPre, code: MarkdownCode }}
                      >
                        {message.content}
                      </ReactMarkdown>
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
  // If neither has matches, skip comparing search navigation state
  if (!nextProps.hasMatches && !prevProps.hasMatches) {
    return prevProps.message.id === nextProps.message.id &&
           prevProps.message.content === nextProps.message.content &&
           prevProps.message.timestamp === nextProps.message.timestamp &&
           prevProps.isFirst === nextProps.isFirst &&
           prevProps.searchQuery === nextProps.searchQuery;
  }
  // Full comparison for messages with matches
  return prevProps.message.id === nextProps.message.id &&
         prevProps.message.content === nextProps.message.content &&
         prevProps.message.timestamp === nextProps.message.timestamp &&
         prevProps.isFirst === nextProps.isFirst &&
         prevProps.searchQuery === nextProps.searchQuery &&
         prevProps.currentMatchIndex === nextProps.currentMatchIndex &&
         prevProps.matchOffset === nextProps.matchOffset;
});
