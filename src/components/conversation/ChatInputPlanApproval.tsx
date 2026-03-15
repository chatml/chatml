import { Button } from '@/components/ui/button';
import { Check, Copy, MessageSquarePlus } from 'lucide-react';

interface ChatInputPlanApprovalProps {
  copied: boolean;
  hasPlanContent: boolean;
  approvalError: string | null;
  onCopyPlan: () => void;
  onHandOff: () => void;
  onApprovePlan: () => void;
}

export function ChatInputPlanApproval({
  copied,
  hasPlanContent,
  approvalError,
  onCopyPlan,
  onHandOff,
  onApprovePlan,
}: ChatInputPlanApprovalProps) {
  return (
    <div className="space-y-1.5 mb-2">
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">
          Approve plan or type what to change <kbd className="px-1 py-0.5 rounded bg-muted text-xs font-mono">↵</kbd>
        </span>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 text-xs text-muted-foreground"
            onClick={onCopyPlan}
            disabled={!hasPlanContent}
          >
            {copied ? (
              <Check className="h-3.5 w-3.5 text-green-500" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
            {copied ? 'Copied' : 'Copy'}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 text-xs text-muted-foreground"
            onClick={onHandOff}
            disabled={!hasPlanContent}
          >
            <MessageSquarePlus className="h-3.5 w-3.5" />
            Hand off
          </Button>

          <Button
            variant="secondary"
            size="sm"
            className="h-7 gap-1.5 text-xs font-semibold bg-foreground text-background hover:bg-foreground/80 transition-colors dark:bg-foreground dark:text-background dark:hover:bg-foreground/80"
            onClick={onApprovePlan}
          >
            Approve Plan
            <kbd className="px-1 py-0.5 rounded bg-background/20 text-background text-2xs font-mono">⌘⇧↵</kbd>
          </Button>
        </div>
      </div>
      {approvalError && (
        <div className="text-xs text-destructive">{approvalError}</div>
      )}
    </div>
  );
}
