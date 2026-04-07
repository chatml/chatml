'use client';

import { useState, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Loader2, ArrowRight } from 'lucide-react';
import { useAppStore } from '@/stores/appStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { generateSummary, createConversation, toStoreMessage } from '@/lib/api';

interface SessionHandoffDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversationId: string;
  workspaceId: string;
  sessionId: string;
}

export function SessionHandoffDialog({
  open,
  onOpenChange,
  conversationId,
  workspaceId,
  sessionId,
}: SessionHandoffDialogProps) {
  const [status, setStatus] = useState<'idle' | 'generating' | 'creating' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  const addConversation = useAppStore((s) => s.addConversation);
  const selectConversation = useAppStore((s) => s.selectConversation);
  const setSummary = useAppStore((s) => s.setSummary);

  const handleContinue = useCallback(async () => {
    setStatus('generating');
    setErrorMsg('');

    try {
      // Step 1: Generate summary of the current conversation
      const summary = await generateSummary(conversationId);
      setSummary(conversationId, summary);

      // Step 2: Create a new conversation with the summary linked
      setStatus('creating');
      const defaultBackend = useSettingsStore.getState().defaultBackend;
      const newConv = await createConversation(workspaceId, sessionId, {
        type: 'task',
        summaryIds: [summary.conversationId],
        backend: defaultBackend !== 'agent-runner' ? defaultBackend : undefined,
      });

      // Step 3: Add to store and navigate
      addConversation({
        id: newConv.id,
        sessionId: newConv.sessionId,
        type: newConv.type,
        name: newConv.name,
        status: newConv.status,
        messages: newConv.messages.map((m) => ({
          id: m.id,
          conversationId: newConv.id,
          role: m.role as 'user' | 'assistant' | 'system',
          content: m.content,
          setupInfo: m.setupInfo,
          runSummary: m.runSummary,
          timestamp: m.timestamp,
        })),
        toolSummary: newConv.toolSummary.map((t) => ({
          id: t.id,
          tool: t.tool,
          target: t.target,
          success: t.success,
        })),
        createdAt: newConv.createdAt,
        updatedAt: newConv.updatedAt,
      });

      selectConversation(newConv.id);
      onOpenChange(false);
      setStatus('idle');
    } catch (err) {
      console.error('Session handoff failed:', err);
      setErrorMsg(err instanceof Error ? err.message : 'Failed to continue in new conversation');
      setStatus('error');
    }
  }, [conversationId, workspaceId, sessionId, addConversation, selectConversation, setSummary, onOpenChange]);

  const isLoading = status === 'generating' || status === 'creating';

  return (
    <Dialog open={open} onOpenChange={isLoading ? undefined : onOpenChange}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>Continue in New Conversation</DialogTitle>
        </DialogHeader>
        <div className="text-sm text-muted-foreground space-y-2">
          <p>
            The context window is nearly full. A summary of this conversation will be generated
            and carried over to a new conversation so you can continue seamlessly.
          </p>
          {status === 'generating' && (
            <div className="flex items-center gap-2 text-xs">
              <Loader2 className="w-3 h-3 animate-spin" />
              Generating summary...
            </div>
          )}
          {status === 'creating' && (
            <div className="flex items-center gap-2 text-xs">
              <Loader2 className="w-3 h-3 animate-spin" />
              Creating new conversation...
            </div>
          )}
          {status === 'error' && (
            <p className="text-xs text-destructive">{errorMsg}</p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isLoading}>
            Cancel
          </Button>
          <Button onClick={handleContinue} disabled={isLoading}>
            {isLoading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <>
                <ArrowRight className="w-4 h-4" />
                Continue
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
