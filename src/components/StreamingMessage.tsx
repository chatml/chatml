'use client';

import { useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { useAppStore } from '@/stores/appStore';
import { Loader2, AlertCircle, Brain, Clock } from 'lucide-react';
import { ActiveToolsDisplay } from '@/components/ToolUsageBlock';
import { MarkdownPre, MarkdownCode } from '@/components/MarkdownCodeBlock';

interface StreamingMessageProps {
  conversationId: string;
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

  // Truncate thinking text for display
  const truncateThinking = (text: string, maxLength = 60) => {
    if (text.length <= maxLength) return text;
    return text.slice(0, maxLength) + '...';
  };

  return (
    <div className="py-2 border-t border-border/50" role="status" aria-live="polite" aria-atomic="false">
      <div className="space-y-1.5">
          {/* Thinking indicator */}
          {(streaming?.isThinking || streaming?.thinking) && (
            <div className="flex items-center gap-2" aria-label="Agent is thinking">
              <Brain className="w-3.5 h-3.5 text-muted-foreground" aria-hidden="true" />
              <span className="text-xs font-medium text-muted-foreground">Thinking</span>
              {streaming.thinking && (
                <code className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-mono truncate max-w-[300px]">
                  {truncateThinking(streaming.thinking)}
                </code>
              )}
              {streaming.isThinking && !streaming.thinking && (
                <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" aria-hidden="true" />
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

          {/* Error display */}
          {streaming?.error && (
            <div
              role="alert"
              className="flex items-start gap-2 p-2 rounded-md bg-destructive/10 border border-destructive/20"
            >
              <AlertCircle className="w-3.5 h-3.5 text-destructive shrink-0 mt-0.5" aria-hidden="true" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-destructive">Error</p>
                <p className="text-[11px] text-destructive/80 mt-0.5">{streaming.error}</p>
              </div>
              <button
                onClick={() => clearStreamingText(conversationId)}
                className="text-[10px] text-muted-foreground hover:text-foreground"
                aria-label="Dismiss error"
              >
                Dismiss
              </button>
            </div>
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
