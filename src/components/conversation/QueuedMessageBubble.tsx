'use client';

import { useState } from 'react';
import { Clock, X } from 'lucide-react';
import { AttachmentGrid } from '@/components/conversation/AttachmentGrid';
import { AttachmentPreviewModal } from '@/components/conversation/AttachmentPreviewModal';
import { MentionText } from '@/components/conversation/MentionText';
import type { QueuedMessage } from '@/stores/appStore';

interface QueuedMessageBubbleProps {
  messages: readonly QueuedMessage[];
  onDelete: (messageId: string) => void;
}

function QueuedMessageItem({ message, index, total, onDelete }: {
  message: QueuedMessage;
  index: number;
  total: number;
  onDelete: () => void;
}) {
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);

  return (
    <div className="flex justify-end group">
      <div className="bg-surface-2 dark:bg-[#2D1B4E] rounded-lg px-4 py-2.5 opacity-70 relative max-w-[85%]">
        {/* Delete button - appears on hover */}
        <button
          onClick={onDelete}
          className="absolute -left-8 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
          aria-label="Remove queued message"
        >
          <X className="h-4 w-4" />
        </button>

        {message.attachments && message.attachments.length > 0 && (
          <>
            <AttachmentGrid
              attachments={message.attachments}
              onPreview={(i) => setPreviewIndex(i)}
              readOnly
            />
            {previewIndex !== null && (
              <AttachmentPreviewModal
                open
                onOpenChange={(open) => { if (!open) setPreviewIndex(null); }}
                attachments={message.attachments}
                initialIndex={previewIndex}
              />
            )}
          </>
        )}
        <p className="text-base leading-relaxed whitespace-pre-wrap">
          <MentionText content={message.content} />
        </p>
        {total > 1 && (
          <div className="flex items-center gap-1 mt-1 text-xs text-muted-foreground">
            <span>#{index}</span>
          </div>
        )}
      </div>
    </div>
  );
}

export function QueuedMessageBubble({ messages, onDelete }: QueuedMessageBubbleProps) {
  if (messages.length === 0) return null;

  return (
    <div className="space-y-2 py-2">
      <div className="flex justify-end">
        <div className="flex items-center gap-1 text-xs text-muted-foreground px-1">
          <Clock className="h-3 w-3" />
          <span>
            {messages.length === 1
              ? 'Queued — will be sent after current response'
              : `${messages.length} messages queued — will be sent in order`}
          </span>
        </div>
      </div>
      {messages.map((message, i) => (
        <QueuedMessageItem
          key={message.id}
          message={message}
          index={i + 1}
          total={messages.length}
          onDelete={() => onDelete(message.id)}
        />
      ))}
    </div>
  );
}
