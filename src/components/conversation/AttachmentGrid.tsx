'use client';

import type { Attachment } from '@/lib/types';
import { AttachmentCard } from './AttachmentCard';

interface AttachmentGridProps {
  attachments: Attachment[];
  onRemove?: (id: string) => void;
  readOnly?: boolean;
}

/**
 * Grid layout for displaying multiple attachment cards
 */
export function AttachmentGrid({ attachments, onRemove, readOnly = false }: AttachmentGridProps) {
  if (attachments.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-wrap gap-2 p-2">
      {attachments.map((attachment) => (
        <AttachmentCard
          key={attachment.id}
          attachment={attachment}
          onRemove={onRemove ? () => onRemove(attachment.id) : undefined}
          readOnly={readOnly}
        />
      ))}
    </div>
  );
}
