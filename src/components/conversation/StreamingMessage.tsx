'use client';

import { useState, useEffect, useRef, useMemo, memo } from 'react';
import { useAppStore } from '@/stores/appStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useStreamingState, useActiveTools, useSubAgents } from '@/stores/selectors';
import { Loader2, AlertCircle, Brain, Clock, ChevronDown, ChevronRight } from 'lucide-react';
import { ToolUsageBlock } from '@/components/conversation/ToolUsageBlock';
import { SubAgentRow } from '@/components/conversation/SubAgentGroup';
import { CachedMarkdown } from '@/components/shared/CachedMarkdown';
import { StreamingMarkdown } from '@/components/shared/StreamingMarkdown';
import { cn } from '@/lib/utils';
import { PROSE_CLASSES } from '@/lib/constants';

// Timeline item types for interleaved display
type TimelineItem =
  | { type: 'text'; id: string; text: string; timestamp: number }
  | { type: 'tool'; id: string; tool: string; params?: Record<string, unknown>; startTime: number; endTime?: number; success?: boolean; summary?: string; stdout?: string; stderr?: string; elapsedSeconds?: number }
  | { type: 'subagent'; agent: import('@/lib/types').SubAgent };

interface StreamingMessageProps {
  conversationId: string;
  worktreePath?: string;
}

// Format elapsed time as mm:ss.cc (centiseconds)
function formatElapsedTime(ms: number) {
  const totalSeconds = Math.floor(ms / 1000);
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  const centis = Math.floor((ms % 1000) / 10);
  return `${mins}:${secs.toString().padStart(2, '0')}.${centis.toString().padStart(2, '0')}`;
}

