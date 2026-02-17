'use client';

import { memo, useMemo } from 'react';
import { LayoutGrid, Users, Loader2, CheckCircle2 } from 'lucide-react';
import { useAppStore } from '@/stores/appStore';
import type { Conversation, AgentTodoItem } from '@/lib/types';

interface TeamOverviewDashboardProps {
  conversation: Conversation;
}

function TeammateStatusCard({ conversation }: { conversation: Conversation }) {
  const selectConversation = useAppStore(s => s.selectConversation);
  const agentTodos = useAppStore(s => s.agentTodos[conversation.id] || []);

  const activeTodos = agentTodos.filter((t: AgentTodoItem) => t.status === 'in_progress');
  const completedTodos = agentTodos.filter((t: AgentTodoItem) => t.status === 'completed');

  return (
    <div
      className="border rounded-lg p-3 hover:bg-surface-2 cursor-pointer transition-colors"
      onClick={() => selectConversation(conversation.id)}
      role="button"
      tabIndex={0}
    >
      <div className="flex items-center gap-2 mb-2">
        {conversation.status === 'active' ? (
          <Loader2 size={14} className="animate-spin text-primary" />
        ) : (
          <CheckCircle2 size={14} className="text-text-success" />
        )}
        <span className="font-medium text-sm truncate">{conversation.name}</span>
      </div>
      {activeTodos.length > 0 && (
        <p className="text-xs text-muted-foreground truncate mb-1">
          {activeTodos[0].activeForm}
        </p>
      )}
      <div className="flex items-center gap-3 text-2xs text-muted-foreground">
        <span>{completedTodos.length}/{agentTodos.length} tasks</span>
      </div>
    </div>
  );
}

const STATUS_ORDER: Record<string, number> = { in_progress: 0, pending: 1, completed: 2 };

export const TeamOverviewDashboard = memo(function TeamOverviewDashboard({
  conversation,
}: TeamOverviewDashboardProps) {
  const parentConvId = conversation.parentConversationId;
  const conversations = useAppStore(s => s.conversations);
  const agentTodos = useAppStore(s => s.agentTodos);

  const teammates = useMemo(
    () => conversations.filter(
      c => c.parentConversationId === parentConvId && c.type === 'teammate'
    ),
    [conversations, parentConvId]
  );

  const taskGroups = useMemo(() => {
    return teammates
      .map(tm => ({
        convId: tm.id,
        convName: tm.name,
        todos: [...(agentTodos[tm.id] || [])].sort(
          (a, b) => (STATUS_ORDER[a.status] ?? 1) - (STATUS_ORDER[b.status] ?? 1)
        ),
      }))
      .filter(g => g.todos.length > 0);
  }, [teammates, agentTodos]);

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <div className="flex items-center gap-2 px-4 py-3 border-b">
        <LayoutGrid size={18} className="text-muted-foreground" />
        <span className="text-lg font-semibold">Team Overview</span>
        <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
          {teammates.length} teammate{teammates.length !== 1 ? 's' : ''}
        </span>
      </div>

      <div className="p-4 space-y-6">
        <section>
          <h3 className="text-sm font-medium text-muted-foreground mb-2">Teammates</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {teammates.map(tm => (
              <TeammateStatusCard key={tm.id} conversation={tm} />
            ))}
          </div>
          {teammates.length === 0 && (
            <p className="text-sm text-muted-foreground">No teammates yet.</p>
          )}
        </section>

        {taskGroups.length > 0 && (
          <section>
            <h3 className="text-sm font-medium text-muted-foreground mb-2">Tasks</h3>
            <div className="space-y-4">
              {taskGroups.map(group => (
                <div key={group.convId}>
                  <div className="flex items-center gap-2 mb-1">
                    <Users size={14} className="text-muted-foreground" />
                    <span className="text-sm font-medium">{group.convName}</span>
                  </div>
                  <div className="space-y-0.5 pl-5">
                    {group.todos.map((todo, i) => (
                      <div key={i} className="flex items-center gap-2 text-sm">
                        {todo.status === 'completed' ? (
                          <CheckCircle2 size={12} className="text-text-success shrink-0" />
                        ) : todo.status === 'in_progress' ? (
                          <Loader2 size={12} className="animate-spin text-primary shrink-0" />
                        ) : (
                          <div className="w-3 h-3 rounded-full border border-muted-foreground/50 shrink-0" />
                        )}
                        <span className={todo.status === 'completed' ? 'opacity-50 line-through' : ''}>
                          {todo.status === 'in_progress' ? todo.activeForm : todo.content}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
});
