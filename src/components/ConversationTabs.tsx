'use client';

import { useAppStore } from '@/stores/appStore';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Plus,
  X,
  MessageSquare,
  ClipboardCheck,
  MessagesSquare,
  Loader2,
  Circle,
  CheckCircle2,
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
    selectedConversationId,
    selectConversation,
    removeConversation,
    selectFileTab,
    selectedFileTabId,
    streamingState,
  } = useAppStore();

  const sessionConversations = conversations.filter((c) => c.sessionId === sessionId);
  const isFileActive = selectedFileTabId !== null;

  // Check if a conversation is currently streaming
  const isConversationStreaming = (convId: string) =>
    streamingState[convId]?.isStreaming || false;

  const handleSelectConversation = (id: string) => {
    selectConversation(id);
    selectFileTab(null);
  };

  const handleRemoveConversation = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    removeConversation(id);
  };

  const getTypeIcon = (type: Conversation['type']) => {
    switch (type) {
      case 'task':
        return MessageSquare;
      case 'review':
        return ClipboardCheck;
      case 'chat':
        return MessagesSquare;
      default:
        return MessageSquare;
    }
  };

  const getStatusIndicator = (conv: Conversation) => {
    // Check streaming state first (more immediate)
    if (isConversationStreaming(conv.id)) {
      return <Loader2 className="w-2.5 h-2.5 animate-spin text-primary" />;
    }
    // Check for errors
    if (streamingState[conv.id]?.error) {
      return <Circle className="w-2.5 h-2.5 text-destructive" />;
    }
    // Fallback to conversation status
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
        const Icon = getTypeIcon(conv.type);
        const isSelected = !isFileActive && selectedConversationId === conv.id;

        return (
          <div
            key={conv.id}
            className={cn(
              'group flex items-center gap-1.5 px-2.5 py-1 rounded cursor-pointer text-xs transition-colors shrink-0',
              isSelected
                ? 'bg-muted text-foreground'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
            )}
            onClick={() => handleSelectConversation(conv.id)}
          >
            {getStatusIndicator(conv)}
            <Icon className="w-3 h-3" />
            <span className="max-w-[100px] truncate font-medium">{conv.name}</span>
            {conv.type !== 'task' && (
              <Badge
                variant="secondary"
                className="h-4 px-1 text-[9px] font-medium capitalize"
              >
                {conv.type}
              </Badge>
            )}
            <button
              className="hover:text-destructive ml-0.5"
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
