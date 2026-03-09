'use client';

import { useState, useEffect } from 'react';
import { ScrollText, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { listSessionSummaries, type SummaryDTO } from '@/lib/api';

interface SummaryPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  sessionId: string;
  selectedIds: string[];
  onSelectionChange: (ids: string[]) => void;
}

export function SummaryPicker({
  open,
  onOpenChange,
  workspaceId,
  sessionId,
  selectedIds,
  onSelectionChange,
}: SummaryPickerProps) {
  const [summaries, setSummaries] = useState<SummaryDTO[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    listSessionSummaries(workspaceId, sessionId)
      .then((data) => { if (!cancelled) setSummaries(data); })
      .catch(console.error)
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, workspaceId, sessionId]);

  const toggleSummary = (id: string) => {
    if (selectedIds.includes(id)) {
      onSelectionChange(selectedIds.filter((s) => s !== id));
    } else {
      onSelectionChange([...selectedIds, id]);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[450px]">
        <DialogHeader>
          <DialogTitle>Attach Context from Previous Conversations</DialogTitle>
        </DialogHeader>
        <div className="max-h-[300px] overflow-y-auto space-y-2">
          {loading ? (
            <div className="text-sm text-muted-foreground text-center py-8">Loading summaries...</div>
          ) : summaries.length === 0 ? (
            <div className="text-sm text-muted-foreground text-center py-8">
              No summaries available. Generate summaries from conversation tabs first.
            </div>
          ) : (
            summaries.map((summary) => {
              const isSelected = selectedIds.includes(summary.id);
              return (
                <button
                  key={summary.id}
                  type="button"
                  onClick={() => toggleSummary(summary.id)}
                  className={cn(
                    'w-full text-left p-3 rounded-lg border transition-colors',
                    isSelected
                      ? 'border-brand bg-brand/5'
                      : 'border-border hover:border-brand/50 hover:bg-muted/50'
                  )}
                >
                  <div className="flex items-start gap-2">
                    <div className={cn(
                      'mt-0.5 size-4 rounded border flex items-center justify-center shrink-0',
                      isSelected ? 'bg-primary border-primary' : 'border-muted-foreground/30'
                    )}>
                      {isSelected && <Check className="size-3 text-primary-foreground" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <ScrollText className="size-3.5 text-muted-foreground shrink-0" />
                        <span className="text-sm font-medium truncate">
                          {summary.conversationName || summary.conversationId}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                        {summary.content.length > 150 ? summary.content.slice(0, 150) + '...' : summary.content}
                      </p>
                      <span className="text-xs text-muted-foreground mt-1 block">
                        {summary.messageCount} messages
                      </span>
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => onOpenChange(false)}>
            {selectedIds.length > 0 ? `Attach ${selectedIds.length} ${selectedIds.length === 1 ? 'summary' : 'summaries'}` : 'Done'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
