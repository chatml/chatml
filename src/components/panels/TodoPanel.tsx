'use client';

import { useMemo } from 'react';
import { useAppStore } from '@/stores/appStore';
import { useSelectedIds } from '@/stores/selectors';
import { ScrollArea } from '@/components/ui/scroll-area';
import { EmptyState } from '@/components/ui/empty-state';
import { Circle, CheckCircle2, Loader2, ListTodo } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { AgentTodoItem } from '@/lib/types';

const STATUS_ORDER: Record<AgentTodoItem['status'], number> = {
  in_progress: 0,
  pending: 1,
  completed: 2,
};

export function TodoPanel() {
  const { selectedConversationId } = useSelectedIds();
  const agentTodos = useAppStore((s) => s.agentTodos);

  const currentAgentTodos = useMemo(() => {
    const todos = selectedConversationId ? agentTodos[selectedConversationId] || [] : [];
    return [...todos].sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]);
  }, [selectedConversationId, agentTodos]);

  if (currentAgentTodos.length === 0) {
    return (
      <div className="h-full flex items-center justify-center">
        <EmptyState
          icon={ListTodo}
          title="No agent tasks yet"
          description="Tasks will appear when the agent is working"
        />
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="py-1 px-2 space-y-0.5">
        {currentAgentTodos.map((todo, index) => (
          <AgentTodoRow key={`${todo.content}-${index}`} todo={todo} />
        ))}
      </div>
    </ScrollArea>
  );
}

function AgentTodoRow({ todo }: { todo: AgentTodoItem }) {
  const getStatusIcon = () => {
    switch (todo.status) {
      case 'completed':
        return <CheckCircle2 className="h-3.5 w-3.5 text-text-success shrink-0" />;
      case 'in_progress':
        return <Loader2 className="h-3.5 w-3.5 text-text-info animate-spin shrink-0" />;
      default:
        return <Circle className="h-3.5 w-3.5 text-muted-foreground shrink-0" />;
    }
  };

  // Show activeForm for in_progress tasks, content otherwise
  const displayText = todo.status === 'in_progress' ? todo.activeForm : todo.content;

  return (
    <div
      className={cn(
        'flex items-start gap-2 py-1 px-1 rounded-sm transition-all duration-300',
        todo.status === 'completed' && 'opacity-50'
      )}
    >
      {getStatusIcon()}
      <span
        className={cn(
          'text-xs leading-tight transition-all duration-300',
          todo.status === 'completed' && 'line-through text-muted-foreground'
        )}
      >
        {displayText}
      </span>
    </div>
  );
}

