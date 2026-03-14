'use client';

import { memo } from 'react';
import { formatTokens, formatCost } from '@/lib/format';
import { useSettingsStore } from '@/stores/settingsStore';
import type { RunSummary } from '@/lib/types';

interface MessageTokenFooterProps {
  summary: RunSummary;
}

export const MessageTokenFooter = memo(function MessageTokenFooter({ summary }: MessageTokenFooterProps) {
  const show = useSettingsStore((s) => s.showMessageTokenCost);
  if (!show) return null;

  const input = summary.usage?.inputTokens ?? 0;
  const output = summary.usage?.outputTokens ?? 0;
  const cacheRead = summary.usage?.cacheReadInputTokens ?? 0;
  const cacheWrite = summary.usage?.cacheCreationInputTokens ?? 0;
  const cost = summary.cost;

  if (input === 0 && output === 0) return null;

  const parts: string[] = [];
  parts.push(`${formatTokens(input)} in`);
  parts.push(`${formatTokens(output)} out`);
  if (cacheRead > 0) parts.push(`${formatTokens(cacheRead)} cached`);
  if (cacheWrite > 0) parts.push(`${formatTokens(cacheWrite)} cache write`);

  return (
    <div className="flex items-center gap-1.5 text-2xs text-muted-foreground/60 select-none">
      <span>{parts.join(' \u00b7 ')}</span>
      {cost != null && cost > 0 && (
        <>
          <span className="text-muted-foreground/30">&mdash;</span>
          <span>{formatCost(cost)}</span>
        </>
      )}
    </div>
  );
});