// Isolated elapsed timer component — manages its own 50ms interval without
// causing re-renders in the parent StreamingMessage component.
const ElapsedTimer = memo(function ElapsedTimer({ startTime, isStreaming }: { startTime?: number; isStreaming: boolean }) {
  const [elapsedMs, setElapsedMs] = useState(0);
  const startTimeRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isStreaming) {
      startTimeRef.current = null;
      queueMicrotask(() => setElapsedMs(0));
      return;
    }

    if (startTimeRef.current === null && startTime) {
      startTimeRef.current = startTime;
    }

    if (startTimeRef.current) {
      setElapsedMs(Date.now() - startTimeRef.current);
    }

    const interval = setInterval(() => {
      if (startTimeRef.current) {
        setElapsedMs(Date.now() - startTimeRef.current);
      }
    }, 50);

    return () => clearInterval(interval);
  }, [isStreaming, startTime]);

  const formatted = formatElapsedTime(elapsedMs);

  return (
    <div
      className="flex items-center gap-2 pt-2 mt-2 animate-fade-in"
      aria-label={`Agent is working, elapsed time: ${formatted}`}
    >
      <div className="flex items-end gap-[2px] h-3 w-3" aria-hidden="true">
        <div className="w-[3px] bg-ai-active rounded-full animate-agent-bar-1" />
        <div className="w-[3px] bg-ai-active rounded-full animate-agent-bar-2" />
        <div className="w-[3px] bg-ai-active rounded-full animate-agent-bar-3" />
      </div>
      <span className="text-xs text-muted-foreground">Agent is working</span>
      <div className="flex items-center gap-1 text-xs text-muted-foreground/70" aria-hidden="true">
        <Clock className="w-3 h-3" />
        <span className="font-mono tabular-nums">{formatted}</span>
      </div>
    </div>
  );
});

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

  // Detect auth errors
  const lowerError = error.toLowerCase();
  const isAuthError = lowerError.includes('authentication') || lowerError.includes('api key') || lowerError.includes('oauth');

  return (
    <div
      role="alert"
      className="rounded-md bg-destructive/10 border border-destructive/20 overflow-hidden"
    >
      <div className="flex items-start gap-2 p-2">
        <AlertCircle className="w-3.5 h-3.5 text-destructive shrink-0 mt-0.5" aria-hidden="true" />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-destructive">{isAuthError ? 'Authentication Error' : 'Error'}</p>
          <p
            className={cn(
              'text-xs text-destructive/80 mt-0.5',
              hasStackTrace && isExpanded && 'font-mono whitespace-pre-wrap'
            )}
          >
            {displayError}
          </p>
          {isAuthError && (
            <button
              onClick={() => window.dispatchEvent(new CustomEvent('open-settings'))}
              className="mt-1.5 px-2 py-1 text-xs font-medium bg-destructive/10 hover:bg-destructive/20 text-destructive border border-destructive/30 rounded transition-colors"
            >
              Open Settings
            </button>
          )}
          {needsTruncation && (
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="mt-1 text-xs text-destructive/60 hover:text-destructive flex items-center gap-0.5"
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
          className="text-xs text-muted-foreground hover:text-foreground shrink-0"
          aria-label="Dismiss error"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}

export function StreamingMessage({ conversationId, worktreePath }: StreamingMessageProps) {
  // Use scoped selectors for this conversation only - prevents re-renders from other conversations
  const streaming = useStreamingState(conversationId);
  const tools = useActiveTools(conversationId);
  const subAgents = useSubAgents(conversationId);
  const clearStreamingText = useAppStore((s) => s.clearStreamingText);
  const budgetStatus = useAppStore((s) => s.budgetStatus);

  const showThinkingBlocks = useSettingsStore((s) => s.showThinkingBlocks);

  // Check if extended thinking is enabled for this conversation
  const isExtendedThinkingEnabled = budgetStatus?.maxThinkingTokens !== undefined && budgetStatus.maxThinkingTokens > 0;

  // Thinking expansion state (must be before early return to satisfy Rules of Hooks)
  // Note: We don't need to reset this when thinking becomes null because the
  // expansion UI only renders when there's thinking content to show
  const [isThinkingExpanded, setIsThinkingExpanded] = useState(false);

  // Build interleaved timeline from segments and tools
  const timeline = useMemo((): TimelineItem[] => {
    const items: TimelineItem[] = [];

    // Add text segments
    const segments = streaming?.segments || [];
    for (const seg of segments) {
      if (seg.text) {
        items.push({ type: 'text', id: seg.id, text: seg.text, timestamp: seg.timestamp });
      }
    }

    // Collect Task tool IDs that spawned sub-agents — these are rendered by SubAgentRow instead
    const subAgentParentIds = new Set(
      subAgents.filter(a => a.parentToolUseId).map(a => a.parentToolUseId!)
    );

    // Add tools (exclude sub-agent tools AND Task tools that have a corresponding sub-agent)
    for (const tool of tools) {
      if (tool.agentId) continue;
      if (tool.tool === 'Task' && subAgentParentIds.has(tool.id)) continue;
      items.push({
        type: 'tool',
        id: tool.id,
        tool: tool.tool,
        params: tool.params,
        startTime: tool.startTime,
        endTime: tool.endTime,
        success: tool.success,
        summary: tool.summary,
        stdout: tool.stdout,
        stderr: tool.stderr,
        elapsedSeconds: tool.elapsedSeconds,
      });
    }

    // Add sub-agents into the timeline
    for (const agent of subAgents) {
      items.push({ type: 'subagent', agent });
    }

    // Sort by timestamp (text segments use timestamp, tools use startTime, sub-agents use startTime)
    items.sort((a, b) => {
      const aTime = a.type === 'text' ? a.timestamp : a.type === 'subagent' ? a.agent.startTime : a.startTime;
      const bTime = b.type === 'text' ? b.timestamp : b.type === 'subagent' ? b.agent.startTime : b.startTime;
      return aTime - bTime;
    });

    return items;
  }, [streaming?.segments, tools, subAgents]);

  // Don't render if no streaming content, no active tools, no sub-agents, no thinking, no error, and no pending plan
  if (timeline.length === 0 && !streaming?.error && !streaming?.thinking && !streaming?.isThinking && !streaming?.isStreaming && !streaming?.pendingPlanApproval?.planContent) {
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
    <div className="py-2" role="status" aria-live="polite" aria-atomic="false">
      <div className="space-y-1.5">
          {/* Extended thinking mode indicator - shows when thinking is enabled but no content yet */}
          {isExtendedThinkingEnabled && streaming?.isStreaming && !streaming?.isThinking && !streaming?.thinking && (
            <div className="flex items-center gap-2 animate-fade-in" aria-label="Extended thinking enabled">
              <Brain className="w-3.5 h-3.5 text-ai-thinking shrink-0 animate-thinking-pulse" aria-hidden="true" />
              <span className="text-xs text-ai-thinking">Extended thinking active</span>
            </div>
          )}

          {/* Thinking indicator with expandable content */}
          {(streaming?.isThinking || streaming?.thinking) && (
            <div className="flex flex-col gap-1 animate-slide-up-fade" aria-label="Agent is thinking">
              <div className="flex items-center gap-2">
                <Brain className={cn(
                  "w-3.5 h-3.5 shrink-0 text-ai-thinking",
                  streaming.isThinking && "animate-thinking-pulse"
                )} aria-hidden="true" />
                <span className="text-xs font-medium text-ai-thinking">Thinking</span>
                {streaming.isThinking && (
                  <Loader2 className="w-3 h-3 animate-spin text-ai-thinking" aria-hidden="true" />
                )}
                {showThinkingBlocks && thinkingNeedsTruncation && (
                  <button
                    onClick={() => setIsThinkingExpanded(!isThinkingExpanded)}
                    className="flex items-center gap-0.5 text-xs text-primary hover:text-primary/80 transition-colors"
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
              {showThinkingBlocks && streaming.thinking && (
                <div
                  className={cn(
                    'ml-5 text-xs px-2 py-1.5 rounded bg-ai-thinking/10 text-muted-foreground font-mono',
                    'border border-ai-thinking/20',
                    isThinkingExpanded ? 'whitespace-pre-wrap max-h-[200px] overflow-y-auto' : 'truncate max-w-full'
                  )}
                >
                  {isThinkingExpanded ? streaming.thinking : truncateThinking(streaming.thinking)}
                </div>
              )}
            </div>
          )}

          {/* Interleaved timeline of text and tools */}
          {(() => {
            // The last text segment is actively streaming — use block-level
            // memoized StreamingMarkdown for it; use CachedMarkdown for completed segments.
            const lastTextId = timeline.findLast((i) => i.type === 'text')?.id;
            return timeline.map((item) => {
            if (item.type === 'text') {
              const isLastText = item.id === lastTextId;
              return (
                <div
                  key={item.id}
                  className={PROSE_CLASSES}
                >
                  {isLastText ? (
                    <StreamingMarkdown id={item.id} content={item.text} />
                  ) : (
                    <CachedMarkdown
                      cacheKey={`seg:${item.id}`}
                      content={item.text}
                    />
                  )}
                </div>
              );
            } else if (item.type === 'subagent') {
              return (
                <SubAgentRow
                  key={item.agent.agentId}
                  agent={item.agent}
                  worktreePath={worktreePath}
                />
              );
            } else {
              return (
                <ToolUsageBlock
                  key={item.id}
                  id={item.id}
                  tool={item.tool}
                  params={item.params}
                  worktreePath={worktreePath}
                  isActive={!item.endTime}
                  success={item.success}
                  summary={item.summary}
                  duration={item.endTime ? item.endTime - item.startTime : undefined}
                  stdout={item.stdout}
                  stderr={item.stderr}
                  elapsedSeconds={item.elapsedSeconds}
                />
              );
            }
          });
          })()}

          {/* Plan content display - shown when ExitPlanMode sends plan for approval */}
          {streaming?.pendingPlanApproval?.planContent && (
            <div className={PROSE_CLASSES}>
              <CachedMarkdown
                cacheKey={`plan:${streaming.pendingPlanApproval.requestId}`}
                content={streaming.pendingPlanApproval.planContent}
              />
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
            <ElapsedTimer startTime={streaming.startTime} isStreaming={streaming.isStreaming} />
          )}
      </div>
    </div>
  );
}
