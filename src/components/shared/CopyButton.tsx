'use client';

import { memo, useState, useRef, useCallback } from 'react';
import { Copy, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { copyToClipboard } from '@/lib/tauri';
import { useToast } from '@/components/ui/toast';
import { COPY_FEEDBACK_DURATION_MS } from '@/lib/constants';

interface CopyButtonProps {
  getText: () => string;
}

/**
 * Self-contained copy button that manages its own copied/idle state.
 * Isolates the transient `copied` flash from parent callback identity,
 * preventing unnecessary re-renders in Pierre's renderHeaderMetadata.
 */
export const CopyButton = memo(function CopyButton({ getText }: CopyButtonProps) {
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleCopy = useCallback(async () => {
    const success = await copyToClipboard(getText());
    if (success) {
      setCopied(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        setCopied(false);
        timerRef.current = null;
      }, COPY_FEEDBACK_DURATION_MS);
    } else {
      toast.error('Failed to copy to clipboard');
    }
  }, [getText, toast]);

  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-5 w-5 text-muted-foreground"
      onClick={handleCopy}
    >
      {copied ? (
        <Check className="w-2.5 h-2.5 text-text-success" />
      ) : (
        <Copy className="w-2.5 h-2.5" />
      )}
    </Button>
  );
});
