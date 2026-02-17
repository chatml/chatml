'use client';

import { useMemo } from 'react';
import { useAppStore } from '@/stores/appStore';
import { useSelectedIds } from '@/stores/selectors';
import { ScrollArea } from '@/components/ui/scroll-area';
import { EmptyState } from '@/components/ui/empty-state';
import { Circle, CheckCircle2, Loader2, ListTodo, Users } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { AgentTodoItem } from '@/lib/types';

const STATUS_ORDER: Record<AgentTodoItem['status'], number> = {
  in_progress: 0,
  pending: 1,
  completed: 2,
};

export function TodoPanel() {
  const { selectedSessionId, selectedConversationId } = useSelectedIds();
  const conversations = useAppStore((s) => s.conversations);
  const agentTodos = useAppStore((s) => s.agentTodos);

  const hasTeam = useMemo(
    () => conversations.some((c) => c.sessionId === selectedSessionId && c.type === 'teammate'),
    [conversations, selectedSessionId]
  );

  const soloTodos = useMemo(() => {
    if (hasTeam) return [];
    const todos = selectedConversationId ? agentTodos[selectedConversationId] || [] : [];
    return [...todos].sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]);
  }, [hasTeam, selectedConversationId, agentTodos]);

  if (hasTeam && selectedSessionId) {
    return <TeamTodoView sessionId={selectedSessionId} />;
  }

  return <SoloTodoView todos={soloTodos} />;
}

function SoloTodoView({ todos }: { todos: AgentTodoItem[] }) {
  if (todos.length === 0) {
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
        {todos.map((todo, index) => (
          <AgentTodoRow key={`${todo.content}-${index}`} todo={todo} />
        ))}
      </div>
    </ScrollArea>
  );
}

function TeamTodoView({ sessionId }: { sessionId: string }) {
  const conversations = useAppStore((s) => s.conversations);
  const agentTodos = useAppStore((s) => s.agentTodos);

  const groups = useMemo(() => {
    return conversations
      .filter((c) => c.sessionId === sessionId && (c.type === 'teammate' || c.type === 'task'))
      .map((conv) => ({
        convId: conv.id,
        convName: conv.name,
        convType: conv.type,
        todos: [...(agentTodos[conv.id] || [])].sort(
          (a, b) => (STATUS_ORDER[a.status] ?? 1) - (STATUS_ORDER[b.status] ?? 1)
        ),
      }))
      .filter((group) => group.todos.length > 0);
  }, [conversations, sessionId, agentTodos]);

  if (groups.length === 0) {
    return (
      <div className="h-full flex items-center justify-center">
        <EmptyState
          icon={ListTodo}
          title="No agent tasks yet"
          description="Tasks will appear when teammates are working"
        />
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="py-1 px-2 space-y-4">
        {groups.map((group) => (
          <div key={group.convId}>
            <div className="flex items-center gap-2 mb-1 px-1">
              {group.convType === 'teammate' && (
                <Users className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              )}
              <span className="text-xs font-medium">{group.convName}</span>
            </div>
            <div className="space-y-0.5 pl-5">
              {group.todos.map((todo, i) => (
                <AgentTodoRow key={`${todo.content}-${i}`} todo={todo} />
              ))}
            </div>
          </div>
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
