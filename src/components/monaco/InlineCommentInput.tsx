'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { Send, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface InlineCommentInputProps {
  onSubmit: (content: string) => void;
  onCancel: () => void;
}

export function InlineCommentInput({ onSubmit, onCancel }: InlineCommentInputProps) {
  const [text, setText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    // Auto-focus on mount
    textareaRef.current?.focus();
  }, []);

  const handleSubmit = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
  }, [text, onSubmit]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onCancel();
      } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        e.stopPropagation();
        handleSubmit();
      }
    },
    [onCancel, handleSubmit]
  );

  return (
    <div className="border-l-4 border-l-blue-500 bg-muted/60 backdrop-blur-sm p-3 my-1 rounded-r text-sm shadow-sm">
      <textarea
        ref={textareaRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Add a comment... (Cmd+Enter to submit, Escape to cancel)"
        className="w-full min-h-[60px] max-h-[200px] resize-y bg-background border border-border rounded px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        rows={3}
      />
      <div className="flex items-center justify-end gap-2 mt-2">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs"
          onClick={onCancel}
        >
          <X className="w-3 h-3 mr-1" />
          Cancel
        </Button>
        <Button
          size="sm"
          className="h-7 text-xs"
          onClick={handleSubmit}
          disabled={!text.trim()}
        >
          <Send className="w-3 h-3 mr-1" />
          Comment
        </Button>
      </div>
    </div>
  );
}
