'use client';

import { useState, useCallback } from 'react';
import { useAppStore } from '@/stores/appStore';
import { Button } from '@/components/ui/button';
import { Check, X, Loader2, ArrowRight } from 'lucide-react';
import { answerSprintPhaseProposal } from '@/lib/api/conversations';
import { getSprintPhaseOption } from '@/lib/session-fields';
import { cn } from '@/lib/utils';
import { useToast } from '@/components/ui/toast';

interface SprintPhaseProposalPromptProps {
  conversationId: string;
}

export function SprintPhaseProposalPrompt({ conversationId }: SprintPhaseProposalPromptProps) {
  const proposal = useAppStore((s) => s.pendingSprintPhaseProposal[conversationId]);
  const clearProposal = useAppStore((s) => s.setPendingSprintPhaseProposal);
  const { error: showError } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleRespond = useCallback(async (approved: boolean) => {
    if (!proposal || isSubmitting) return;
    setIsSubmitting(true);
    try {
      await answerSprintPhaseProposal(conversationId, proposal.requestId, approved);
      clearProposal(conversationId, null);
    } catch (error) {
      console.error('Failed to respond to sprint phase proposal:', error);
      showError('Failed to respond to sprint phase proposal');
    } finally {
      setIsSubmitting(false);
    }
  }, [conversationId, proposal, isSubmitting, clearProposal, showError]);

  if (!proposal) return null;

  const phaseOpt = getSprintPhaseOption(proposal.phase);
  const PhaseIcon = phaseOpt.icon;

  return (
    <div className="pt-1 px-3 pb-3">
      <div className="rounded-lg border border-border bg-card p-4 animate-in fade-in slide-in-from-bottom-2 duration-200">
        <div className="flex items-start gap-3">
          <div className={cn(
            'flex items-center justify-center h-9 w-9 rounded-lg shrink-0',
            phaseOpt.activeClass,
          )}>
            <PhaseIcon className="h-4.5 w-4.5" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">Advance to</span>
              <span className={cn('text-sm font-semibold', phaseOpt.color)}>{phaseOpt.label}</span>
              <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">{phaseOpt.description}</span>
            </div>
            {proposal.reason && (
              <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{proposal.reason}</p>
            )}
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 mt-3">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs gap-1"
            onClick={() => handleRespond(false)}
            disabled={isSubmitting}
          >
            <X className="h-3.5 w-3.5" />
            Reject
          </Button>
          <Button
            variant="default"
            size="sm"
            className="h-7 text-xs gap-1"
            onClick={() => handleRespond(true)}
            disabled={isSubmitting}
          >
            {isSubmitting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Check className="h-3.5 w-3.5" />
            )}
            Accept
          </Button>
        </div>
      </div>
    </div>
  );
}
