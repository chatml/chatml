'use client';

import { useState, useEffect, useRef, useMemo, memo } from 'react';
import { useAppStore } from '@/stores/appStore';
import { useStreamingMeta, useStreamingThinking, useStreamingSegmentIds, useStreamingSegmentText, useActiveTools, useSubAgents } from '@/stores/selectors';
import { AlertCircle, Brain, ChevronDown, ChevronRight, Clock } from 'lucide-react';
import { ToolUsageBlock } from '@/components/conversation/ToolUsageBlock';
import { ThinkingNode } from '@/components/conversation/ThinkingNode';
import { SubAgentRow, SubAgentGroupedRow } from '@/components/conversation/SubAgentGroup';
import { ApprovedPlanBlock } from '@/components/conversation/ApprovedPlanBlock';
import { TurnStatusIndicator } from '@/components/conversation/TurnStatusIndicator';
import { CachedMarkdown } from '@/components/shared/CachedMarkdown';
import { StreamingMarkdown } from '@/components/shared/StreamingMarkdown';
import { cn } from '@/lib/utils';
import { PROSE_CLASSES } from '@/lib/constants';
import { getModelInfo, buildTurnConfigLabel } from '@/lib/models';

// Timeline item types for interleaved display
// Note: 'text' items are structural placeholders — actual text is fetched per-segment
// by StreamingTextSegment to avoid recomputing the timeline on every text delta.
type TimelineItem =
  | { type: 'text'; id: string; timestamp: number }
  | { type: 'tool'; id: string; tool: string; params?: Record<string, unknown>; startTime: number; endTime?: number; success?: boolean; summary?: string; stdout?: string; stderr?: string; elapsedSeconds?: number; metadata?: import('@/lib/types').ToolMetadata }
  | { type: 'thinking'; id: string; isActive: boolean; timestamp: number }
  | { type: 'plan'; id: string; content: string; timestamp: number }
  | { type: 'status'; id: string; content: string; variant?: string; timestamp: number }
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

// Per-segment text renderer — subscribes only to its own segment's text,
// so text deltas only re-render this leaf component, not the full timeline.
const StreamingTextSegment = memo(function StreamingTextSegment({
  conversationId,
  segmentId,
  isLast,
}: {
  conversationId: string;
  segmentId: string;
  isLast: boolean;
}) {
  const text = useStreamingSegmentText(conversationId, segmentId);
  // Empty segments are briefly possible when a segment is created before text arrives.
  // Render nothing but keep the element mounted so React doesn't unmount/remount.
  if (!text) return <div className={PROSE_CLASSES} />;
  return (
    <div className={PROSE_CLASSES}>
      {isLast ? (
        <StreamingMarkdown id={segmentId} content={text} />
      ) : (
        <CachedMarkdown cacheKey={`seg:${segmentId}`} content={text} />
      )}
    </div>
  );
});

// Per-thinking renderer — subscribes only to thinking text,
// so thinking deltas only re-render this leaf, not the full timeline.
const StreamingThinkingSegment = memo(function StreamingThinkingSegment({
  conversationId,
  isActive,
}: {
  conversationId: string;
  isActive: boolean;
}) {
  const text = useStreamingThinking(conversationId);
  if (!text) return null;
  return <ThinkingNode content={text} isStreaming={isActive} />;
});

