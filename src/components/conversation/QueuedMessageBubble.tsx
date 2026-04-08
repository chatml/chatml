'use client';

import { useState, useMemo } from 'react';
import { Clock, X } from 'lucide-react';
import { AttachmentGrid } from '@/components/conversation/AttachmentGrid';
import { AttachmentPreviewModal } from '@/components/conversation/AttachmentPreviewModal';
import { MentionText } from '@/components/conversation/MentionText';
import type { QueuedMessage } from '@/stores/appStore';

interface QueuedMessageBubbleProps {
  messages: readonly QueuedMessage[];
  onDelete: (messageId: string) => void;
}

/** Shared attachment grid, preview modal, and message text. */
function MessageBody({ message }: { message: QueuedMessage }) {
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);

  return (
    <>
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
    </>
  );
}

/** Sent message — rendered as a regular user bubble (full opacity, no delete). */
function SentMessageItem({ message }: { message: QueuedMessage }) {
  return (
    <div className="flex justify-end">
      <div className="bg-surface-2 dark:bg-[#2D1B4E] rounded-lg px-4 py-2.5 relative max-w-[85%]">
        <MessageBody message={message} />
      </div>
    </div>
  );
}

/** Unsent queued message — reduced opacity with delete button. */
function QueuedMessageItem({ message, index, total, onDelete }: {
  message: QueuedMessage;
  index: number;
  total: number;
  onDelete: () => void;
}) {
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

        <MessageBody message={message} />
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
  const [sentMessages, unsentMessages] = useMemo(() => {
    const sent: QueuedMessage[] = [];
    const unsent: QueuedMessage[] = [];
    for (const m of messages) (m.sent ? sent : unsent).push(m);
    return [sent, unsent] as const;
  }, [messages]);

  if (messages.length === 0) return null;

  return (
    <div className="space-y-2 py-2">
      {/* Sent messages — render as regular user bubbles */}
      {sentMessages.map((message) => (
        <SentMessageItem key={message.id} message={message} />
      ))}

      {/* Unsent messages — render with "Queued" header */}
      {unsentMessages.length > 0 && (
        <>
          <div className="flex justify-end">
            <div className="flex items-center gap-1 text-xs text-muted-foreground px-1">
              <Clock className="h-3 w-3" />
              <span>
                {unsentMessages.length === 1
                  ? 'Queued — will be sent after current response'
                  : `${unsentMessages.length} messages queued — will be sent in order`}
              </span>
            </div>
          </div>
          {unsentMessages.map((message, i) => (
            <QueuedMessageItem
              key={message.id}
              message={message}
              index={i + 1}
              total={unsentMessages.length}
              onDelete={() => onDelete(message.id)}
            />
          ))}
        </>
      )}
    </div>
  );
}
