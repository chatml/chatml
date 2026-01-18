'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { useAppStore } from '@/stores/appStore';
import { Zap, Loader2, AlertCircle } from 'lucide-react';
import { ActiveToolsDisplay } from '@/components/ToolUsageBlock';

interface StreamingMessageProps {
  conversationId: string;
}

export function StreamingMessage({ conversationId }: StreamingMessageProps) {
  const { streamingState, activeTools, clearStreamingText } = useAppStore();

  const streaming = streamingState[conversationId];
  const tools = activeTools[conversationId] || [];

  // Don't render if no streaming content, no active tools, and no error
  if (!streaming?.text && tools.length === 0 && !streaming?.error) {
    return null;
  }

  return (
    <div className="py-3 border-t border-border/50">
      <div className="flex items-start gap-3">
        <div className="w-5 h-5 rounded bg-primary/15 flex items-center justify-center shrink-0 mt-0.5">
          <Zap className="w-3 h-3 text-primary" />
        </div>
        <div className="flex-1 min-w-0 space-y-2">
          {/* Active Tools */}
          <ActiveToolsDisplay conversationId={conversationId} />

          {/* Streaming Text */}
          {streaming?.text && (
            <div className="prose prose-sm dark:prose-invert max-w-none prose-pre:bg-muted prose-pre:border prose-code:text-xs prose-code:before:content-none prose-code:after:content-none prose-p:leading-relaxed">
              <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
                {streaming.text}
              </ReactMarkdown>
            </div>
          )}

          {/* Error display */}
          {streaming?.error && (
            <div className="flex items-start gap-2 p-3 rounded-md bg-destructive/10 border border-destructive/20">
              <AlertCircle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-destructive">Error</p>
                <p className="text-xs text-destructive/80 mt-1">{streaming.error}</p>
              </div>
              <button
                onClick={() => clearStreamingText(conversationId)}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Dismiss
              </button>
            </div>
          )}

          {/* Streaming indicator */}
          {streaming?.isStreaming && !streaming?.error && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="w-3 h-3 animate-spin" />
              <span>Generating...</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
