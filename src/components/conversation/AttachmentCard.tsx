'use client';

import { useState, useMemo } from 'react';
import { X, File, FileText, FileCode, Image, FileJson, Terminal, FileType, type LucideIcon } from 'lucide-react';
import type { Attachment } from '@/lib/types';
import { getFileCategory, getAttachmentSubtitle } from '@/lib/attachments';
import { cn } from '@/lib/utils';

interface AttachmentCardProps {
  attachment: Attachment;
  onRemove?: () => void;
  onClick?: () => void;
  readOnly?: boolean;
}

// Map file category to icon component
const CATEGORY_ICONS: Record<string, LucideIcon> = {
  image: Image,
  code: FileCode,
  config: FileJson,
  shell: Terminal,
  text: FileText,
  markup: FileText,
  data: FileText,
  documents: File,
  unknown: FileType,
};

/**
 * Attachment card component for displaying file attachments in the compose area
 */
export function AttachmentCard({ attachment, onRemove, onClick, readOnly = false }: AttachmentCardProps) {
  const [isHovered, setIsHovered] = useState(false);

  // Determine file path for category detection - use path if available, otherwise fall back to name
  const filePath = attachment.path || attachment.name;
  const category = useMemo(() => getFileCategory(filePath), [filePath]);
  const Icon = CATEGORY_ICONS[category] || FileType;
  const subtitle = getAttachmentSubtitle(attachment);

  // CSS truncate on the span handles ellipsis; full name shown via title tooltip
  const displayName = attachment.name;

  return (
    <div
      className={cn(
        'group relative flex items-center gap-2 rounded-md border border-border bg-muted/50 px-2.5 py-1.5',
        'hover:bg-muted/80 transition-colors',
        'min-w-0 max-w-[220px]',
        onClick && 'cursor-pointer'
      )}
      onClick={onClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Icon */}
      <div className="flex-shrink-0 text-muted-foreground">
        <Icon className="h-4 w-4" />
      </div>

      {/* Content */}
      <div className="flex flex-col min-w-0 flex-1">
        <span className="text-xs font-medium text-foreground truncate" title={attachment.name}>
          {displayName}
        </span>
        <span className="text-2xs text-muted-foreground truncate">
          {subtitle}
        </span>
      </div>

      {/* Remove button */}
      {!readOnly && onRemove && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className={cn(
            'absolute -top-1.5 -right-1.5 p-0.5 rounded-full',
            'bg-muted border border-border',
            'text-muted-foreground hover:text-foreground hover:bg-surface-2',
            'transition-opacity',
            isHovered ? 'opacity-100' : 'opacity-0'
          )}
          title="Remove attachment"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}
