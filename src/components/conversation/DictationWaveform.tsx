'use client';

import { useState, useEffect } from 'react';
import { Mic } from 'lucide-react';
import { cn } from '@/lib/utils';
import { isMacOS } from '@/lib/platform';

const BAR_COUNT = 24;

// Pre-compute deterministic base offsets (no randomness needed — visual variety
// comes from the audio-level multipliers which change per frame).
const BAR_OFFSETS = Array.from({ length: BAR_COUNT }, (_, i) => {
  // Use a simple hash-like formula for deterministic but varied offsets
  const t = ((i * 7 + 3) % BAR_COUNT) / BAR_COUNT;
  return t * 0.3 + 0.05;
});

interface DictationWaveformProps {
  audioLevel: number;
  isActive: boolean;
}

export function DictationWaveform({ audioLevel, isActive }: DictationWaveformProps) {
  // Multipliers stored in state so they can be read during render
  const [barMultipliers, setBarMultipliers] = useState<number[]>(
    () => Array.from({ length: BAR_COUNT }, () => 1)
  );

  // Refresh random multipliers on each audio level change for organic movement
  useEffect(() => {
    setBarMultipliers(
      Array.from({ length: BAR_COUNT }, () => 0.6 + Math.random() * 0.4)
    );
  }, [audioLevel]);

  if (!isActive) return null;

  const shortcutHint = isMacOS() ? '\u2318+Shift+D' : 'Ctrl+Shift+D';

  return (
    <div
      className={cn(
        'flex items-center gap-3 px-3 py-2 rounded-t-lg',
        'bg-orange-500/5 border-b border-orange-500/20',
        'animate-in slide-in-from-bottom-2 fade-in duration-200'
      )}
    >
      {/* Mic icon with pulse */}
      <div className="relative flex-shrink-0">
        <Mic className="size-4 text-orange-500" />
        <div className="absolute inset-0 rounded-full border border-orange-500/40 animate-ping" />
      </div>

      {/* Waveform bars */}
      <div className="flex items-center gap-[2px] h-6 flex-1 min-w-0">
        {BAR_OFFSETS.map((baseOffset, i) => {
          const multiplier = barMultipliers[i] ?? 1;
          const height = Math.min(
            1,
            baseOffset + audioLevel * multiplier
          );
          // Create a gentle wave shape: bars in the center are taller
          const centerFactor =
            1 - Math.abs(i - BAR_COUNT / 2) / (BAR_COUNT / 2) * 0.3;

          return (
            <div
              key={i}
              className="sound-bar flex-1 min-w-[2px] max-w-[4px] rounded-full bg-orange-500/60"
              style={{
                height: `${Math.max(8, height * centerFactor * 100)}%`,
              }}
            />
          );
        })}
      </div>

      {/* Label */}
      <div className="flex-shrink-0 flex items-center gap-2">
        <span className="text-xs font-medium text-orange-600 dark:text-orange-400">
          Listening...
        </span>
        <span className="text-[10px] text-muted-foreground">
          {shortcutHint} to stop
        </span>
      </div>
    </div>
  );
}
