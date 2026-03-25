'use client';

import { useState, useCallback } from 'react';
import { useAppStore } from '@/stores/appStore';
import { answerQAHandoff } from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import { Button } from '@/components/ui/button';
import { ExternalLink, Loader2 } from 'lucide-react';
import { open } from '@tauri-apps/plugin-shell';

interface QAHandoffPromptProps {
  conversationId: string;
}

export function QAHandoffPrompt({ conversationId }: QAHandoffPromptProps) {
  const handoff = useAppStore((s) => s.pendingQAHandoff[conversationId]);
  const setPendingQAHandoff = useAppStore((s) => s.setPendingQAHandoff);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [notes, setNotes] = useState('');
  const { error: showError } = useToast();

  const handleRespond = useCallback(async (completed: boolean) => {
    if (!handoff || isSubmitting) return;
    setIsSubmitting(true);
    try {
      await answerQAHandoff(conversationId, handoff.requestId, completed, notes || undefined);
      setPendingQAHandoff(conversationId, null);
    } catch {
      showError('Failed to respond to QA handoff');
    } finally {
      setIsSubmitting(false);
    }
  }, [conversationId, handoff, isSubmitting, notes, setPendingQAHandoff, showError]);

  const handleOpenUrl = useCallback(() => {
    if (!handoff?.url) return;
    try {
      open(handoff.url);
    } catch {
      window.open(handoff.url, '_blank');
    }
  }, [handoff?.url]);

  if (!handoff) return null;

  return (
    <div className="mx-4 mb-3 rounded-lg border border-teal-500/30 bg-teal-500/5 p-3 animate-in fade-in slide-in-from-bottom-2 duration-200">
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-teal-500 mb-1">Browser Action Required</p>
          <p className="text-sm text-foreground/80 mb-2">{handoff.instructions}</p>
          {handoff.testCase && (
            <p className="text-xs text-muted-foreground mb-2">Test context: {handoff.testCase}</p>
          )}
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs gap-1.5 mb-3"
            onClick={handleOpenUrl}
          >
            <ExternalLink className="h-3 w-3" />
            Open {handoff.url}
          </Button>
          <div className="mb-2">
            <textarea
              className="w-full h-14 text-xs bg-background border rounded-md px-2 py-1.5 resize-none placeholder:text-muted-foreground/50"
              placeholder="Optional notes (e.g., logged in as admin, 2FA completed)"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              className="h-7 text-xs"
              onClick={() => handleRespond(true)}
              disabled={isSubmitting}
            >
              {isSubmitting ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
              Done
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs text-muted-foreground"
              onClick={() => handleRespond(false)}
              disabled={isSubmitting}
            >
              Skip
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
