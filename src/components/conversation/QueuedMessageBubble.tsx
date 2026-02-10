'use client';

import { Clock } from 'lucide-react';
import { AttachmentGrid } from '@/components/conversation/AttachmentGrid';
import { MentionText } from '@/components/conversation/MentionText';
import type { QueuedMessage } from '@/stores/appStore';

interface QueuedMessageBubbleProps {
  message: QueuedMessage;
}

export function QueuedMessageBubble({ message }: QueuedMessageBubbleProps) {
  return (
    <div className="py-2 flex justify-end">
      <div className="bg-surface-2 dark:bg-[#090909] rounded-lg px-4 py-2.5 opacity-70">
        {message.attachments && message.attachments.length > 0 && (
          <AttachmentGrid attachments={message.attachments} readOnly />
        )}
        <p className="text-base leading-relaxed whitespace-pre-wrap">
          <MentionText content={message.content} />
        </p>
        <div className="flex items-center gap-1 mt-1.5 text-xs text-muted-foreground">
          <Clock className="h-3 w-3" />
          <span>Queued — will be sent after current response</span>
        </div>
      </div>
    </div>
  );
}
