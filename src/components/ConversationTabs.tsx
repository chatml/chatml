'use client';

import { useAppStore } from '@/stores/appStore';
import { Button } from '@/components/ui/button';
import {
  Plus,
  X,
  Loader2,
  Circle,
  CheckCircle2,
  Sparkles,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Conversation } from '@/lib/types';

interface ConversationTabsProps {
  sessionId: string;
  onNewConversation: (type: 'task' | 'review' | 'chat') => void;
}

export function ConversationTabs({ sessionId, onNewConversation }: ConversationTabsProps) {
  const {
    conversations,
    messages,
    selectedConversationId,
    selectConversation,
    removeConversation,
    selectFileTab,
    selectedFileTabId,
    streamingState,
  } = useAppStore();

  const sessionConversations = conversations.filter((c) => c.sessionId === sessionId);
  const isFileActive = selectedFileTabId !== null;

  // Check if a conversation is fresh (no user messages yet)
  const isFreshConversation = (convId: string) => {
    const convMessages = messages.filter((m) => m.conversationId === convId);
    // Fresh if no user messages (system messages like setup info don't count)
    return !convMessages.some((m) => m.role === 'user');
  };

  const handleSelectConversation = (id: string) => {
    selectConversation(id);
    selectFileTab(null);
  };

  const handleRemoveConversation = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    removeConversation(id);
  };

  const getStatusIndicator = (conv: Conversation) => {
    // Check streaming state first (more immediate UI feedback)
    const streaming = streamingState[conv.id];
    if (streaming?.isStreaming) {
      return <Loader2 className="w-2.5 h-2.5 animate-spin text-primary" />;
    }
    // Check for errors
    if (streaming?.error) {
      return <Circle className="w-2.5 h-2.5 text-destructive fill-destructive" />;
    }
    // Fresh conversation - show Claude icon in orange
    if (conv.status === 'idle' && isFreshConversation(conv.id)) {
      return <Sparkles className="w-2.5 h-2.5 text-orange-500" />;
    }
    // Use conversation status as source of truth
    switch (conv.status) {
      case 'active':
        return <Loader2 className="w-2.5 h-2.5 animate-spin text-primary" />;
      case 'completed':
        return <CheckCircle2 className="w-2.5 h-2.5 text-green-500" />;
      case 'idle':
      default:
        return <Circle className="w-2.5 h-2.5 text-muted-foreground/50" />;
    }
  };

  return (
    <div className="flex items-center gap-0.5">
      {sessionConversations.map((conv) => {
        const isSelected = !isFileActive && selectedConversationId === conv.id;

        return (
          <div
            key={conv.id}
            className={cn(
              'group relative flex items-center gap-1.5 px-2.5 py-1 cursor-pointer text-xs transition-colors shrink-0',
              isSelected
                ? 'text-foreground'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded'
            )}
            onClick={() => handleSelectConversation(conv.id)}
          >
            {/* Selected indicator - purple underline */}
            {isSelected && (
              <div className="absolute bottom-0 left-2 right-2 h-0.5 bg-purple-500/60 rounded-full" />
            )}
            {getStatusIndicator(conv)}
            <span className="max-w-[120px] truncate font-medium">{conv.name}</span>
            <button
              className="hover:text-destructive ml-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
              onClick={(e) => handleRemoveConversation(conv.id, e)}
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        );
      })}

      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6 text-muted-foreground hover:text-foreground shrink-0"
        onClick={() => onNewConversation('task')}
        title="New conversation"
      >
        <Plus className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
