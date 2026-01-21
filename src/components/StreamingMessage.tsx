'use client';

import { useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { useAppStore } from '@/stores/appStore';
import { Loader2, AlertCircle, Brain, Clock, ChevronDown, ChevronRight } from 'lucide-react';
import { ActiveToolsDisplay } from '@/components/ToolUsageBlock';
import { MarkdownPre, MarkdownCode } from '@/components/MarkdownCodeBlock';
import { cn } from '@/lib/utils';

interface StreamingMessageProps {
  conversationId: string;
}

// Enhanced error display component
function ErrorDisplay({ error, onDismiss }: { error: string; onDismiss: () => void }) {
  const [isExpanded, setIsExpanded] = useState(false);

  // Check if error is long enough to need expansion
  const ERROR_TRUNCATE_LENGTH = 150;
  const needsTruncation = error.length > ERROR_TRUNCATE_LENGTH;
  const displayError = isExpanded || !needsTruncation
    ? error
    : error.slice(0, ERROR_TRUNCATE_LENGTH) + '...';

  // Try to detect if error looks like a stack trace or structured error
  const hasStackTrace = error.includes('\n') && (error.includes('at ') || error.includes('Error:'));

  return (
    <div
      role="alert"
      className="rounded-md bg-destructive/10 border border-destructive/20 overflow-hidden"
    >
      <div className="flex items-start gap-2 p-2">
        <AlertCircle className="w-3.5 h-3.5 text-destructive shrink-0 mt-0.5" aria-hidden="true" />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-destructive">Error</p>
          <p
            className={cn(
              'text-[11px] text-destructive/80 mt-0.5',
              hasStackTrace && isExpanded && 'font-mono whitespace-pre-wrap'
            )}
          >
            {displayError}
          </p>
          {needsTruncation && (
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="mt-1 text-[10px] text-destructive/60 hover:text-destructive flex items-center gap-0.5"
            >
              {isExpanded ? (
                <>
                  <ChevronDown className="w-3 h-3" />
                  <span>show less</span>
                </>
              ) : (
                <>
                  <ChevronRight className="w-3 h-3" />
                  <span>show full error</span>
                </>
              )}
            </button>
          )}
        </div>
        <button
          onClick={onDismiss}
          className="text-[10px] text-muted-foreground hover:text-foreground shrink-0"
          aria-label="Dismiss error"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}

export function StreamingMessage({ conversationId }: StreamingMessageProps) {
  const { streamingState, activeTools, clearStreamingText } = useAppStore();
  const [elapsedTime, setElapsedTime] = useState(0);

  const streaming = streamingState[conversationId];
  const tools = activeTools[conversationId] || [];

  // Update elapsed time every second while streaming
  useEffect(() => {
    if (!streaming?.isStreaming || !streaming?.startTime) {
      queueMicrotask(() => setElapsedTime(0));
      return;
    }

    // Set initial elapsed time
    const startTime = streaming.startTime;
    queueMicrotask(() => {
      setElapsedTime(Math.floor((Date.now() - startTime) / 1000));
    });

    const interval = setInterval(() => {
      if (streaming?.startTime) {
        setElapsedTime(Math.floor((Date.now() - streaming.startTime) / 1000));
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [streaming?.isStreaming, streaming?.startTime]);

  // Thinking expansion state (must be before early return to satisfy Rules of Hooks)
  // Note: We don't need to reset this when thinking becomes null because the
  // expansion UI only renders when there's thinking content to show
  const [isThinkingExpanded, setIsThinkingExpanded] = useState(false);

  // Format elapsed time as mm:ss
  const formatElapsedTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Don't render if no streaming content, no active tools, no thinking, and no error
  if (!streaming?.text && tools.length === 0 && !streaming?.error && !streaming?.thinking && !streaming?.isThinking && !streaming?.isStreaming) {
    return null;
  }

  // Truncate thinking text for display (increased limit)
  const THINKING_TRUNCATE_LENGTH = 120;
  const truncateThinking = (text: string) => {
    if (text.length <= THINKING_TRUNCATE_LENGTH) return text;
    return text.slice(0, THINKING_TRUNCATE_LENGTH) + '...';
  };

  const thinkingNeedsTruncation = streaming?.thinking && streaming.thinking.length > THINKING_TRUNCATE_LENGTH;

  return (
    <div className="py-2 border-t border-border/50" role="status" aria-live="polite" aria-atomic="false">
      <div className="space-y-1.5">
          {/* Thinking indicator with expandable content */}
          {(streaming?.isThinking || streaming?.thinking) && (
            <div className="flex flex-col gap-1" aria-label="Agent is thinking">
              <div className="flex items-center gap-2">
                <Brain className="w-3.5 h-3.5 text-muted-foreground shrink-0" aria-hidden="true" />
                <span className="text-xs font-medium text-muted-foreground">Thinking</span>
                {streaming.isThinking && (
                  <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" aria-hidden="true" />
                )}
                {thinkingNeedsTruncation && (
                  <button
                    onClick={() => setIsThinkingExpanded(!isThinkingExpanded)}
                    className="flex items-center gap-0.5 text-[10px] text-primary hover:text-primary/80"
                  >
                    {isThinkingExpanded ? (
                      <>
                        <ChevronDown className="w-3 h-3" />
                        <span>collapse</span>
                      </>
                    ) : (
                      <>
                        <ChevronRight className="w-3 h-3" />
                        <span>expand</span>
                      </>
                    )}
                  </button>
                )}
              </div>
              {streaming.thinking && (
                <div
                  className={cn(
                    'ml-5 text-[11px] px-2 py-1.5 rounded bg-muted/50 text-muted-foreground font-mono',
                    'border border-border/30',
                    isThinkingExpanded ? 'whitespace-pre-wrap max-h-[200px] overflow-y-auto' : 'truncate max-w-full'
                  )}
                >
                  {isThinkingExpanded ? streaming.thinking : truncateThinking(streaming.thinking)}
                </div>
              )}
            </div>
          )}

          {/* Active Tools */}
          <ActiveToolsDisplay conversationId={conversationId} />

          {/* Streaming Text */}
          {streaming?.text && (
            <div className="prose prose-sm dark:prose-invert max-w-none text-[13px] leading-relaxed prose-p:my-1 prose-pre:my-2 prose-pre:bg-muted/50 prose-pre:border prose-pre:border-border/50 prose-pre:text-xs prose-code:text-[11px] prose-code:before:content-none prose-code:after:content-none prose-headings:text-sm prose-headings:font-semibold prose-headings:my-2 prose-ul:marker:text-primary prose-ol:marker:text-primary">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[rehypeHighlight]}
                components={{ pre: MarkdownPre, code: MarkdownCode }}
              >
                {streaming.text}
              </ReactMarkdown>
            </div>
          )}

          {/* Enhanced error display */}
          {streaming?.error && (
            <ErrorDisplay
              error={streaming.error}
              onDismiss={() => clearStreamingText(conversationId)}
            />
          )}

          {/* Persistent working indicator with elapsed time */}
          {streaming?.isStreaming && !streaming?.error && (
            <div
              className="flex items-center gap-2 pt-2 mt-2 border-t border-border/30"
              aria-label={`Agent is working, elapsed time: ${formatElapsedTime(elapsedTime)}`}
            >
              <Loader2 className="w-3 h-3 animate-spin text-primary" aria-hidden="true" />
              <span className="text-[11px] text-muted-foreground">Agent is working</span>
              <div className="flex items-center gap-1 text-[11px] text-muted-foreground/70" aria-hidden="true">
                <Clock className="w-3 h-3" />
                <span className="font-mono">{formatElapsedTime(elapsedTime)}</span>
              </div>
            </div>
          )}
      </div>
    </div>
  );
}
