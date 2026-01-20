'use client';

import { useState } from 'react';
import { useAppStore } from '@/stores/appStore';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { History, RotateCcw, Loader2 } from 'lucide-react';

// API base URL - configurable via environment variable
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:9876';

export function CheckpointTimeline() {
  const { checkpoints, selectedConversationId } = useAppStore();
  const [rewindingUuid, setRewindingUuid] = useState<string | null>(null);

  const handleRewind = async (uuid: string) => {
    if (!selectedConversationId || rewindingUuid) return;

    setRewindingUuid(uuid);
    try {
      const response = await fetch(`${API_BASE_URL}/api/conversations/${selectedConversationId}/rewind`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ checkpointUuid: uuid }),
      });

      if (!response.ok) {
        const error = await response.text();
        console.error('Failed to rewind:', error);
      }
    } catch (err) {
      console.error('Failed to rewind:', err);
    } finally {
      setRewindingUuid(null);
    }
  };

  if (checkpoints.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground text-sm p-4">
        <History className="w-8 h-8 mb-2 opacity-50" />
        <p>No checkpoints yet</p>
        <p className="text-xs mt-1">Checkpoints are created at message boundaries</p>
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="p-2 space-y-1">
        <div className="text-xs font-medium text-muted-foreground px-2 mb-2">
          File Checkpoints ({checkpoints.length})
        </div>
        {checkpoints.map((checkpoint) => (
          <div
            key={checkpoint.uuid}
            className="flex items-center justify-between p-2 rounded-md hover:bg-muted/50 group"
          >
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-2 h-2 rounded-full bg-blue-500 shrink-0" />
              <div className="min-w-0">
                <div className="text-xs font-medium truncate">
                  {checkpoint.isResult ? 'After response' : 'Before message'} #{checkpoint.messageIndex}
                </div>
                <div className="text-xs text-muted-foreground">
                  {new Date(checkpoint.timestamp).toLocaleTimeString()}
                </div>
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
              onClick={() => handleRewind(checkpoint.uuid)}
              disabled={rewindingUuid !== null}
              title="Rewind to this checkpoint"
            >
              {rewindingUuid === checkpoint.uuid ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <RotateCcw className="w-3 h-3" />
              )}
            </Button>
          </div>
        ))}
      </div>
    </ScrollArea>
  );
}
