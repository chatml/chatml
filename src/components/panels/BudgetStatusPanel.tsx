'use client';

import { useBudgetStatus } from '@/stores/selectors';
import { useAppStore } from '@/stores/appStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { ScrollArea } from '@/components/ui/scroll-area';
import { AlertCircle, DollarSign, RefreshCw, Brain, Gauge, ArrowDownToLine, ArrowUpFromLine } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatTokens } from '@/lib/format';
import { EmptyState } from '@/components/ui/empty-state';
import type { TokenUsage } from '@/lib/types';

interface CumulativeTokens {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  total: number;
}

const EMPTY_CUMULATIVE: CumulativeTokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };

/** Derive cumulative token usage directly from the store to avoid unstable array references. */
const useCumulativeTokens = (conversationId: string | null): CumulativeTokens =>
  useAppStore((s) => {
    if (!conversationId) return EMPTY_CUMULATIVE;
    let input = 0, output = 0, cacheRead = 0, cacheWrite = 0;
    for (const msg of s.messages) {
      if (msg.conversationId !== conversationId) continue;
      const usage: TokenUsage | undefined = msg.runSummary?.usage;
      if (usage) {
        input += usage.inputTokens;
        output += usage.outputTokens;
        cacheRead += usage.cacheReadInputTokens ?? 0;
        cacheWrite += usage.cacheCreationInputTokens ?? 0;
      }
    }
    if (input === 0 && output === 0) return EMPTY_CUMULATIVE;
    return { input, output, cacheRead, cacheWrite, total: input + output };
  });

export function BudgetStatusPanel() {
  const budgetStatus = useBudgetStatus();
  const showTokenUsage = useSettingsStore((s) => s.showTokenUsage);
  const selectedConversationId = useAppStore((s) => s.selectedConversationId);
  const cumulativeTokens = useCumulativeTokens(selectedConversationId);

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
  const thinkingEnabled = maxThinkingTokens !== undefined && maxThinkingTokens > 0;

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

      {/* Cumulative token usage */}
      {showTokenUsage && cumulativeTokens.total > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-1 text-muted-foreground">
              <ArrowDownToLine className="w-3 h-3" />
              <span>Input tokens</span>
            </div>
            <span className="font-mono">{formatTokens(cumulativeTokens.input)}</span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-1 text-muted-foreground">
              <ArrowUpFromLine className="w-3 h-3" />
              <span>Output tokens</span>
            </div>
            <span className="font-mono">{formatTokens(cumulativeTokens.output)}</span>
          </div>
          {cumulativeTokens.cacheRead > 0 && (
            <div className="flex items-center justify-between text-xs text-muted-foreground/70">
              <span className="ml-4">Cache read</span>
              <span className="font-mono">{formatTokens(cumulativeTokens.cacheRead)}</span>
            </div>
          )}
          {cumulativeTokens.cacheWrite > 0 && (
            <div className="flex items-center justify-between text-xs text-muted-foreground/70">
              <span className="ml-4">Cache write</span>
              <span className="font-mono">{formatTokens(cumulativeTokens.cacheWrite)}</span>
            </div>
          )}
        </div>
      )}

      {/* Extended Thinking — status card */}
      <div className={cn(
        'rounded-lg border p-2.5 space-y-2',
        thinkingEnabled
          ? 'border-amber-500/20 bg-amber-500/5'
          : 'border-border bg-muted/30'
      )}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Brain className={cn(
              'w-3.5 h-3.5',
              thinkingEnabled ? 'text-amber-500' : 'text-muted-foreground'
            )} />
            <span className="text-xs font-medium">Extended Thinking</span>
          </div>
          <span className={cn(
            'inline-flex items-center rounded-full px-1.5 py-0.5 text-2xs font-semibold uppercase tracking-wider',
            thinkingEnabled
              ? 'bg-amber-500/15 text-amber-500'
              : 'bg-muted text-muted-foreground'
          )}>
            {thinkingEnabled ? 'On' : 'Off'}
          </span>
        </div>
        {thinkingEnabled && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Usage</span>
              <span className={cn('font-mono', thinkingPercent >= 90 && 'text-destructive')}>
                {currentThinkingTokens.toLocaleString()} / {maxThinkingTokens.toLocaleString()}
              </span>
            </div>
            <div className="h-1 bg-muted rounded-full overflow-hidden">
              <div
                className={cn('h-full rounded-full', thinkingPercent >= 90 ? 'bg-destructive' : 'bg-amber-500')}
                style={{ width: `${Math.min(thinkingPercent, 100)}%` }}
              />
            </div>
          </div>
        )}
      </div>

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
