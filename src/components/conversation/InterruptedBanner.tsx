'use client';

import { useCallback, useState } from 'react';
import { Button } from '@/components/ui/button';
import { AlertTriangle, Loader2, Play, X } from 'lucide-react';
import { useAppStore } from '@/stores/appStore';
import { resumeAgent, clearConversationSnapshot } from '@/lib/api';

interface InterruptedBannerProps {
  conversationId: string;
}

export function InterruptedBanner({ conversationId }: InterruptedBannerProps) {
  const interrupted = useAppStore((s) => s.interruptedState[conversationId]);
  const [dismissing, setDismissing] = useState(false);

  const handleResume = useCallback(async () => {
    const store = useAppStore.getState();
    store.setInterruptedResuming(conversationId, true);
    try {
      await resumeAgent(conversationId);
      // Agent will start and emit 'init' event via WebSocket,
      // which clears interruptedState automatically.
    } catch (err) {
      console.error('Failed to resume agent:', err);
      store.setInterruptedResuming(conversationId, false);
    }
  }, [conversationId]);

  const handleDismiss = useCallback(async () => {
    setDismissing(true);
    try {
      await clearConversationSnapshot(conversationId);
    } catch {
      // Best-effort cleanup
    }
    useAppStore.getState().clearInterruptedState(conversationId);
  }, [conversationId]);

  if (!interrupted) return null;

  const resuming = interrupted.resuming;

  return (
    <div className="bg-amber-500/10 border-b border-amber-500/20 px-3 py-2">
      <div className="flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
        <div className="flex-1 text-sm">
          <span>This conversation was interrupted when the app closed.</span>
          {interrupted.hadPendingPlan && (
            <span className="text-muted-foreground"> A plan was waiting for your approval.</span>
          )}
          {interrupted.hadPendingQuestion && (
            <span className="text-muted-foreground"> The AI was waiting for your answer.</span>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleResume}
          disabled={resuming || dismissing}
          className="shrink-0 gap-1.5"
        >
          {resuming ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Play className="h-3.5 w-3.5" />
          )}
          {resuming ? 'Resuming...' : 'Resume'}
        </Button>
        <button
          onClick={handleDismiss}
          disabled={resuming || dismissing}
          className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
          title="Dismiss"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
