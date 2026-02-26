'use client';

import { useState, memo } from 'react';
import { useAppStore } from '@/stores/appStore';
import type { LucideIcon } from 'lucide-react';
import {
  CheckCircle2,
  XCircle,
  Clock,
  Wrench,
  GitBranch,
  FileText,
  FileEdit,
  Terminal,
  Search,
  RotateCw,
  RotateCcw,
  Loader2,
  ChevronDown,
  ChevronRight,
  Globe,
  ArrowDownToLine,
  ArrowUpFromLine,
  ArrowRight,
} from 'lucide-react';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { formatTokens } from '@/lib/format';
import { useSettingsStore } from '@/stores/settingsStore';
import { getApiBase } from '@/lib/api';
import type { RunSummary } from '@/lib/types';

// -- Inline helper components --

function StatPill({ icon: Icon, value, label }: { icon: LucideIcon; value: number; label: string }) {
  if (value <= 0) return null;
  return (
    <div className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-white/60 dark:bg-white/[0.06] border border-black/[0.06] dark:border-white/[0.06] text-2xs text-muted-foreground">
      <Icon className="w-3 h-3 text-primary/70" />
      <span className="font-semibold text-foreground/80">{value}</span>
      <span className="text-muted-foreground/80">{label}</span>
    </div>
  );
}

function ToolPill({ icon: Icon, name, count }: { icon: LucideIcon; name: string; count: number }) {
  return (
    <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-white/60 dark:bg-white/[0.06] border border-black/[0.06] dark:border-white/[0.06] text-2xs text-muted-foreground">
      <Icon className="w-3 h-3 text-primary/60" />
      <span className="font-medium text-foreground/70">{name}</span>
      <span className="text-muted-foreground/70">{'\u00D7'}{count}</span>
    </div>
  );
}

function DotSeparator() {
  return <span className="text-muted-foreground/30 select-none">&middot;</span>;
}

// -- Main component --

interface RunSummaryBlockProps {
  summary: RunSummary;
  checkpointUuid?: string;
  conversationId?: string;
}

