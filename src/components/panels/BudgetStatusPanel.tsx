'use client';

import { useMemo } from 'react';
import { useAppStore } from '@/stores/appStore';
import { ScrollArea } from '@/components/ui/scroll-area';
import { AlertCircle, ArrowDownToLine, ArrowUpFromLine, Gauge } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatTokens, formatCost } from '@/lib/format';
import { getModelInfo, getModelDisplayName } from '@/lib/models';
import { EmptyState } from '@/components/ui/empty-state';
import { useShallow } from 'zustand/react/shallow';
import type { Message, TokenUsage } from '@/lib/types';

// ---------------------------------------------------------------------------
// Shared: O(1) selector to get conversation message bucket reference
// ---------------------------------------------------------------------------

const EMPTY_MESSAGES: readonly Message[] = [];

const useConversationMessages = (conversationId: string | null) =>
  useAppStore((s) =>
    conversationId ? s.messagesByConversation[conversationId] ?? EMPTY_MESSAGES : EMPTY_MESSAGES
  );

// ---------------------------------------------------------------------------
// Hooks — O(n) scans are in useMemo, only re-run when bucket ref changes
// ---------------------------------------------------------------------------

interface CumulativeTokens {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  total: number;
}

const EMPTY_CUMULATIVE: CumulativeTokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };

const useCumulativeTokens = (conversationId: string | null): CumulativeTokens => {
  const messages = useConversationMessages(conversationId);
  return useMemo(() => {
    let input = 0, output = 0, cacheRead = 0, cacheWrite = 0;
    for (const msg of messages) {
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
  }, [messages]);
};

interface ConversationUsage {
  model?: string;
  budgetConfig?: { maxBudgetUsd?: number; maxTurns?: number };
  thinkingConfig?: { effort?: string; maxThinkingTokens?: number };
  cost?: number;
  turns?: number;
  limitExceeded?: 'budget' | 'turns';
}

const EMPTY_USAGE: ConversationUsage = {};

const useConversationUsage = (conversationId: string | null): ConversationUsage => {
  const messages = useConversationMessages(conversationId);
  const conv = useAppStore(useShallow((s) => {
    if (!conversationId) return null;
    const c = s.conversations.find(c => c.id === conversationId);
    if (!c) return null;
    return { model: c.model, budgetConfig: c.budgetConfig, thinkingConfig: c.thinkingConfig };
  }));

  return useMemo(() => {
    if (!conv) return EMPTY_USAGE;

    // Walk messages backwards to find the latest runSummary
    let cost: number | undefined;
    let turns: number | undefined;
    let limitExceeded: 'budget' | 'turns' | undefined;
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.runSummary) {
        cost = msg.runSummary.cost;
        turns = msg.runSummary.turns;
        limitExceeded = msg.runSummary.limitExceeded;
        break;
      }
    }

    return { ...conv, cost, turns, limitExceeded };
  }, [messages, conv]);
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getThinkingDisplay(model?: string, thinkingConfig?: { effort?: string; maxThinkingTokens?: number }): string {
  const info = model ? getModelInfo(model) : null;
  if (info?.supportsEffort) {
    const effort = thinkingConfig?.effort ?? 'high';
    return effort.charAt(0).toUpperCase() + effort.slice(1);
  }
  if (thinkingConfig?.maxThinkingTokens) {
    return `On (${formatTokens(thinkingConfig.maxThinkingTokens)})`;
  }
  return 'Off';
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

function SummaryRow({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn('font-mono', className)}>{value}</span>
    </div>
  );
}

function ProgressRow({ label, current, max, formatValue }: {
  label: string; current: number; max: number; formatValue: (v: number) => string;
}) {
  const percent = max > 0 ? (current / max) * 100 : 0;
  const isHigh = percent >= 90;

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className={cn('font-mono', isHigh && 'text-destructive')}>
          {formatValue(current)} / {formatValue(max)}
          <span className="ml-1.5 text-muted-foreground">{Math.round(percent)}%</span>
        </span>
      </div>
      <div className="h-1 bg-muted rounded-full overflow-hidden">
        <div
          className={cn('h-full rounded-full transition-all', isHigh ? 'bg-destructive' : 'bg-primary')}
          style={{ width: `${Math.min(percent, 100)}%` }}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

export function BudgetStatusPanel() {
  const selectedConversationId = useAppStore((s) => s.selectedConversationId);
  const usage = useConversationUsage(selectedConversationId);
  const tokens = useCumulativeTokens(selectedConversationId);

  const hasData = usage.model || tokens.total > 0 || usage.cost !== undefined;

  if (!hasData) {
    return (
      <div className="h-full flex items-center justify-center">
        <EmptyState
          icon={Gauge}
          title="No usage data yet"
          description="Start a conversation to see usage metrics"
        />
      </div>
    );
  }

  const { model, budgetConfig, thinkingConfig, cost, turns, limitExceeded } = usage;
  const thinkingDisplay = getThinkingDisplay(model, thinkingConfig);

  return (
    <ScrollArea className="h-full">
      <div className="p-3 space-y-3">
        {/* Limit exceeded alert */}
        {limitExceeded && (
          <div className="flex items-center gap-2 p-2 bg-destructive/10 text-destructive rounded-md text-xs">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>
              {limitExceeded === 'budget' ? 'Budget limit exceeded' : 'Turn limit exceeded'}
            </span>
          </div>
        )}

        {/* Summary grid */}
        <div className="space-y-1.5">
          {model && <SummaryRow label="Model" value={getModelDisplayName(model)} />}
          <SummaryRow label="Thinking" value={thinkingDisplay} />
          {cost !== undefined && <SummaryRow label="Cost" value={formatCost(cost)} />}
          {turns !== undefined && <SummaryRow label="Turns" value={String(turns)} />}
        </div>

        {/* Token breakdown */}
        {tokens.total > 0 && (
          <div className="space-y-1.5 border-t pt-3">
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-1 text-muted-foreground">
                <ArrowDownToLine className="w-3 h-3" />
                <span>Input</span>
              </div>
              <span className="font-mono">{formatTokens(tokens.input)}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-1 text-muted-foreground">
                <ArrowUpFromLine className="w-3 h-3" />
                <span>Output</span>
              </div>
              <span className="font-mono">{formatTokens(tokens.output)}</span>
            </div>
            {tokens.cacheRead > 0 && (
              <div className="flex items-center justify-between text-xs text-muted-foreground/70">
                <span className="ml-4">Cache read</span>
                <span className="font-mono">{formatTokens(tokens.cacheRead)}</span>
              </div>
            )}
            {tokens.cacheWrite > 0 && (
              <div className="flex items-center justify-between text-xs text-muted-foreground/70">
                <span className="ml-4">Cache write</span>
                <span className="font-mono">{formatTokens(tokens.cacheWrite)}</span>
              </div>
            )}
          </div>
        )}

        {/* Budget/Turns progress bars — only when limits are configured */}
        {(budgetConfig?.maxBudgetUsd || budgetConfig?.maxTurns) && (
          <div className="space-y-2 border-t pt-3">
            {budgetConfig.maxBudgetUsd != null && (
              <ProgressRow
                label="Budget"
                current={cost ?? 0}
                max={budgetConfig.maxBudgetUsd}
                formatValue={formatCost}
              />
            )}
            {budgetConfig.maxTurns != null && (
              <ProgressRow
                label="Turns"
                current={turns ?? 0}
                max={budgetConfig.maxTurns}
                formatValue={String}
              />
            )}
          </div>
        )}
      </div>
    </ScrollArea>
  );
}
