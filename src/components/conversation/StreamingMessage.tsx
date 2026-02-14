'use client';

import { useState, useEffect, useRef, useMemo, memo } from 'react';
import { useAppStore } from '@/stores/appStore';
import { useStreamingState, useActiveTools, useSubAgents } from '@/stores/selectors';
import { AlertCircle, Brain, ChevronDown, ChevronRight, ClipboardCheck, Clock } from 'lucide-react';
import { ToolUsageBlock } from '@/components/conversation/ToolUsageBlock';
import { ThinkingNode } from '@/components/conversation/ThinkingNode';
import { SubAgentRow, SubAgentGroupedRow } from '@/components/conversation/SubAgentGroup';
import { CachedMarkdown } from '@/components/shared/CachedMarkdown';
import { StreamingMarkdown } from '@/components/shared/StreamingMarkdown';
import { cn } from '@/lib/utils';
import { PROSE_CLASSES } from '@/lib/constants';

// Timeline item types for interleaved display
type TimelineItem =
  | { type: 'text'; id: string; text: string; timestamp: number }
  | { type: 'tool'; id: string; tool: string; params?: Record<string, unknown>; startTime: number; endTime?: number; success?: boolean; summary?: string; stdout?: string; stderr?: string; elapsedSeconds?: number }
  | { type: 'thinking'; id: string; text: string; isActive: boolean; timestamp: number }
  | { type: 'subagent'; agent: import('@/lib/types').SubAgent }
  | { type: 'subagent_group'; agents: import('@/lib/types').SubAgent[] };

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

  // Check if extended thinking is enabled for this conversation
  const isExtendedThinkingEnabled = budgetStatus?.maxThinkingTokens !== undefined && budgetStatus.maxThinkingTokens > 0;

  const [isApprovedPlanExpanded, setIsApprovedPlanExpanded] = useState(true);

  // Build interleaved timeline from segments, tools, and thinking
  const timeline = useMemo((): TimelineItem[] => {
    const items: TimelineItem[] = [];

    // Add thinking as a timeline item
    if (streaming?.thinking) {
      items.push({
        type: 'thinking',
        id: 'thinking-current',
        text: streaming.thinking,
        isActive: !!streaming.isThinking,
        timestamp: streaming.startTime || 0,
      });
    }

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
    const getItemTime = (item: TimelineItem): number => {
      switch (item.type) {
        case 'text': return item.timestamp;
        case 'thinking': return item.timestamp;
        case 'subagent': return item.agent.startTime;
        case 'subagent_group': return item.agents[0].startTime;
        default: return item.startTime;
      }
    };
    items.sort((a, b) => getItemTime(a) - getItemTime(b));

    // Group consecutive sub-agents that share the same description and agent type
    const grouped: TimelineItem[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type === 'subagent' && item.agent.description) {
        // Collect consecutive sub-agents with same description + agentType
        const batch: import('@/lib/types').SubAgent[] = [item.agent];
        while (
          i + 1 < items.length &&
          items[i + 1].type === 'subagent' &&
          (items[i + 1] as { type: 'subagent'; agent: import('@/lib/types').SubAgent }).agent.description === item.agent.description &&
          (items[i + 1] as { type: 'subagent'; agent: import('@/lib/types').SubAgent }).agent.agentType === item.agent.agentType
        ) {
          i++;
          batch.push((items[i] as { type: 'subagent'; agent: import('@/lib/types').SubAgent }).agent);
        }
        if (batch.length > 1) {
          grouped.push({ type: 'subagent_group', agents: batch });
        } else {
          grouped.push(item);
        }
      } else {
        grouped.push(item);
      }
    }

    return grouped;
  }, [streaming, tools, subAgents]);

  // Don't render if no streaming content, no active tools, no sub-agents, no thinking, no error, and no pending plan
  if (timeline.length === 0 && !streaming?.error && !streaming?.isThinking && !streaming?.isStreaming && !streaming?.pendingPlanApproval?.planContent && !streaming?.approvedPlanContent) {
    return null;
  }

  return (
    <div className="py-2" role="status" aria-live="polite" aria-atomic="false">
      <div className="space-y-1.5">
          {/* Extended thinking mode indicator - shows when thinking is enabled but no content yet */}
          {isExtendedThinkingEnabled && streaming?.isStreaming && !streaming?.isThinking && !streaming?.thinking && timeline.length === 0 && (
            <div className="flex items-center gap-2 animate-fade-in" aria-label="Extended thinking enabled">
              <Brain className="w-3.5 h-3.5 text-ai-thinking shrink-0 animate-thinking-pulse" aria-hidden="true" />
              <span className="text-xs text-ai-thinking">Extended thinking active</span>
            </div>
          )}

          {/* Interleaved timeline of thinking, text, and tools */}
          {(() => {
            // The last text segment is actively streaming — use block-level
            // memoized StreamingMarkdown for it; use CachedMarkdown for completed segments.
            const lastTextId = timeline.findLast((i) => i.type === 'text')?.id;
            return timeline.map((item) => {
            if (item.type === 'thinking') {
              return (
                <ThinkingNode
                  key={item.id}
                  content={item.text}
                  isStreaming={item.isActive}
                />
              );
            } else if (item.type === 'text') {
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
            } else if (item.type === 'subagent_group') {
              return (
                <SubAgentGroupedRow
                  key={item.agents.map(a => a.agentId).join(',')}
                  agents={item.agents}
                  worktreePath={worktreePath}
                />
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

          {/* Approved plan content - persists after plan approval during continued streaming */}
          {!streaming?.pendingPlanApproval?.planContent && streaming?.approvedPlanContent && (
            <div className="flex flex-col gap-1">
              <button
                onClick={() => setIsApprovedPlanExpanded(!isApprovedPlanExpanded)}
                className="flex items-center gap-2 text-xs text-primary hover:text-primary/80 transition-colors"
              >
                <ClipboardCheck className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                <span className="font-medium">Approved Plan</span>
                {isApprovedPlanExpanded ? (
                  <ChevronDown className="w-3 h-3" />
                ) : (
                  <ChevronRight className="w-3 h-3" />
                )}
              </button>
              {isApprovedPlanExpanded && (
                <div className={cn(PROSE_CLASSES, 'ml-5 border-l-2 border-primary/20 pl-3')}>
                  <CachedMarkdown
                    cacheKey={`approved-plan:${conversationId}`}
                    content={streaming.approvedPlanContent}
                  />
                </div>
              )}
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
