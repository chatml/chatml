import { useState, useCallback, useEffect, useRef } from 'react';
import { listenForFileDrop, listenForDragEnter, listenForDragLeave, openFileDialog } from '@/lib/tauri';
import type { Attachment } from '@/lib/types';
import { processDroppedFiles, validateAttachments, SUPPORTED_EXTENSIONS, generateAttachmentId, ATTACHMENT_LIMITS } from '@/lib/attachments';

interface UseChatInputAttachmentsOptions {
  autoConvertLongText: boolean;
  showError: (msg: string) => void;
  showInfo: (msg: string) => void;
}

export function useChatInputAttachments({ autoConvertLongText, showError, showInfo }: UseChatInputAttachmentsOptions) {
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const attachmentsRef = useRef<Attachment[]>(attachments);
  useEffect(() => { attachmentsRef.current = attachments; });

  // Handle file drop processing
  const handleFileDrop = useCallback(async (paths: string[]) => {
    setIsDragOver(false);

    const result = await processDroppedFiles(paths);

    // Show errors
    if (result.errors.length > 0) {
      result.errors.forEach(err => showError(err));
    }

    if (result.attachments.length === 0) return;

    // Use functional updater to avoid stale closure over attachments
    let validationError: string | null = null;
    setAttachments(prev => {
      const newAttachments = [...prev, ...result.attachments];
      const validation = validateAttachments(newAttachments);
      if (!validation.valid) {
        validationError = validation.error || 'Invalid attachments';
        return prev;
      }
      return newAttachments;
    });
    if (validationError) showError(validationError);
  }, [showError]);

  // Shared helper: validate and add an image attachment with user feedback.
  const validationErrorRef = useRef<string | null>(null);
  const addImageAttachment = useCallback((attachment: Attachment) => {
    validationErrorRef.current = null;
    setAttachments(prev => {
      const newAttachments = [...prev, attachment];
      const validation = validateAttachments(newAttachments);
      if (!validation.valid) {
        validationErrorRef.current = validation.error || 'Invalid attachments';
        return prev;
      }
      return newAttachments;
    });
    if (validationErrorRef.current) {
      showError(validationErrorRef.current);
    } else {
      showInfo('Image pasted as attachment');
    }
  }, [showError, showInfo]);

  // Handle pasted images and auto-convert long pasted text to attachment
  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    // Check for pasted images
    const items = Array.from(e.clipboardData.items);
    const imageItem = items.find(item => item.type.startsWith('image/'));
    if (imageItem) {
      e.preventDefault();
      e.stopPropagation();

      const file = imageItem.getAsFile();
      if (!file) return;

      if (file.size > ATTACHMENT_LIMITS.MAX_FILE_SIZE) {
        showError(`Pasted image exceeds ${Math.round(ATTACHMENT_LIMITS.MAX_FILE_SIZE / 1024 / 1024)}MB limit`);
        return;
      }

      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        const base64 = dataUrl.split(',')[1];
        const mimeType = file.type || 'image/png';
        const ext = mimeType === 'image/jpeg' ? 'jpg' : mimeType.split('/')[1] || 'png';

        const img = new Image();
        img.onload = () => {
          addImageAttachment({
            id: generateAttachmentId(),
            type: 'image',
            name: `pasted-image.${ext}`,
            mimeType,
            size: file.size,
            width: img.naturalWidth,
            height: img.naturalHeight,
            base64Data: base64,
          });
        };
        img.onerror = () => {
          addImageAttachment({
            id: generateAttachmentId(),
            type: 'image',
            name: `pasted-image.${ext}`,
            mimeType,
            size: file.size,
            base64Data: base64,
          });
        };
        img.src = dataUrl;
      };
      reader.onerror = () => {
        showError('Failed to read pasted image');
      };
      reader.readAsDataURL(file);
      return;
    }

    // Auto-convert long pasted text to attachment
    if (!autoConvertLongText) return;
    const text = e.clipboardData.getData('text/plain');
    if (text.length <= 5000) return;

    e.preventDefault();
    e.stopPropagation();

    const blob = new Blob([text], { type: 'text/plain' });
    const attachment: Attachment = {
      id: generateAttachmentId(),
      type: 'file',
      name: 'pasted-text.txt',
      mimeType: 'text/plain',
      size: blob.size,
      lineCount: text.split('\n').length,
      base64Data: btoa(unescape(encodeURIComponent(text))),
      preview: text.slice(0, 200),
    };

    setAttachments(prev => [...prev, attachment]);
    showInfo(`Long text (${Math.round(text.length / 1000)}k chars) converted to attachment`);
  }, [autoConvertLongText, showInfo, showError, addImageAttachment]);

  // Listen for clipboard-paste-image events from the custom paste handler
  useEffect(() => {
    const handleClipboardImage = (e: Event) => {
      const { base64, width, height, mimeType, size } = (e as CustomEvent).detail;
      const resolvedMime = mimeType || 'image/png';
      const ext = resolvedMime === 'image/jpeg' ? 'jpg' : resolvedMime.split('/')[1] || 'png';
      addImageAttachment({
        id: generateAttachmentId(),
        type: 'image',
        name: `pasted-image.${ext}`,
        mimeType: resolvedMime,
        size: size || Math.round(base64.length * 0.75),
        width,
        height,
        base64Data: base64,
      });
    };

    window.addEventListener('clipboard-paste-image', handleClipboardImage);
    return () => window.removeEventListener('clipboard-paste-image', handleClipboardImage);
  }, [addImageAttachment]);

  // Handle attachment removal
  const handleRemoveAttachment = useCallback((id: string) => {
    setAttachments(prev => prev.filter(a => a.id !== id));
  }, []);

  // Handle file picker
  const handleOpenFilePicker = useCallback(async () => {
    const allExtensions = Object.values(SUPPORTED_EXTENSIONS).flat().map(ext => ext.slice(1));
    const paths = await openFileDialog({
      multiple: true,
      filters: [
        { name: 'Supported Files', extensions: allExtensions },
      ],
      title: 'Select files to attach',
    });
    if (paths && paths.length > 0) {
      await handleFileDrop(paths);
    }
  }, [handleFileDrop]);

  // Use a ref for the handler so the Tauri listener is registered once
  const handleFileDropRef = useRef(handleFileDrop);
  useEffect(() => { handleFileDropRef.current = handleFileDrop; }, [handleFileDrop]);

  // Listen for drag-drop events from Tauri
  useEffect(() => {
    let isCancelled = false;
    let unlistenDrop: (() => void) | undefined;
    let unlistenEnter: (() => void) | undefined;
    let unlistenLeave: (() => void) | undefined;

    const safeUnlisten = (fn?: () => void): undefined => {
      try { fn?.(); } catch { /* listener already removed */ }
      return undefined;
    };

    const setupListeners = async () => {
      try {
        const [drop, enter, leave] = await Promise.all([
          listenForFileDrop((paths) => {
            handleFileDropRef.current(paths);
          }),
          listenForDragEnter(() => {
            setIsDragOver(true);
          }),
          listenForDragLeave(() => {
            setIsDragOver(false);
          }),
        ]);

        if (isCancelled) {
          safeUnlisten(drop);
          safeUnlisten(enter);
          safeUnlisten(leave);
          return;
        }

        unlistenDrop = drop;
        unlistenEnter = enter;
        unlistenLeave = leave;
      } catch (error) {
        console.error('Failed to setup drag-drop listeners:', error);
        unlistenDrop = safeUnlisten(unlistenDrop);
        unlistenEnter = safeUnlisten(unlistenEnter);
        unlistenLeave = safeUnlisten(unlistenLeave);
      }
    };

    setupListeners();

    return () => {
      isCancelled = true;
      unlistenDrop = safeUnlisten(unlistenDrop);
      unlistenEnter = safeUnlisten(unlistenEnter);
      unlistenLeave = safeUnlisten(unlistenLeave);
    };
  }, []);

  return {
    attachments,
    setAttachments,
    attachmentsRef,
    isDragOver,
    previewIndex,
    setPreviewIndex,
    handlePaste,
    handleRemoveAttachment,
    handleOpenFilePicker,
  };
}
