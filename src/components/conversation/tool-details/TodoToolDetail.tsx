'use client';

import { memo } from 'react';
import { CheckCircle2, Circle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface TodoItem {
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
  activeForm?: string;
}

interface TodoToolDetailProps {
  todos: TodoItem[];
}

export const TodoToolDetail = memo(function TodoToolDetail({ todos }: TodoToolDetailProps) {
  if (!todos || todos.length === 0) return null;

  return (
    <div className="rounded border bg-muted/30 p-2 space-y-1">
      {todos.map((todo, index) => (
        <div
          key={index}
          className={cn(
            'flex items-start gap-2 text-2xs py-0.5',
            todo.status === 'completed' && 'text-muted-foreground',
          )}
        >
          <span className="shrink-0 mt-0.5">
            {todo.status === 'completed' ? (
              <CheckCircle2 className="w-3 h-3 text-text-success" />
            ) : todo.status === 'in_progress' ? (
              <Circle className="w-3 h-3 text-primary" />
            ) : (
              <Circle className="w-3 h-3 text-muted-foreground/50" />
            )}
          </span>
          <span className={cn(
            todo.status === 'completed' && 'line-through',
          )}>
            {todo.content}
          </span>
        </div>
      ))}
    </div>
  );
});
