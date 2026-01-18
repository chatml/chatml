'use client';

import type { Agent } from '@/lib/types';
import { stopAgent, getAgentDiff, mergeAgent, deleteAgent } from '@/lib/api';
import { OutputLog } from './OutputLog';
import { useState } from 'react';
import { useAppStore } from '@/stores/appStore';

interface AgentCardProps {
  agent: Agent;
  onRefresh: () => void;
}

const statusColors = {
  pending: 'bg-yellow-500',
  running: 'bg-blue-500',
  done: 'bg-green-500',
  error: 'bg-red-500',
};

export function AgentCard({ agent, onRefresh }: AgentCardProps) {
  const [showDiff, setShowDiff] = useState(false);
  const [diff, setDiff] = useState('');
  const removeAgent = useAppStore((state) => state.removeAgent);

  const handleStop = async () => {
    await stopAgent(agent.id);
    onRefresh();
  };

  const handleViewDiff = async () => {
    const d = await getAgentDiff(agent.id);
    setDiff(d);
    setShowDiff(true);
  };

  const handleMerge = async () => {
    await mergeAgent(agent.id);
    await deleteAgent(agent.id);
    removeAgent(agent.id);
    onRefresh();
  };

  const handleDiscard = async () => {
    await deleteAgent(agent.id);
    removeAgent(agent.id);
    onRefresh();
  };

  return (
    <div className="bg-gray-800 rounded-lg p-4 mb-4">
      <div className="flex justify-between items-start mb-3">
        <div>
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${statusColors[agent.status]}`} />
            <span className="font-medium">Agent {agent.id.slice(0, 8)}</span>
            <span className="text-gray-400 text-sm">{agent.status}</span>
          </div>
          <div className="text-sm text-gray-400 mt-1">{agent.task}</div>
        </div>

        <div className="flex gap-2">
          {agent.status === 'running' && (
            <button
              onClick={handleStop}
              className="px-3 py-1 bg-red-600 hover:bg-red-700 rounded text-sm"
            >
              Stop
            </button>
          )}
          {agent.status === 'done' && (
            <>
              <button
                onClick={handleViewDiff}
                className="px-3 py-1 bg-gray-600 hover:bg-gray-700 rounded text-sm"
              >
                View Diff
              </button>
              <button
                onClick={handleMerge}
                className="px-3 py-1 bg-green-600 hover:bg-green-700 rounded text-sm"
              >
                Merge
              </button>
              <button
                onClick={handleDiscard}
                className="px-3 py-1 bg-gray-600 hover:bg-gray-700 rounded text-sm"
              >
                Discard
              </button>
            </>
          )}
          {agent.status === 'error' && (
            <button
              onClick={handleDiscard}
              className="px-3 py-1 bg-gray-600 hover:bg-gray-700 rounded text-sm"
            >
              Discard
            </button>
          )}
        </div>
      </div>

      <OutputLog agentId={agent.id} />

      {showDiff && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-gray-800 rounded-lg p-6 w-3/4 max-h-[80vh] flex flex-col">
            <div className="flex justify-between mb-4">
              <h3 className="text-lg font-bold">Diff</h3>
              <button onClick={() => setShowDiff(false)} className="text-xl">x</button>
            </div>
            <pre className="bg-gray-900 p-4 rounded overflow-auto text-sm flex-1">
              {diff || 'No changes'}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
