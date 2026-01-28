'use client';

import { useAppStore } from '@/stores/appStore';
import { ScrollArea } from '@/components/ui/scroll-area';
import { AlertCircle, DollarSign, RefreshCw, Brain, Gauge } from 'lucide-react';
import { cn } from '@/lib/utils';
import { EmptyState } from '@/components/ui/empty-state';

export function BudgetStatusPanel() {
  const { budgetStatus } = useAppStore();

  // Show empty state when no budget status at all
  if (!budgetStatus) {
    return (
      <div className="h-full flex items-center justify-center">
        <EmptyState
          icon={Gauge}
          title="No budget tracking"
          description="Budget limits can be configured when starting a session"
        />
      </div>
    );
  }

  const {
    maxBudgetUsd,
    currentCostUsd,
    maxTurns,
    currentTurns,
    maxThinkingTokens,
    currentThinkingTokens,
    limitExceeded,
  } = budgetStatus;

  // Check if any limits are configured
  const hasLimits = maxBudgetUsd !== undefined || maxTurns !== undefined || maxThinkingTokens !== undefined;

  const budgetPercent = maxBudgetUsd ? (currentCostUsd / maxBudgetUsd) * 100 : 0;
  const turnsPercent = maxTurns ? (currentTurns / maxTurns) * 100 : 0;
  const thinkingPercent = maxThinkingTokens ? (currentThinkingTokens / maxThinkingTokens) * 100 : 0;

  return (
    <ScrollArea className="h-full">
      <div className="p-3 space-y-3">
      {limitExceeded && (
        <div className="flex items-center gap-2 p-2 bg-destructive/10 text-destructive rounded-md text-xs">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>
            {limitExceeded === 'budget' && 'Budget limit exceeded'}
            {limitExceeded === 'turns' && 'Turn limit exceeded'}
            {limitExceeded === 'thinking_tokens' && 'Thinking token limit exceeded'}
          </span>
        </div>
      )}

      {/* Cost - show with or without limit */}
      <div className="space-y-1">
        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center gap-1 text-muted-foreground">
            <DollarSign className="w-3 h-3" />
            <span>Cost</span>
          </div>
          {maxBudgetUsd !== undefined ? (
            <span className={cn(budgetPercent >= 90 && 'text-destructive')}>
              ${currentCostUsd.toFixed(4)} / ${maxBudgetUsd.toFixed(2)}
            </span>
          ) : (
            <span>${currentCostUsd.toFixed(4)}</span>
          )}
        </div>
        {maxBudgetUsd !== undefined && (
          <div className="h-1 bg-muted rounded-full overflow-hidden">
            <div
              className={cn('h-full rounded-full', budgetPercent >= 90 ? 'bg-destructive' : 'bg-primary')}
              style={{ width: `${Math.min(budgetPercent, 100)}%` }}
            />
          </div>
        )}
      </div>

      {/* Turns - show with or without limit */}
      <div className="space-y-1">
        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center gap-1 text-muted-foreground">
            <RefreshCw className="w-3 h-3" />
            <span>Turns</span>
          </div>
          {maxTurns !== undefined ? (
            <span className={cn(turnsPercent >= 90 && 'text-destructive')}>
              {currentTurns} / {maxTurns}
            </span>
          ) : (
            <span>{currentTurns}</span>
          )}
        </div>
        {maxTurns !== undefined && (
          <div className="h-1 bg-muted rounded-full overflow-hidden">
            <div
              className={cn('h-full rounded-full', turnsPercent >= 90 ? 'bg-destructive' : 'bg-primary')}
              style={{ width: `${Math.min(turnsPercent, 100)}%` }}
            />
          </div>
        )}
      </div>

      {/* Thinking tokens - only show if limit is set */}
      {maxThinkingTokens !== undefined && (
        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-1 text-muted-foreground">
              <Brain className="w-3 h-3" />
              <span>Thinking</span>
            </div>
            <span className={cn(thinkingPercent >= 90 && 'text-destructive')}>
              {currentThinkingTokens.toLocaleString()} / {maxThinkingTokens.toLocaleString()}
            </span>
          </div>
          <div className="h-1 bg-muted rounded-full overflow-hidden">
            <div
              className={cn('h-full rounded-full', thinkingPercent >= 90 ? 'bg-destructive' : 'bg-primary')}
              style={{ width: `${Math.min(thinkingPercent, 100)}%` }}
            />
          </div>
        </div>
      )}

      {/* Info text when no limits are configured */}
      {!hasLimits && (
        <p className="text-xs text-muted-foreground pt-2 border-t">
          No budget limits configured for this session
        </p>
      )}
      </div>
    </ScrollArea>
  );
}
