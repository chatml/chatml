'use client';

import { useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { History, MessageSquare, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from '@/components/ui/popover';
import { useRecentlyClosedStore, type ClosedConversation } from '@/stores/recentlyClosedStore';
import { deleteClosedConversations } from '@/hooks/useRecentlyClosed';
import { cn } from '@/lib/utils';

interface RecentlyClosedPopoverProps {
  sessionId: string | null;
  onRestore: (convId: string) => Promise<void>;
}

function formatRelativeTime(closedAt: number): string {
  const diff = Date.now() - closedAt;
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function RecentlyClosedPopover({ sessionId, onRestore }: RecentlyClosedPopoverProps) {
  const [open, setOpen] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);

  const closedConversations = useRecentlyClosedStore(
    useShallow((s) =>
      sessionId ? s.closedConversations.filter((c) => c.sessionId === sessionId) : [],
    ),
  );

  if (closedConversations.length === 0) return null;

  const handleRestore = async (conv: ClosedConversation) => {
    if (restoringId) return;
    setRestoringId(conv.id);
    try {
      await onRestore(conv.id);
      // onRestore removes the entry from the store synchronously; check what's left
      if (closedConversations.length <= 1) setOpen(false);
    } finally {
      setRestoringId(null);
    }
  };

  const handleClearAll = () => {
    if (sessionId) {
      const toDelete = useRecentlyClosedStore.getState()
        .closedConversations.filter((c) => c.sessionId === sessionId);
      useRecentlyClosedStore.getState().clearForSession(sessionId);
      // Permanently delete from backend (fire-and-forget)
      deleteClosedConversations(toDelete.map((c) => c.id));
    }
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-foreground"
          title="Recently closed conversations"
          aria-label="Recently closed conversations"
        >
          <History className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-0">
        <div className="px-3 py-2 border-b border-border">
          <p className="text-xs font-medium text-muted-foreground">Recently closed</p>
        </div>
        <div className="max-h-64 overflow-y-auto">
          {closedConversations.map((conv) => (
            <button
              key={conv.id}
              type="button"
              onClick={() => handleRestore(conv)}
              disabled={restoringId === conv.id}
              className={cn(
                'w-full text-left px-3 py-2 hover:bg-accent/50 transition-colors flex items-start gap-2',
                restoringId === conv.id && 'opacity-50',
              )}
            >
              <MessageSquare className="w-3.5 h-3.5 mt-0.5 shrink-0 text-muted-foreground" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium truncate">{conv.name}</p>
                <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                  <span>{formatRelativeTime(conv.closedAt)}</span>
                  {conv.messageCount > 0 && (
                    <span>{conv.messageCount} msg{conv.messageCount !== 1 ? 's' : ''}</span>
                  )}
                </div>
              </div>
              {restoringId === conv.id && (
                <Loader2 className="w-3 h-3 animate-spin shrink-0 mt-0.5 text-muted-foreground" />
              )}
            </button>
          ))}
        </div>
        <div className="px-3 py-1.5 border-t border-border">
          <button
            type="button"
            onClick={handleClearAll}
            className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
          >
            Clear all
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
