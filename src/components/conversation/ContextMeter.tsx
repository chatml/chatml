'use client';

import { useAppStore } from '@/stores/appStore';
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from '@/components/ui/popover';
import { cn } from '@/lib/utils';

function formatTokenCount(tokens: number): string {
  if (tokens >= 1000) {
    return `${(tokens / 1000).toFixed(1)}k`;
  }
  return tokens.toString();
}

interface ContextMeterProps {
  conversationId: string | null;
}

export function ContextMeter({ conversationId }: ContextMeterProps) {
  const contextUsage = useAppStore((s) =>
    conversationId ? s.contextUsage[conversationId] : null
  );

  const totalInputTokens = contextUsage
    ? contextUsage.inputTokens + contextUsage.cacheReadInputTokens + contextUsage.cacheCreationInputTokens
    : 0;

  if (!contextUsage || totalInputTokens === 0) {
    return null;
  }

  const maxTokens = contextUsage.contextWindow || 200000;
  const used = totalInputTokens;
  const percentage = Math.min((used / maxTokens) * 100, 100);

  // SVG circle math: circumference = 2 * PI * radius
  const radius = 7;
  const circumference = 2 * Math.PI * radius;
  const strokeDasharray = `${(percentage / 100) * circumference} ${circumference}`;

  const isWarning = percentage >= 80;
  const isCritical = percentage >= 95;

  const colorClass = isCritical
    ? 'text-red-500'
    : isWarning
    ? 'text-amber-500'
    : 'text-muted-foreground';

  const barColorClass = isCritical
    ? 'bg-red-500'
    : isWarning
    ? 'bg-amber-500'
    : 'bg-primary';

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className={cn(
            'flex items-center gap-1.5 h-7 px-2 rounded-md text-xs',
            'hover:bg-accent/50 transition-colors cursor-default',
            colorClass
          )}
          aria-label={`Context usage: ${Math.round(percentage)}% (${formatTokenCount(used)} of ${formatTokenCount(maxTokens)} tokens)`}
        >
          <svg className="h-3.5 w-3.5" viewBox="0 0 18 18">
            <circle
              cx="9"
              cy="9"
              r={radius}
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              opacity="0.2"
            />
            <circle
              cx="9"
              cy="9"
              r={radius}
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeDasharray={strokeDasharray}
              strokeLinecap="round"
              transform="rotate(-90 9 9)"
            />
          </svg>
          <span className="tabular-nums">{Math.round(percentage)}%</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" side="top" className="w-64 p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium">Context</span>
          <span className={cn('text-sm tabular-nums', colorClass)}>
            {formatTokenCount(used)} / {formatTokenCount(maxTokens)}
          </span>
        </div>

        <div className="h-1.5 bg-muted rounded-full overflow-hidden mb-3">
          <div
            className={cn('h-full rounded-full transition-all duration-300', barColorClass)}
            style={{ width: `${percentage}%` }}
          />
        </div>

        <div className="space-y-1.5 text-xs text-muted-foreground">
          <BreakdownRow
            label="Input tokens"
            value={contextUsage.inputTokens}
          />
          <BreakdownRow
            label="Output tokens"
            value={contextUsage.outputTokens}
          />
          {contextUsage.cacheReadInputTokens > 0 && (
            <BreakdownRow
              label="Cache read"
              value={contextUsage.cacheReadInputTokens}
            />
          )}
          {contextUsage.cacheCreationInputTokens > 0 && (
            <BreakdownRow
              label="Cache creation"
              value={contextUsage.cacheCreationInputTokens}
            />
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function BreakdownRow({
  label,
  value,
}: {
  label: string;
  value: number;
}) {
  if (value === 0) return null;
  return (
    <div className="flex items-center justify-between">
      <span>{label}</span>
      <span className="tabular-nums">{formatTokenCount(value)}</span>
    </div>
  );
}
