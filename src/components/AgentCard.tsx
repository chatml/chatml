'use client';

import { useState } from 'react';
import { Play, Square, MoreHorizontal, Clock, DollarSign } from 'lucide-react';
import type { OrchestratorAgent, AgentRun } from '@/lib/agentTypes';
import { useAgentStore } from '@/stores/agentStore';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';

interface AgentCardProps {
  agent: OrchestratorAgent;
  runs?: AgentRun[];
  isSelected?: boolean;
  onClick?: () => void;
}

export function AgentCard({ agent, runs = [], isSelected, onClick }: AgentCardProps) {
  const { updateAgent, triggerRun, stopRun } = useAgentStore();
  const [isHovered, setIsHovered] = useState(false);

  const latestRun = runs[0];
  const recentRuns = runs.slice(0, 3);

  const getStatusColor = () => {
    if (agent.isRunning) return 'bg-text-info';
    if (agent.lastError) return 'bg-text-warning';
    if (!agent.enabled) return 'bg-muted-foreground';
    return 'bg-text-success';
  };

  const getStatusText = () => {
    if (agent.isRunning) return 'Running';
    if (agent.lastError) return 'Error';
    if (!agent.enabled) return 'Disabled';
    return 'Idle';
  };

  const formatTimeAgo = (dateStr: string | null) => {
    if (!dateStr) return 'Never';
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays}d ago`;
  };

  const formatCost = (cost: number) => {
    return cost < 0.01 ? '<$0.01' : `$${cost.toFixed(2)}`;
  };

  const handleToggleEnabled = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await updateAgent(agent.id, { enabled: !agent.enabled });
  };

  const handleTriggerRun = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await triggerRun(agent.id);
  };

  const handleStopRun = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (latestRun && latestRun.status === 'running') {
      await stopRun(agent.id, latestRun.id);
    }
  };

  return (
    <div
      className={cn(
        'group relative rounded-lg border p-3 transition-colors cursor-pointer',
        isSelected
          ? 'border-primary bg-primary/10'
          : 'border-border hover:border-border/80 bg-muted/50'
      )}
      onClick={onClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className={cn('h-2 w-2 rounded-full flex-shrink-0', getStatusColor())} />
          <span className="font-medium text-sm text-foreground truncate">
            {agent.definition?.name || agent.id}
          </span>
        </div>

        <div className="flex items-center gap-1">
          {/* Action buttons (shown on hover) */}
          <div className={cn(
            'flex items-center gap-1 transition-opacity',
            isHovered ? 'opacity-100' : 'opacity-0'
          )}>
            {agent.isRunning ? (
              <button
                onClick={handleStopRun}
                className="p-1 rounded hover:bg-surface-2 text-muted-foreground hover:text-text-error"
                title="Stop run"
              >
                <Square className="h-3.5 w-3.5" />
              </button>
            ) : (
              <button
                onClick={handleTriggerRun}
                className="p-1 rounded hover:bg-surface-2 text-muted-foreground hover:text-text-success"
                title="Trigger run"
                disabled={!agent.enabled}
              >
                <Play className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                onClick={(e) => e.stopPropagation()}
                className="p-1 rounded hover:bg-surface-2 text-muted-foreground"
              >
                <MoreHorizontal className="h-3.5 w-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem
                onClick={handleToggleEnabled}
                className="flex items-center justify-between"
              >
                <span>{agent.enabled ? 'Disable' : 'Enable'}</span>
                <Switch
                  checked={agent.enabled}
                  onCheckedChange={() => {}}
                  onClick={(e) => e.stopPropagation()}
                />
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleTriggerRun} disabled={!agent.enabled || agent.isRunning}>
                Run Now
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Status line */}
      <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
        <span>{getStatusText()}</span>
        <span>•</span>
        <span>{formatTimeAgo(agent.lastRunAt)}</span>
      </div>

      {/* Recent activity */}
      {recentRuns.length > 0 && (
        <div className="mt-2 space-y-1">
          {recentRuns.map((run) => (
            <div key={run.id} className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className={cn(
                'h-1.5 w-1.5 rounded-full',
                run.status === 'running' ? 'bg-text-info animate-pulse' :
                run.status === 'completed' ? 'bg-text-success' : 'bg-text-error'
              )} />
              <span className="truncate flex-1">
                {run.resultSummary || (run.status === 'running' ? 'Running...' : 'No summary')}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Stats footer */}
      <div className="mt-2 pt-2 border-t border-border flex items-center gap-3 text-xs text-muted-foreground">
        <div className="flex items-center gap-1">
          <Clock className="h-3 w-3" />
          <span>{agent.totalRuns} runs</span>
        </div>
        <div className="flex items-center gap-1">
          <DollarSign className="h-3 w-3" />
          <span>{formatCost(agent.totalCost)}</span>
        </div>
      </div>

      {/* Error indicator */}
      {agent.lastError && (
        <div className="mt-2 p-2 rounded bg-text-warning/10 border border-text-warning/20 text-xs text-text-warning truncate">
          {agent.lastError}
        </div>
      )}
    </div>
  );
}
