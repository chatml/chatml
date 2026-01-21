'use client';

import { useEffect } from 'react';
import { RefreshCw, Bot, DollarSign, Activity } from 'lucide-react';
import { useAgentStore } from '@/stores/agentStore';
import { AgentCard } from './AgentCard';
import { cn } from '@/lib/utils';

interface AgentSidebarProps {
  className?: string;
}

export function AgentSidebar({ className }: AgentSidebarProps) {
  const {
    agents,
    agentRuns,
    selectedAgentId,
    isLoading,
    fetchAgents,
    reloadAgents,
    selectAgent,
    getAgentRuns,
  } = useAgentStore();

  // Fetch agents on mount
  useEffect(() => {
    fetchAgents();
  }, [fetchAgents]);

  // Calculate daily stats
  const todayStats = agents.reduce(
    (acc, agent) => {
      const runs = getAgentRuns(agent.id);
      const todayRuns = runs.filter((r) => {
        const runDate = new Date(r.startedAt);
        const today = new Date();
        return runDate.toDateString() === today.toDateString();
      });

      return {
        runs: acc.runs + todayRuns.length,
        cost: acc.cost + todayRuns.reduce((sum, r) => sum + r.cost, 0),
        sessions: acc.sessions + todayRuns.reduce((sum, r) => sum + (r.sessionsCreated?.length || 0), 0),
      };
    },
    { runs: 0, cost: 0, sessions: 0 }
  );

  const formatCost = (cost: number) => {
    return cost < 0.01 ? '<$0.01' : `$${cost.toFixed(2)}`;
  };

  return (
    <div className={cn('flex flex-col h-full', className)}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-800">
        <div className="flex items-center gap-2">
          <Bot className="h-4 w-4 text-zinc-400" />
          <span className="text-sm font-medium text-zinc-200">Agents</span>
        </div>
        <button
          onClick={() => reloadAgents()}
          disabled={isLoading}
          className="p-1 rounded hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 disabled:opacity-50"
          title="Reload agents"
        >
          <RefreshCw className={cn('h-4 w-4', isLoading && 'animate-spin')} />
        </button>
      </div>

      {/* Agent list */}
      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {agents.length === 0 ? (
          <div className="text-center text-zinc-500 text-sm py-8">
            {isLoading ? 'Loading agents...' : 'No agents configured'}
          </div>
        ) : (
          agents.map((agent) => (
            <AgentCard
              key={agent.id}
              agent={agent}
              runs={agentRuns[agent.id] || []}
              isSelected={selectedAgentId === agent.id}
              onClick={() => selectAgent(selectedAgentId === agent.id ? null : agent.id)}
            />
          ))
        )}
      </div>

      {/* Daily stats footer */}
      <div className="border-t border-zinc-800 px-3 py-2">
        <div className="text-xs text-zinc-500 mb-1">Today</div>
        <div className="flex items-center gap-4 text-xs">
          <div className="flex items-center gap-1 text-zinc-400">
            <Activity className="h-3 w-3" />
            <span>{todayStats.runs} runs</span>
          </div>
          <div className="flex items-center gap-1 text-zinc-400">
            <DollarSign className="h-3 w-3" />
            <span>{formatCost(todayStats.cost)}</span>
          </div>
          {todayStats.sessions > 0 && (
            <div className="text-zinc-400">
              {todayStats.sessions} sessions
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
