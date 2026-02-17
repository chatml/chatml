'use client';

import { Users } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { useAppStore } from '@/stores/appStore';
import type { Conversation } from '@/lib/types';

interface TeammateHeaderProps {
  conversation: Conversation;
}

export function TeammateHeader({ conversation }: TeammateHeaderProps) {
  const selectConversation = useAppStore(s => s.selectConversation);
  const conversations = useAppStore(s => s.conversations);
  const parentConv = conversations.find(c => c.id === conversation.parentConversationId);

  return (
    <div className="flex items-center gap-2 px-4 py-2 border-b bg-muted/30">
      <Users size={16} className="text-muted-foreground" />
      <span className="font-medium text-sm">{conversation.name}</span>
      <Badge variant={conversation.status === 'active' ? 'default' : 'secondary'}>
        {conversation.status}
      </Badge>
      {parentConv && (
        <button
          onClick={() => selectConversation(parentConv.id)}
          className="text-xs text-muted-foreground hover:underline ml-auto"
        >
          &larr; Back to lead
        </button>
      )}
    </div>
  );
}