export const RunSummaryBlock = memo(function RunSummaryBlock({ summary, checkpointUuid, conversationId }: RunSummaryBlockProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isRewinding, setIsRewinding] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const showTokenUsage = useSettingsStore((s) => s.showTokenUsage);
  const showChatCost = useSettingsStore((s) => s.showChatCost);

  const handleRewind = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!conversationId || !checkpointUuid || isRewinding) return;

    setConfirmOpen(false);
    setIsRewinding(true);
    try {
      const response = await fetch(`${getApiBase()}/api/conversations/${conversationId}/rewind`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ checkpointUuid }),
      });
      if (!response.ok) {
        const errorText = await response.text();
        console.error('Failed to rewind:', errorText);
        window.dispatchEvent(new CustomEvent('agent-notification', {
          detail: {
            title: 'Rewind failed',
            message: errorText || 'Failed to revert files to checkpoint',
            type: 'error',
            conversationId,
          }
        }));
      }
    } catch (err) {
      console.error('Failed to rewind:', err);
      window.dispatchEvent(new CustomEvent('agent-notification', {
        detail: {
          title: 'Rewind failed',
          message: err instanceof Error ? err.message : 'Network error while reverting files',
          type: 'error',
          conversationId,
        }
      }));
    } finally {
      setIsRewinding(false);
    }
  };

  const formatDuration = (ms?: number) => {
    if (!ms) return null;
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    if (minutes > 0) return `${minutes}m ${remainingSeconds}s`;
    return `${seconds}s`;
  };

  const formatCost = (cost?: number) => {
    if (cost === undefined || cost === null) return null;
    if (cost < 0.01) return `$${cost.toFixed(4)}`;
    return `$${cost.toFixed(2)}`;
  };

  const stats = summary.stats;
  const duration = formatDuration(summary.durationMs);
  const cost = formatCost(summary.cost);
  const toolDuration = stats?.totalToolDurationMs ? formatDuration(stats.totalToolDurationMs) : null;

  const totalInputTokens = summary.usage?.inputTokens ?? 0;
  const totalOutputTokens = summary.usage?.outputTokens ?? 0;
  const hasModelUsage = summary.modelUsage && Object.keys(summary.modelUsage).length > 0;

  const hasDetailedStats = (stats?.toolsByType && Object.keys(stats.toolsByType).length > 0) ||
    (showTokenUsage && hasModelUsage);

  const getToolIcon = (tool: string) => {
    switch (tool) {
      case 'Read':
      case 'read_file':
        return FileText;
      case 'Write':
      case 'write_file':
      case 'Edit':
      case 'edit_file':
        return FileEdit;
      case 'Bash':
      case 'bash':
      case 'execute_command':
        return Terminal;
      case 'Grep':
      case 'Glob':
      case 'search':
        return Search;
      case 'WebFetch':
      case 'WebSearch':
      case 'web':
        return Globe;
      case 'Task':
        return GitBranch;
      default:
        return Wrench;
    }
  };

  // Cache efficiency: Anthropic API reports inputTokens as the non-cached portion,
  // so total = uncached (inputTokens) + cacheRead + cacheWrite.
  const cacheRead = summary.usage?.cacheReadInputTokens ?? 0;
  const cacheWrite = summary.usage?.cacheCreationInputTokens ?? 0;
  const cacheTotal = cacheRead + totalInputTokens + cacheWrite;
  const cacheHitRatio = cacheTotal > 0 ? (cacheRead / cacheTotal) * 100 : 0;

  // Check if we have any activity stats to show
  const hasActivityStats = stats && (
    stats.filesRead > 0 || stats.filesWritten > 0 || stats.bashCommands > 0 ||
    stats.webSearches > 0 || stats.subAgents > 0
  );

  return (
    <div>
    <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
      {/* ── Collapsed Bar ── */}
      <CollapsibleTrigger
        className={cn(
          'group mt-3 flex items-center gap-2 text-xs text-muted-foreground flex-wrap w-full',
          'hover:text-foreground/80 transition-colors cursor-pointer',
          !summary.success && 'text-destructive/70'
        )}
      >
        {/* Status icon */}
        {summary.success ? (
          <CheckCircle2 className="w-3.5 h-3.5 text-text-success shrink-0" />
        ) : (
          <XCircle className="w-3.5 h-3.5 text-destructive shrink-0" />
        )}

        {/* Duration */}
        {duration && (
          <span className="flex items-center gap-1">
            <Clock className="w-3 h-3 opacity-50" />
            {duration}
          </span>
        )}

        {/* Cost */}
        {showChatCost && cost && (
          <>
            <DotSeparator />
            <span className="font-medium">{cost}</span>
          </>
        )}

        {/* Token counts — grouped pair */}
        {showTokenUsage && (totalInputTokens > 0 || totalOutputTokens > 0) && (
          <>
            <DotSeparator />
            <span className="flex items-center gap-2">
              {totalInputTokens > 0 && (
                <span className="flex items-center gap-1">
                  <ArrowDownToLine className="w-3 h-3 opacity-50" />
                  {formatTokens(totalInputTokens)} in
                </span>
              )}
              {totalOutputTokens > 0 && (
                <span className="flex items-center gap-1">
                  <ArrowUpFromLine className="w-3 h-3 opacity-50" />
                  {formatTokens(totalOutputTokens)} out
                </span>
              )}
            </span>
          </>
        )}

        {/* Turns */}
        {summary.turns !== undefined && (
          <>
            <DotSeparator />
            <span className="flex items-center gap-1">
              <RotateCw className="w-3 h-3 opacity-50" />
              {summary.turns} turn{summary.turns !== 1 ? 's' : ''}
            </span>
          </>
        )}

        {/* Tool Calls */}
        {stats && stats.toolCalls > 0 && (
          <>
            <DotSeparator />
            <span className="flex items-center gap-1">
              <Wrench className="w-3 h-3 opacity-50" />
              {stats.toolCalls} tool{stats.toolCalls !== 1 ? 's' : ''}
            </span>
          </>
        )}

        {/* Spacer */}
        <span className="flex-1" />

        {/* Revert to checkpoint */}
        {checkpointUuid && (
          <Popover open={confirmOpen} onOpenChange={setConfirmOpen}>
            <Tooltip>
              <TooltipTrigger asChild>
                <PopoverTrigger asChild>
                  <span
                    role="button"
                    tabIndex={0}
                    className="opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer shrink-0 p-0.5 rounded hover:bg-muted"
                    onClick={(e) => { e.stopPropagation(); setConfirmOpen(true); }}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); setConfirmOpen(true); } }}
                  >
                    {isRewinding ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <RotateCcw className="w-3 h-3" />
                    )}
                  </span>
                </PopoverTrigger>
              </TooltipTrigger>
              <TooltipContent side="top">
                <p>Revert files to this checkpoint</p>
              </TooltipContent>
            </Tooltip>
            <PopoverContent
              side="top"
              align="end"
              className="w-auto p-2"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Revert files?</span>
                <Button size="sm" variant="destructive" className="h-6 px-2 text-xs" onClick={handleRewind}>
                  Revert
                </Button>
              </div>
            </PopoverContent>
          </Popover>
        )}

        {/* Expand chevron */}
        {hasDetailedStats && (
          <span className="shrink-0">
            {isExpanded ? (
              <ChevronDown className="w-3 h-3" />
            ) : (
              <ChevronRight className="w-3 h-3" />
            )}
          </span>
        )}
      </CollapsibleTrigger>

      {/* ── Expanded Panel ── */}
      {hasDetailedStats && (
        <CollapsibleContent>
          <div className="mt-2 rounded-lg border border-border/60 bg-surface-1 overflow-hidden divide-y divide-border/40 animate-slide-up-fade">

            {/* Section: Activity Overview */}
            {hasActivityStats && (
              <div className="px-3 py-2.5">
                <div className="text-2xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                  Activity
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <StatPill icon={FileText} value={stats?.filesRead ?? 0} label={(stats?.filesRead ?? 0) === 1 ? 'file read' : 'files read'} />
                  <StatPill icon={FileEdit} value={stats?.filesWritten ?? 0} label={(stats?.filesWritten ?? 0) === 1 ? 'file written' : 'files written'} />
                  <StatPill icon={Terminal} value={stats?.bashCommands ?? 0} label={(stats?.bashCommands ?? 0) === 1 ? 'command' : 'commands'} />
                  <StatPill icon={Globe} value={stats?.webSearches ?? 0} label={(stats?.webSearches ?? 0) === 1 ? 'search' : 'searches'} />
                  <StatPill icon={GitBranch} value={stats?.subAgents ?? 0} label={(stats?.subAgents ?? 0) === 1 ? 'sub-agent' : 'sub-agents'} />
                </div>
              </div>
            )}

            {/* Section: Tool Breakdown */}
            {stats?.toolsByType && Object.keys(stats.toolsByType).length > 0 && (
              <div className="px-3 py-2.5">
                <div className="text-2xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                  Tools
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(stats.toolsByType)
                    .sort(([, a], [, b]) => b - a)
                    .map(([tool, count]) => (
                      <ToolPill key={tool} icon={getToolIcon(tool)} name={tool} count={count} />
                    ))}
                </div>
              </div>
            )}

            {/* Section: Performance / Timing */}
            {(duration || toolDuration) && (
              <div className="px-3 py-2.5 flex items-center gap-4 text-2xs text-muted-foreground">
                {duration && (
                  <span>
                    Duration{' '}
                    <span className="font-medium font-mono text-foreground/70">{duration}</span>
                  </span>
                )}
                {toolDuration && (
                  <span>
                    Tool execution{' '}
                    <span className="font-medium font-mono text-foreground/70">{toolDuration}</span>
                  </span>
                )}
              </div>
            )}

            {/* Section: Token Usage */}
            {showTokenUsage && hasModelUsage && (
              <div className="px-3 py-2.5">
                <div className="text-2xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                  Tokens
                </div>

                {/* Aggregate stats */}
                {summary.usage && (
                  <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-2xs text-muted-foreground">
                    <span>
                      Input{' '}
                      <span className="font-mono font-medium text-foreground/70">
                        {totalInputTokens.toLocaleString()}
                      </span>
                    </span>
                    <span>
                      Output{' '}
                      <span className="font-mono font-medium text-foreground/70">
                        {totalOutputTokens.toLocaleString()}
                      </span>
                    </span>
                    {cacheRead > 0 && (
                      <span>
                        Cache read{' '}
                        <span className="font-mono font-medium text-foreground/70">
                          {formatTokens(cacheRead)}
                        </span>
                      </span>
                    )}
                    {cacheWrite > 0 && (
                      <span>
                        Cache write{' '}
                        <span className="font-mono font-medium text-foreground/70">
                          {formatTokens(cacheWrite)}
                        </span>
                      </span>
                    )}
                  </div>
                )}

                {/* Cache efficiency bar */}
                {cacheRead > 0 && (
                  <div className="mt-2.5">
                    <div className="flex items-center justify-between text-2xs text-muted-foreground/70 mb-1">
                      <span>Cache efficiency</span>
                      <span className="font-mono">{cacheHitRatio.toFixed(1)}%</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-black/[0.06] dark:bg-white/[0.06] overflow-hidden">
                      <div
                        className="h-full rounded-full bg-text-success/50 transition-all"
                        style={{ width: `${Math.min(cacheHitRatio, 100)}%` }}
                      />
                    </div>
                  </div>
                )}

                {/* Per-model breakdown */}
                <div className="mt-2.5 space-y-1.5">
                  {Object.entries(summary.modelUsage ?? {}).map(([model, usage]) => (
                    <div key={model} className="flex items-baseline justify-between text-2xs text-muted-foreground">
                      <div className="flex items-baseline gap-2 min-w-0">
                        <span className="font-medium text-foreground/70 truncate">{model}</span>
                        <span className="opacity-50 shrink-0">
                          {formatTokens(usage.inputTokens)} in / {formatTokens(usage.outputTokens)} out
                        </span>
                      </div>
                      <span className="font-mono font-medium text-foreground/70 shrink-0 ml-3">
                        ${usage.costUSD.toFixed(4)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Section: Errors */}
            {summary.errors && summary.errors.length > 0 && (
              <div className="px-3 py-2.5">
                <div className="text-2xs font-medium text-destructive/60 uppercase tracking-wider mb-2">
                  {summary.errors.length} {summary.errors.length === 1 ? 'Error' : 'Errors'}
                </div>
                <div className="space-y-1">
                  {summary.errors.slice(0, 3).map((error, idx) => (
                    <div
                      key={idx}
                      className="text-2xs text-destructive/70 font-mono bg-destructive/5 px-2 py-1 rounded-md"
                    >
                      {typeof error === 'string' ? error : JSON.stringify(error)}
                    </div>
                  ))}
                  {summary.errors.length > 3 && (
                    <div className="text-2xs text-destructive/50">
                      &hellip; and {summary.errors.length - 3} more
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </CollapsibleContent>
      )}
    </Collapsible>

    {/* Handoff prompt when a limit was exceeded */}
    {summary.limitExceeded && (
      <div className="mt-2 flex items-center gap-2">
        <span className="text-xs text-muted-foreground">
          {summary.limitExceeded === 'budget' ? 'Budget' : 'Turn'} limit reached.
        </span>
        <Button
          variant="outline"
          size="sm"
          className="h-6 text-xs gap-1"
          onClick={() => useAppStore.getState().setShowSessionHandoff(true)}
        >
          <ArrowRight className="w-3 h-3" />
          Continue in new conversation
        </Button>
      </div>
    )}
    </div>
  );
});
