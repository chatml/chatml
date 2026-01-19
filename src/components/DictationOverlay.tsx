'use client';

import { useEffect, useState } from 'react';
import { Square } from 'lucide-react';

interface DictationOverlayProps {
  soundLevel: number;
  onStop: () => void;
}

export function DictationOverlay({
  soundLevel,
  onStop,
}: DictationOverlayProps) {
  // Animation tick for wave effect
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setTick((t) => t + 1);
    }, 80);
    return () => clearInterval(interval);
  }, []);

  // Create a dynamic waveform with more bars
  const getBarHeight = (barIndex: number, totalBars: number) => {
    const center = (totalBars - 1) / 2;
    const distanceFromCenter = Math.abs(barIndex - center);
    const centerWeight = 1 - (distanceFromCenter / center) * 0.4;

    // Add phase offset for wave effect using tick
    const phase = Math.sin(tick * 0.4 + barIndex * 0.6);
    const baseLevel = Math.max(0.15, soundLevel) * centerWeight;
    const animatedLevel = baseLevel + (phase * 0.25 * baseLevel);
    const clampedLevel = Math.max(0.08, Math.min(1, animatedLevel));

    const minHeight = 8;
    const maxHeight = 32;
    return minHeight + clampedLevel * (maxHeight - minHeight);
  };

  const barCount = 12;

  return (
    <div className="absolute -top-14 left-0 right-0 mx-4 z-20">
      <div className="flex items-center gap-3 px-4 py-3 bg-emerald-500/10 border border-emerald-500/30 border-b-0 rounded-t-xl backdrop-blur-sm">
        {/* Status label - left aligned */}
        <div className="flex items-center gap-2 shrink-0">
          <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
          <span className="text-sm text-emerald-600 dark:text-emerald-400 font-medium">
            Listening
          </span>
        </div>

        {/* Waveform - centered, expanded */}
        <div className="flex-1 flex items-center justify-center gap-0.5 h-8">
          {Array.from({ length: barCount }).map((_, i) => (
            <div
              key={i}
              className="w-1 bg-emerald-500 rounded-full transition-all duration-75 ease-out"
              style={{
                height: `${getBarHeight(i, barCount)}px`,
                opacity: 0.5 + Math.max(0.2, soundLevel) * 0.5,
              }}
            />
          ))}
        </div>

        {/* Stop button - right aligned */}
        <button
          onClick={onStop}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-600 dark:text-emerald-400 text-xs font-medium rounded-full transition-colors shrink-0"
        >
          <Square className="h-2.5 w-2.5 fill-current" />
          Stop
        </button>
      </div>
    </div>
  );
}
