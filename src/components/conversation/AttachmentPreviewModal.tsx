'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogClose,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { CodeViewer } from '@/components/files/CodeViewer';
import { BlockErrorFallback } from '@/components/shared/ErrorFallbacks';
import {
  getFileCategory,
  getAttachmentSubtitle,
  loadAttachmentContent,
} from '@/lib/attachments';
import { fetchAttachmentData } from '@/lib/api';
import type { Attachment } from '@/lib/types';
import {
  XIcon,
  ChevronLeft,
  ChevronRight,
  Loader2,
  AlertTriangle,
  File,
  FileText,
  FileCode,
  Image,
  FileJson,
  Terminal,
  FileType,
  type LucideIcon,
} from 'lucide-react';

// ============================================================================
// Types
// ============================================================================

interface AttachmentPreviewModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  attachments: Attachment[];
  initialIndex: number;
  /** When true, load attachment content from the DB API instead of from the original file path on disk. */
  fromHistory?: boolean;
}

// ============================================================================
// Constants
// ============================================================================

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

// ============================================================================
// Helpers
// ============================================================================

function decodeBase64ToString(base64: string): string {
  return new TextDecoder().decode(
    Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)),
  );
}

// ============================================================================
// Sub-renderers
// ============================================================================

function ImagePreview({
  base64,
  mimeType,
  name,
}: {
  base64: string;
  mimeType: string;
  name: string;
}) {
  return (
    <div className="h-full flex items-center justify-center p-4 overflow-auto">
      {/* eslint-disable-next-line @next/next/no-img-element -- data URL, not a remote image */}
      <img
        src={`data:${mimeType};base64,${base64}`}
        alt={name}
        className="max-w-full max-h-full object-contain rounded"
        draggable={false}
      />
    </div>
  );
}

