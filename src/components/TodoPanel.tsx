'use client';

import { useState } from 'react';
import { useAppStore } from '@/stores/appStore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Checkbox } from '@/components/ui/checkbox';
import {
  ChevronDown,
  ChevronRight,
  Circle,
  CheckCircle2,
  Loader2,
  Plus,
  Trash2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { AgentTodoItem, CustomTodoItem } from '@/lib/types';

export function TodoPanel() {
  const {
    selectedSessionId,
    selectedConversationId,
    agentTodos,
    customTodos,
    addCustomTodo,
    toggleCustomTodo,
    deleteCustomTodo,
  } = useAppStore();

  const [agentTasksExpanded, setAgentTasksExpanded] = useState(true);
  const [myTasksExpanded, setMyTasksExpanded] = useState(true);
  const [newTodoContent, setNewTodoContent] = useState('');

  // Get todos for current conversation/session
  const currentAgentTodos = selectedConversationId ? agentTodos[selectedConversationId] || [] : [];
  const currentCustomTodos = selectedSessionId ? customTodos[selectedSessionId] || [] : [];

  // Calculate counts
  const agentCompleted = currentAgentTodos.filter((t) => t.status === 'completed').length;
  const agentTotal = currentAgentTodos.length;
  const customCompleted = currentCustomTodos.filter((t) => t.completed).length;
  const customTotal = currentCustomTodos.length;

  const handleAddTodo = () => {
    if (!selectedSessionId || !newTodoContent.trim()) return;
    addCustomTodo(selectedSessionId, newTodoContent.trim());
    setNewTodoContent('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleAddTodo();
    }
  };

  return (
    <ScrollArea className="h-full">
      <div className="py-1">
        {/* Agent Tasks Section */}
        <div className="px-2">
          <button
            className="flex items-center gap-1 w-full py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
            onClick={() => setAgentTasksExpanded(!agentTasksExpanded)}
          >
            {agentTasksExpanded ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            )}
            <span>Agent Tasks</span>
            {agentTotal > 0 && (
              <span className="ml-auto text-[10px] text-muted-foreground">
                ({agentCompleted}/{agentTotal})
              </span>
            )}
          </button>

          {agentTasksExpanded && (
            <div className="ml-1 space-y-0.5">
              {currentAgentTodos.length === 0 ? (
                <p className="text-xs text-muted-foreground py-2 pl-3">
                  No agent tasks yet
                </p>
              ) : (
                currentAgentTodos.map((todo, index) => (
                  <AgentTodoRow key={`${todo.content}-${index}`} todo={todo} />
                ))
              )}
            </div>
          )}
        </div>

        {/* Divider */}
        <div className="my-2 border-t" />

        {/* My Tasks Section */}
        <div className="px-2">
          <button
            className="flex items-center gap-1 w-full py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
            onClick={() => setMyTasksExpanded(!myTasksExpanded)}
          >
            {myTasksExpanded ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            )}
            <span>My Tasks</span>
            {customTotal > 0 && (
              <span className="ml-auto text-[10px] text-muted-foreground">
                ({customCompleted}/{customTotal})
              </span>
            )}
          </button>

          {myTasksExpanded && (
            <div className="ml-1 space-y-0.5">
              {currentCustomTodos.map((todo) => (
                <CustomTodoRow
                  key={todo.id}
                  todo={todo}
                  onToggle={() => selectedSessionId && toggleCustomTodo(selectedSessionId, todo.id)}
                  onDelete={() => selectedSessionId && deleteCustomTodo(selectedSessionId, todo.id)}
                />
              ))}

              {/* Add todo input */}
              <div className="flex items-center gap-1 py-1 pl-3">
                <Input
                  type="text"
                  placeholder="Add a task..."
                  value={newTodoContent}
                  onChange={(e) => setNewTodoContent(e.target.value)}
                  onKeyDown={handleKeyDown}
                  className="h-6 text-xs flex-1"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 shrink-0"
                  onClick={handleAddTodo}
                  disabled={!newTodoContent.trim()}
                >
                  <Plus className="h-3 w-3" />
                </Button>
              </div>
            </div>
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

function CustomTodoRow({
  todo,
  onToggle,
  onDelete,
}: {
  todo: CustomTodoItem;
  onToggle: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="group flex items-start gap-2 py-1 pl-3 pr-2 rounded-sm hover:bg-accent/50">
      <button
        onClick={onToggle}
        className="shrink-0 mt-0.5 hover:opacity-80 transition-opacity"
      >
        {todo.completed ? (
          <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
        ) : (
          <Circle className="h-3.5 w-3.5 text-muted-foreground" />
        )}
      </button>
      <span
        className={cn(
          'text-xs leading-tight flex-1',
          todo.completed && 'line-through text-muted-foreground'
        )}
      >
        {todo.content}
      </span>
      <Button
        variant="ghost"
        size="icon"
        className="h-5 w-5 opacity-0 group-hover:opacity-100 shrink-0"
        onClick={onDelete}
      >
        <Trash2 className="h-3 w-3 text-muted-foreground hover:text-destructive" />
      </Button>
    </div>
  );
}