export function StreamingMessage({ conversationId, worktreePath }: StreamingMessageProps) {
  // Use fine-grained selectors — meta changes only on structural events,
  // segmentIds changes only when a new segment is created, not on every text delta.
  const meta = useStreamingMeta(conversationId);
  const segmentIds = useStreamingSegmentIds(conversationId);
  const tools = useActiveTools(conversationId);
  const subAgents = useSubAgents(conversationId);
  const clearStreamingText = useAppStore((s) => s.clearStreamingText);
  // Check if extended thinking is enabled based on model capabilities
  const conversationModel = useAppStore((s) => s.conversations.find(c => c.id === conversationId)?.model);
  const isExtendedThinkingEnabled = conversationModel ? (getModelInfo(conversationModel)?.supportsThinking ?? false) : false;

  // Build interleaved timeline from segment stubs, tools, and thinking.
  // Text content is NOT included here — each StreamingTextSegment subscribes independently.
  const timeline = useMemo((): TimelineItem[] => {
    const items: TimelineItem[] = [];

    // Add thinking as a timeline placeholder — actual text fetched by StreamingThinkingSegment
    if (meta?.hasThinking) {
      items.push({
        type: 'thinking',
        id: 'thinking-current',
        isActive: !!meta.isThinking,
        timestamp: meta.startTime || 0,
      });
    }

    // Add text segment placeholders (no text content — rendered by StreamingTextSegment)
    for (const seg of segmentIds) {
      items.push({ type: 'text', id: seg.id, timestamp: seg.timestamp });
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
        metadata: tool.metadata,
      });
    }

    // Add approved plan content at its chronological position
    if (meta?.approvedPlanContent && meta?.approvedPlanTimestamp) {
      items.push({
        type: 'plan',
        id: 'approved-plan',
        content: meta.approvedPlanContent,
        timestamp: meta.approvedPlanTimestamp,
      });
    }

    // Add pending plan content (awaiting approval) — place at end of current content
    if (meta?.pendingPlanApproval?.planContent) {
      items.push({
        type: 'plan',
        id: 'pending-plan',
        content: meta.pendingPlanApproval.planContent,
        timestamp: Number.MAX_SAFE_INTEGER, // Sort to end of current timeline
      });
    }

    // Add turn-start configuration status entry
    if (meta?.turnStartMeta) {
      const label = buildTurnConfigLabel(meta.turnStartMeta);
      if (label) {
        items.push({
          type: 'status',
          id: 'turn-config',
          content: label,
          variant: 'config',
          timestamp: (meta.startTime || 0) - 1, // Sort before thinking
        });
      }
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
        case 'plan': return item.timestamp;
        case 'status': return item.timestamp;
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
  }, [meta, segmentIds, tools, subAgents]);

  // Don't render if no streaming content, no active tools, no sub-agents, no thinking, and no error
  if (timeline.length === 0 && !meta?.error && !meta?.isThinking && !meta?.isStreaming) {
    return null;
  }

  return (
    <div className="py-2" role="status" aria-live="polite" aria-atomic="false">
      <div className="space-y-1.5">
          {/* Extended thinking mode indicator - shows when thinking is enabled but no content yet */}
          {isExtendedThinkingEnabled && meta?.isStreaming && !meta?.isThinking && !meta?.hasThinking && timeline.length === 0 && (
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
                <StreamingThinkingSegment
                  key={item.id}
                  conversationId={conversationId}
                  isActive={item.isActive}
                />
              );
            } else if (item.type === 'text') {
              return (
                <StreamingTextSegment
                  key={item.id}
                  conversationId={conversationId}
                  segmentId={item.id}
                  isLast={item.id === lastTextId}
                />
              );
            } else if (item.type === 'plan') {
              const isPending = item.id === 'pending-plan';
              return isPending ? (
                <div key={item.id} data-plan-id="pending-plan" className={PROSE_CLASSES}>
                  <CachedMarkdown
                    cacheKey={`plan:${item.id}`}
                    content={item.content}
                  />
                </div>
              ) : (
                <ApprovedPlanBlock
                  key={item.id}
                  cacheKey={`approved-plan:${conversationId}`}
                  content={item.content}
                />
              );
            } else if (item.type === 'status') {
              return (
                <TurnStatusIndicator
                  key={item.id}
                  content={item.content}
                  variant={item.variant}
                />
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
            } else if (item.tool === 'ExitPlanMode') {
              return (
                <div key={item.id} data-tool-id="exit-plan-mode">
                  <ToolUsageBlock
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
                    metadata={item.metadata}
                  />
                </div>
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
                  metadata={item.metadata}
                />
              );
            }
          });
          })()}

          {/* Enhanced error display */}
          {meta?.error && (
            <ErrorDisplay
              error={meta.error}
              onDismiss={() => clearStreamingText(conversationId)}
            />
          )}

          {/* Persistent working indicator with elapsed time */}
          {meta?.isStreaming && !meta?.error && (
            <ElapsedTimer startTime={meta.startTime} isStreaming={meta.isStreaming} />
          )}
      </div>
    </div>
  );
}
