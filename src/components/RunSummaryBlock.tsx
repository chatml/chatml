'use client';

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
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { RunSummary } from '@/lib/types';

interface RunSummaryBlockProps {
  summary: RunSummary;
}

export function RunSummaryBlock({ summary }: RunSummaryBlockProps) {
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

  return (
    <div
      className={cn(
        'mt-3 flex items-center gap-3 text-[11px] text-muted-foreground flex-wrap',
        !summary.success && 'text-destructive/70'
      )}
    >
      {/* Status */}
      {summary.success ? (
        <CheckCircle2 className="w-3 h-3 text-green-500 shrink-0" />
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
      {cost && (
        <span className="flex items-center gap-1">
          <DollarSign className="w-3 h-3" />
          {cost}
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

      {/* Files Read */}
      {stats && stats.filesRead > 0 && (
        <span className="flex items-center gap-1">
          <FileText className="w-3 h-3" />
          {stats.filesRead} read
        </span>
      )}

      {/* Files Written */}
      {stats && stats.filesWritten > 0 && (
        <span className="flex items-center gap-1">
          <FileEdit className="w-3 h-3" />
          {stats.filesWritten} written
        </span>
      )}

      {/* Bash Commands */}
      {stats && stats.bashCommands > 0 && (
        <span className="flex items-center gap-1">
          <Terminal className="w-3 h-3" />
          {stats.bashCommands} cmd{stats.bashCommands !== 1 ? 's' : ''}
        </span>
      )}

      {/* Web Searches */}
      {stats && stats.webSearches > 0 && (
        <span className="flex items-center gap-1">
          <Search className="w-3 h-3" />
          {stats.webSearches}
        </span>
      )}

      {/* Sub-agents */}
      {stats && stats.subAgents > 0 && (
        <span className="flex items-center gap-1">
          <GitBranch className="w-3 h-3" />
          {stats.subAgents} agent{stats.subAgents !== 1 ? 's' : ''}
        </span>
      )}
    </div>
  );
}
