'use client';

import { useAppStore } from '@/stores/appStore';
import { AlertCircle, DollarSign, RefreshCw, Brain } from 'lucide-react';
import { cn } from '@/lib/utils';

export function BudgetStatusPanel() {
  const { budgetStatus } = useAppStore();

  if (!budgetStatus) {
    return null;
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

  const budgetPercent = maxBudgetUsd ? (currentCostUsd / maxBudgetUsd) * 100 : 0;
  const turnsPercent = maxTurns ? (currentTurns / maxTurns) * 100 : 0;
  const thinkingPercent = maxThinkingTokens ? (currentThinkingTokens / maxThinkingTokens) * 100 : 0;

  return (
    <div className="p-3 space-y-3 border-b">
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

      {maxBudgetUsd !== undefined && (
        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-1 text-muted-foreground">
              <DollarSign className="w-3 h-3" />
              <span>Cost</span>
            </div>
            <span className={cn(budgetPercent >= 90 && 'text-destructive')}>
              ${currentCostUsd.toFixed(4)} / ${maxBudgetUsd.toFixed(2)}
            </span>
          </div>
          <div className="h-1 bg-muted rounded-full overflow-hidden">
            <div
              className={cn('h-full rounded-full', budgetPercent >= 90 ? 'bg-destructive' : 'bg-primary')}
              style={{ width: `${Math.min(budgetPercent, 100)}%` }}
            />
          </div>
        </div>
      )}

      {maxTurns !== undefined && (
        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-1 text-muted-foreground">
              <RefreshCw className="w-3 h-3" />
              <span>Turns</span>
            </div>
            <span className={cn(turnsPercent >= 90 && 'text-destructive')}>
              {currentTurns} / {maxTurns}
            </span>
          </div>
          <div className="h-1 bg-muted rounded-full overflow-hidden">
            <div
              className={cn('h-full rounded-full', turnsPercent >= 90 ? 'bg-destructive' : 'bg-primary')}
              style={{ width: `${Math.min(turnsPercent, 100)}%` }}
            />
          </div>
        </div>
      )}

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
    </div>
  );
}
