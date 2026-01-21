'use client';

import { useAppStore } from '@/stores/appStore';
import { ScrollArea } from '@/components/ui/scroll-area';
import { EmptyState } from '@/components/ui/empty-state';
import { Circle, CheckCircle2, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { AgentTodoItem } from '@/lib/types';

export function TodoPanel() {
  const { selectedConversationId, agentTodos } = useAppStore();

  // Get todos for current conversation
  const currentAgentTodos = selectedConversationId ? agentTodos[selectedConversationId] || [] : [];

  // Calculate counts
  const agentCompleted = currentAgentTodos.filter((t) => t.status === 'completed').length;
  const agentTotal = currentAgentTodos.length;

  return (
    <ScrollArea className="h-full">
      <div className="py-1 px-2">
        {/* Header */}
        <div className="flex items-center gap-1 py-1.5 text-[11px] font-medium text-purple-700 dark:text-purple-400 uppercase tracking-wide">
          <span>Agent Tasks</span>
          {agentTotal > 0 && (
            <span className="ml-auto text-[11px] font-normal normal-case tracking-normal text-muted-foreground">
              {agentCompleted}/{agentTotal}
            </span>
          )}
        </div>

        {/* Tasks */}
        <div className="space-y-0.5">
          {currentAgentTodos.length === 0 ? (
            <EmptyState
              icon={Circle}
              title="No agent tasks yet"
              description="Tasks will appear when the agent is working"
              className="py-8"
            />
          ) : (
            currentAgentTodos.map((todo, index) => (
              <AgentTodoRow key={`${todo.content}-${index}`} todo={todo} />
            ))
          )}
        </div>
      </div>
    </ScrollArea>
  );
}

function AgentTodoRow({ todo }: { todo: AgentTodoItem }) {
  const getStatusIcon = () => {
    switch (todo.status) {
      case 'completed':
        return <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />;
      case 'in_progress':
        return <Loader2 className="h-3.5 w-3.5 text-blue-500 animate-spin shrink-0" />;
      default:
        return <Circle className="h-3.5 w-3.5 text-muted-foreground shrink-0" />;
    }
  };

  // Show activeForm for in_progress tasks, content otherwise
  const displayText = todo.status === 'in_progress' ? todo.activeForm : todo.content;

  return (
    <div
      className={cn(
        'flex items-start gap-2 py-1 pl-3 pr-2 rounded-sm',
        todo.status === 'completed' && 'opacity-60'
      )}
    >
      {getStatusIcon()}
      <span
        className={cn(
          'text-xs leading-tight',
          todo.status === 'completed' && 'line-through text-muted-foreground'
        )}
      >
        {displayText}
      </span>
    </div>
  );
}

