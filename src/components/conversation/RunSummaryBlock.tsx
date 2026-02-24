'use client';

import { useState, memo } from 'react';
import { useAppStore } from '@/stores/appStore';
import {
  CheckCircle2,
  XCircle,
  Clock,
  Wrench,
  DollarSign,
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

  // Check if we have detailed breakdown to show
  const hasDetailedStats = (stats?.toolsByType && Object.keys(stats.toolsByType).length > 0) ||
    (showTokenUsage && hasModelUsage);

  // Get tool icon for breakdown
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

  return (
    <div>
    <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
      <CollapsibleTrigger
        className={cn(
          'group mt-3 flex items-center gap-3 text-xs text-muted-foreground flex-wrap w-full',
          'hover:text-foreground/80 transition-colors cursor-pointer',
          !summary.success && 'text-destructive/70'
        )}
      >
        {/* Status */}
        {summary.success ? (
          <CheckCircle2 className="w-3 h-3 text-text-success shrink-0" />
        ) : (
          <XCircle className="w-3 h-3 text-destructive shrink-0" />
        )}

        {/* Duration */}
        {duration && (
          <span className="flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {duration}
          </span>
        )}

        {/* Cost */}
        {showChatCost && cost && (
          <span className="flex items-center gap-1">
            <DollarSign className="w-3 h-3" />
            {cost}
          </span>
        )}

        {/* Token counts */}
        {showTokenUsage && totalInputTokens > 0 && (
          <span className="flex items-center gap-1">
            <ArrowDownToLine className="w-3 h-3" />
            {formatTokens(totalInputTokens)} in
          </span>
        )}
        {showTokenUsage && totalOutputTokens > 0 && (
          <span className="flex items-center gap-1">
            <ArrowUpFromLine className="w-3 h-3" />
            {formatTokens(totalOutputTokens)} out
          </span>
        )}

        {/* Turns */}
        {summary.turns !== undefined && (
          <span className="flex items-center gap-1">
            <RotateCw className="w-3 h-3" />
            {summary.turns} turn{summary.turns !== 1 ? 's' : ''}
          </span>
        )}

        {/* Tool Calls */}
        {stats && stats.toolCalls > 0 && (
          <span className="flex items-center gap-1">
            <Wrench className="w-3 h-3" />
            {stats.toolCalls} tool{stats.toolCalls !== 1 ? 's' : ''}
          </span>
        )}

        {/* Revert to checkpoint */}
        {checkpointUuid && (
          <Popover open={confirmOpen} onOpenChange={setConfirmOpen}>
            <Tooltip>
              <TooltipTrigger asChild>
                <PopoverTrigger asChild>
                  <span
                    role="button"
                    tabIndex={0}
                    className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer shrink-0 p-0.5 rounded hover:bg-muted"
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

        {/* Expand indicator if there are detailed stats */}
        {hasDetailedStats && (
          <span className={cn('shrink-0', !checkpointUuid && 'ml-auto')}>
            {isExpanded ? (
              <ChevronDown className="w-3 h-3" />
            ) : (
              <ChevronRight className="w-3 h-3" />
            )}
          </span>
        )}
      </CollapsibleTrigger>

      {hasDetailedStats && (
        <CollapsibleContent>
          <div className="mt-2 ml-4 p-2 rounded border bg-muted/30 space-y-2">
            {/* Tool breakdown by type */}
            {stats?.toolsByType && Object.keys(stats.toolsByType).length > 0 && (
              <div>
                <div className="text-2xs text-muted-foreground/60 mb-1.5 font-medium">
                  Tool Breakdown
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {Object.entries(stats.toolsByType || {}).map(([tool, count]) => {
                    const Icon = getToolIcon(tool);
                    return (
                      <div
                        key={tool}
                        className="flex items-center gap-1.5 text-2xs text-muted-foreground"
                      >
                        <Icon className="w-3 h-3 shrink-0" />
                        <span className="font-medium">{tool}</span>
                        <span className="text-muted-foreground/60">{'\u00D7'}{count}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* File operations summary */}
            {stats && (
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-2xs text-muted-foreground">
                {stats.filesRead > 0 && (
                  <span className="flex items-center gap-1">
                    <FileText className="w-3 h-3" />
                    {stats.filesRead} file{stats.filesRead !== 1 ? 's' : ''} read
                  </span>
                )}
                {stats.filesWritten > 0 && (
                  <span className="flex items-center gap-1">
                    <FileEdit className="w-3 h-3" />
                    {stats.filesWritten} file{stats.filesWritten !== 1 ? 's' : ''} written
                  </span>
                )}
                {stats.bashCommands > 0 && (
                  <span className="flex items-center gap-1">
                    <Terminal className="w-3 h-3" />
                    {stats.bashCommands} command{stats.bashCommands !== 1 ? 's' : ''}
                  </span>
                )}
                {stats.webSearches > 0 && (
                  <span className="flex items-center gap-1">
                    <Globe className="w-3 h-3" />
                    {stats.webSearches} web search{stats.webSearches !== 1 ? 'es' : ''}
                  </span>
                )}
                {stats.subAgents > 0 && (
                  <span className="flex items-center gap-1">
                    <GitBranch className="w-3 h-3" />
                    {stats.subAgents} sub-agent{stats.subAgents !== 1 ? 's' : ''}
                  </span>
                )}
              </div>
            )}

            {/* Tool execution time */}
            {toolDuration && (
              <div className="text-2xs text-muted-foreground/60">
                Total tool execution time: {toolDuration}
              </div>
            )}

            {/* Token usage breakdown */}
            {showTokenUsage && hasModelUsage && (
              <div className="pt-2 border-t border-border/50">
                <div className="text-2xs text-muted-foreground/60 mb-1.5 font-medium">
                  Token Usage
                </div>
                {/* Aggregate usage */}
                {summary.usage && (
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-2xs text-muted-foreground mb-2">
                    <span>Input: {totalInputTokens.toLocaleString()}</span>
                    <span>Output: {totalOutputTokens.toLocaleString()}</span>
                    {summary.usage.cacheReadInputTokens ? (
                      <span>Cache read: {summary.usage.cacheReadInputTokens.toLocaleString()}</span>
                    ) : null}
                    {summary.usage.cacheCreationInputTokens ? (
                      <span>Cache write: {summary.usage.cacheCreationInputTokens.toLocaleString()}</span>
                    ) : null}
                  </div>
                )}
                {/* Per-model breakdown */}
                <div className="space-y-1.5">
                  {Object.entries(summary.modelUsage ?? {}).map(([model, usage]) => (
                    <div key={model} className="text-2xs text-muted-foreground">
                      <span className="font-medium">{model}</span>
                      <div className="ml-2 flex flex-wrap gap-x-3 gap-y-0.5">
                        <span>In: {usage.inputTokens.toLocaleString()}</span>
                        <span>Out: {usage.outputTokens.toLocaleString()}</span>
                        <span>Cost: ${usage.costUSD.toFixed(4)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Errors if any */}
            {summary.errors && summary.errors.length > 0 && (
              <div className="mt-2 pt-2 border-t border-border/50">
                <div className="text-2xs text-destructive/80 font-medium mb-1">
                  {summary.errors.length} error{summary.errors.length !== 1 ? 's' : ''}
                </div>
                <div className="space-y-1">
                  {summary.errors.slice(0, 3).map((error, idx) => (
                    <div
                      key={idx}
                      className="text-2xs text-destructive/70 font-mono bg-destructive/5 p-1 rounded"
                    >
                      {typeof error === 'string' ? error : JSON.stringify(error)}
                    </div>
                  ))}
                  {summary.errors.length > 3 && (
                    <div className="text-2xs text-destructive/60">
                      ... and {summary.errors.length - 3} more
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
