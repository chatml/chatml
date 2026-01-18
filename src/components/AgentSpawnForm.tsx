'use client';

import { useState } from 'react';
import { spawnAgent } from '@/lib/api';
import { useAppStore } from '@/stores/appStore';

interface AgentSpawnFormProps {
  repoId: string;
  onSpawn: () => void;
}

export function AgentSpawnForm({ repoId, onSpawn }: AgentSpawnFormProps) {
  const [task, setTask] = useState('');
  const [loading, setLoading] = useState(false);
  const addAgent = useAppStore((state) => state.addAgent);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!task.trim()) return;

    setLoading(true);
    try {
      const agent = await spawnAgent(repoId, task);
      addAgent(agent);
      setTask('');
      onSpawn();
    } catch (err) {
      console.error('Failed to spawn agent:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex gap-2 mb-4">
      <input
        type="text"
        value={task}
        onChange={(e) => setTask(e.target.value)}
        placeholder="Describe the task for the agent..."
        className="flex-1 p-2 bg-gray-700 rounded border border-gray-600"
      />
      <button
        type="submit"
        disabled={loading || !task.trim()}
        className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded disabled:opacity-50"
      >
        {loading ? 'Spawning...' : 'Spawn Agent'}
      </button>
    </form>
  );
}
