'use client';

import { useState, memo } from 'react';
import { Brain, ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSettingsStore } from '@/stores/settingsStore';

interface ThinkingNodeProps {
  content: string;
  isStreaming?: boolean;
}

export const ThinkingNode = memo(function ThinkingNode({
  content,
  isStreaming = false,
}: ThinkingNodeProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const showThinkingBlocks = useSettingsStore((s) => s.showThinkingBlocks);

  if (!showThinkingBlocks) return null;

  return (
    <div className="flex flex-col gap-1 mt-2 mb-1 animate-slide-up-fade" aria-label="Agent thinking">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-2 text-xs text-ai-thinking hover:text-ai-thinking/80 transition-colors"
      >
        <Brain
          className={cn(
            'w-3.5 h-3.5 shrink-0',
            isStreaming && 'animate-thinking-pulse'
          )}
          aria-hidden="true"
        />
        <span className="font-medium">Thinking</span>
        {isStreaming && (
          <Loader2 className="w-3 h-3 animate-spin text-ai-thinking" aria-hidden="true" />
        )}
        {isExpanded ? (
          <ChevronDown className="w-3 h-3" />
        ) : (
          <ChevronRight className="w-3 h-3" />
        )}
      </button>
      {isExpanded && (
        <div className="ml-5 text-xs px-2 py-1.5 rounded bg-ai-thinking/10 text-muted-foreground font-mono border border-ai-thinking/20 whitespace-pre-wrap max-h-[300px] overflow-y-auto">
          {content}
        </div>
      )}
    </div>
  );
});
