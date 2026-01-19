'use client';

import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface DictationOverlayProps {
  interimText: string;
  soundLevel: number;
  onStop: () => void;
}

export function DictationOverlay({
  interimText,
  soundLevel,
  onStop,
}: DictationOverlayProps) {
  // Scale sound level to bar heights (0-1 to bar animation)
  const getBarHeight = (barIndex: number) => {
    // Each bar responds slightly differently to create wave effect
    const offset = barIndex * 0.15;
    const adjustedLevel = Math.max(0, Math.min(1, soundLevel + offset - 0.2));
    const minHeight = 4;
    const maxHeight = 16;
    return minHeight + adjustedLevel * (maxHeight - minHeight);
  };

  return (
    <div className="absolute -top-12 left-0 right-0 mx-4 z-20">
      <div className="flex items-center gap-3 px-3 py-2 bg-orange-500/10 border border-orange-500/30 rounded-lg backdrop-blur-sm">
        {/* Sound level bars */}
        <div className="flex items-center gap-0.5 h-4">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="sound-bar w-1 bg-orange-500 rounded-full transition-all duration-75"
              style={{ height: `${getBarHeight(i)}px` }}
            />
          ))}
        </div>

        {/* Label */}
        <span className="text-xs text-orange-500 font-medium whitespace-nowrap">
          Listening...
        </span>

        {/* Interim text */}
        <span
          className={cn(
            'flex-1 text-sm text-foreground truncate',
            !interimText && 'text-muted-foreground italic'
          )}
        >
          {interimText || 'Start speaking...'}
        </span>

        {/* Stop button */}
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 text-muted-foreground hover:text-foreground"
          onClick={onStop}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
