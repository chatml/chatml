'use client';

import { memo } from 'react';
import { Brain, Settings2, Info } from 'lucide-react';

interface TurnStatusIndicatorProps {
  content: string;
  variant?: string;
}

export const TurnStatusIndicator = memo(function TurnStatusIndicator({
  content,
  variant,
}: TurnStatusIndicatorProps) {
  const Icon = variant === 'thinking_enabled' ? Brain
    : variant === 'config' ? Settings2
    : Info;

  const colorClass = variant === 'thinking_enabled'
    ? 'text-ai-thinking'
    : 'text-muted-foreground';

  return (
    <div className="flex items-center gap-2" aria-label={content}>
      <Icon className={`w-3.5 h-3.5 shrink-0 ${colorClass}`} aria-hidden="true" />
      <span className={`text-xs ${colorClass}`}>{content}</span>
    </div>
  );
});
