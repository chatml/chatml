'use client';

import { useState, useRef, useEffect } from 'react';
import { spawnAgent } from '@/lib/api';
import { useAppStore } from '@/stores/appStore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Bot, Send, Loader2 } from 'lucide-react';

interface AgentSpawnFormProps {
  repoId: string;
  onSpawn: () => void;
}

export function AgentSpawnForm({ repoId, onSpawn }: AgentSpawnFormProps) {
  const [task, setTask] = useState('');
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const addAgent = useAppStore((state) => state.addAgent);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

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
    <form onSubmit={handleSubmit} className="mb-6">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Bot className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            ref={inputRef}
            type="text"
            value={task}
            onChange={(e) => setTask(e.target.value)}
            placeholder="Describe the task for the agent..."
            className="pl-10"
            disabled={loading}
          />
        </div>
        <Button type="submit" disabled={loading || !task.trim()}>
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Spawning
            </>
          ) : (
            <>
              <Send className="w-4 h-4 mr-2" />
              Spawn
            </>
          )}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground mt-2">
        Press Enter to spawn an agent in an isolated worktree
      </p>
    </form>
  );
}