function PdfPreview({ base64 }: { base64: string }) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);

  useEffect(() => {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const blob = new Blob([bytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBlobUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [base64]);

  if (!blobUrl) return null;

  return (
    <iframe
      src={blobUrl}
      className="w-full h-full border-0 rounded"
      title="PDF Preview"
    />
  );
}

// ============================================================================
// Main component
// ============================================================================

type AsyncLoadState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'loaded'; content: string }
  | { status: 'error'; message: string };

type ResolvedContent =
  | { status: 'loaded'; content: string }
  | { status: 'loading' }
  | { status: 'error'; message: string };

export function AttachmentPreviewModal({
  open,
  onOpenChange,
  attachments,
  initialIndex,
  fromHistory = false,
}: AttachmentPreviewModalProps) {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [asyncState, setAsyncState] = useState<AsyncLoadState>({ status: 'idle' });

  // Sync index when modal re-opens with a different initialIndex
  const [prevOpen, setPrevOpen] = useState(open);
  if (open && !prevOpen) {
    setCurrentIndex(initialIndex);
  }
  if (prevOpen !== open) {
    setPrevOpen(open);
  }

  const attachment = attachments[currentIndex];
  const filePath = attachment?.path || attachment?.name || '';
  const category = attachment ? getFileCategory(filePath) : 'unknown';
  const Icon = CATEGORY_ICONS[category] || FileType;

  const isBinaryPreview = category === 'image' || category === 'documents';

  // Synchronously resolve content when base64Data is already available or path is missing
  const syncContent = useMemo<ResolvedContent | null>(() => {
    if (!open || !attachment) return null;

    // Already have inline data (e.g., pasted text)
    if (attachment.base64Data) {
      if (isBinaryPreview) {
        return { status: 'loaded', content: attachment.base64Data };
      }
      try {
        return { status: 'loaded', content: decodeBase64ToString(attachment.base64Data) };
      } catch {
        return { status: 'error', message: 'Failed to decode file content' };
      }
    }

    // No path and no inline data — can't load from disk
    if (!attachment.path && !fromHistory) {
      return { status: 'error', message: 'No file path available' };
    }

    return null; // needs async load (from disk or DB)
  }, [open, attachment, isBinaryPreview, fromHistory]);

  // Whether we need to load asynchronously (from disk or DB)
  const needsAsyncLoad = open && attachment && !syncContent && (fromHistory || !!attachment.path);
  const attachmentPath = attachment?.path;
  const attachmentId = attachment?.id;

  // Reset async state when switching attachments
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAsyncState({ status: 'idle' });
  }, [currentIndex]);

  // Async load: from DB API (history) or from disk (compose)
  useEffect(() => {
    if (!needsAsyncLoad) return;
    if (!fromHistory && !attachmentPath) return;

    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAsyncState({ status: 'loading' });

    const loadPromise = fromHistory
      ? attachmentId
        ? fetchAttachmentData(attachmentId).then((base64) => ({ base64Data: base64 }))
        : Promise.reject(new Error('Attachment ID missing for history load'))
      : loadAttachmentContent(attachment!).then((loaded) => ({ base64Data: loaded.base64Data }));

    loadPromise
      .then(({ base64Data }) => {
        if (cancelled) return;
        if (!base64Data) {
          setAsyncState({ status: 'error', message: 'Failed to read file content' });
          return;
        }
        if (isBinaryPreview) {
          setAsyncState({ status: 'loaded', content: base64Data });
        } else {
          try {
            setAsyncState({ status: 'loaded', content: decodeBase64ToString(base64Data) });
          } catch {
            setAsyncState({ status: 'error', message: 'Failed to decode file content' });
          }
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setAsyncState({ status: 'error', message: err instanceof Error ? err.message : 'Failed to load file' });
      });

    return () => { cancelled = true; };
  }, [needsAsyncLoad, fromHistory, attachmentId, attachmentPath, isBinaryPreview]); // eslint-disable-line react-hooks/exhaustive-deps

  // Derive final state: prefer sync content, fall back to async
  const loadState: ResolvedContent = syncContent ?? (asyncState.status === 'idle' ? { status: 'loading' } : asyncState);

  // Keyboard navigation
  const goToPrev = useCallback(() => {
    setCurrentIndex((i) => Math.max(0, i - 1));
  }, []);

  const goToNext = useCallback(() => {
    setCurrentIndex((i) => Math.min(attachments.length - 1, i + 1));
  }, [attachments.length]);

  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        goToPrev();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        goToNext();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, goToPrev, goToNext]);

  // Render content based on file type
  function renderContent() {
    if (loadState.status === 'loading') {
      return (
        <div className="h-full flex items-center justify-center">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin" />
            <span className="text-sm">Loading preview...</span>
          </div>
        </div>
      );
    }

    if (loadState.status === 'error') {
      return (
        <div className="h-full flex items-center justify-center">
          <BlockErrorFallback
            icon={AlertTriangle}
            title="Failed to load preview"
            description={loadState.message}
          />
        </div>
      );
    }

    if (!attachment) return null;

    const { content } = loadState;

    switch (category) {
      case 'image':
        return (
          <ImagePreview
            base64={content}
            mimeType={attachment.mimeType}
            name={attachment.name}
          />
        );

      case 'documents':
        return <PdfPreview base64={content} />;

      // All text-based categories use CodeViewer
      // (markdown auto-detected by CodeViewer and shown rendered)
      case 'text':
      case 'code':
      case 'config':
      case 'shell':
      case 'markup':
      case 'data':
      default:
        return <CodeViewer content={content} filename={attachment.name} defaultWordWrap />;
    }
  }

  if (!attachment) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="sm:max-w-[90vw] max-h-[85vh] h-[85vh] p-0 gap-0 flex flex-col"
      >
        <DialogTitle className="sr-only">{attachment.name}</DialogTitle>
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
            <span className="text-sm font-medium truncate">
              {attachment.name}
            </span>
            <span className="text-xs text-muted-foreground shrink-0">
              {getAttachmentSubtitle(attachment)}
            </span>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {/* Navigation */}
            {attachments.length > 1 && (
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={goToPrev}
                  disabled={currentIndex === 0}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {currentIndex + 1} / {attachments.length}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={goToNext}
                  disabled={currentIndex === attachments.length - 1}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            )}

            {/* Close */}
            <DialogClose asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7">
                <XIcon className="h-4 w-4" />
              </Button>
            </DialogClose>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 min-h-0 overflow-hidden">
          {renderContent()}
        </div>
      </DialogContent>
    </Dialog>
  );
}
