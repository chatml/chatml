'use client';

import { useEffect, useRef } from 'react';
import { Mic } from 'lucide-react';
import { cn } from '@/lib/utils';

const BAR_COUNT = 24;
const MIN_HEIGHT = 0.08;
const WAVE_SPEED = 4;

// Phase offsets for each bar — creates two overlapping sine waves for organic feel
const PHASE_OFFSETS = Array.from({ length: BAR_COUNT }, (_, i) => ({
  primary: (i / BAR_COUNT) * Math.PI * 2,
  secondary: (i / BAR_COUNT) * Math.PI * 3 + 1.2,
}));

// Center envelope — bars in the center are taller than edges
const CENTER_FACTORS = Array.from({ length: BAR_COUNT }, (_, i) => {
  const center = (BAR_COUNT - 1) / 2;
  return 1 - (Math.abs(i - center) / center) * 0.3;
});

interface DictationWaveformProps {
  audioLevelRef: React.RefObject<number>;
  isActive: boolean;
  shortcutHint?: string;
}

export function DictationWaveform({ audioLevelRef, isActive, shortcutHint }: DictationWaveformProps) {
  const rafRef = useRef<number>(0);
  const timeRef = useRef(0);
  const lastFrameRef = useRef(0);
  // Direct refs to bar DOM elements — updated each frame without going through React state
  const barsRef = useRef<(HTMLDivElement | null)[]>([]);

  // Animation loop — writes heights directly to DOM to avoid 60 React re-renders/sec
  useEffect(() => {
    if (!isActive) return;

    lastFrameRef.current = performance.now();

    const animate = (now: number) => {
      const dt = (now - lastFrameRef.current) / 1000;
      lastFrameRef.current = now;
      timeRef.current += dt;

      const t = timeRef.current;
      const level = audioLevelRef.current;

      for (let i = 0; i < BAR_COUNT; i++) {
        const el = barsRef.current[i];
        if (!el) continue;
        const { primary, secondary } = PHASE_OFFSETS[i];
        // Two overlapping sine waves at different speeds for organic motion
        const wave1 = Math.sin(t * WAVE_SPEED + primary);
        const wave2 = Math.sin(t * WAVE_SPEED * 0.7 + secondary) * 0.4;
        const combined = (wave1 + wave2) / 1.4; // normalize to [-1, 1]
        const normalized = (combined + 1) / 2; // [0, 1]
        const height = MIN_HEIGHT + level * normalized * CENTER_FACTORS[i] * (1 - MIN_HEIGHT);
        el.style.height = `${Math.max(8, height * 100)}%`;
      }

      rafRef.current = requestAnimationFrame(animate);
    };

    rafRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafRef.current);
    // audioLevelRef intentionally omitted — it's a stable ref object;
    // we read .current each frame without needing to restart the loop.
  }, [isActive]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!isActive) return null;

  return (
    <div
      className={cn(
        'flex items-center gap-3 px-3 py-2 rounded-t-lg',
        'bg-blue-500/5 border-b border-blue-500/20',
        'animate-in slide-in-from-bottom-2 fade-in duration-200'
      )}
    >
      {/* Mic icon with pulse */}
      <div className="relative flex-shrink-0">
        <Mic className="size-4 text-blue-500" />
        <div className="absolute inset-0 rounded-full border border-blue-500/40 animate-ping" />
      </div>

      {/* Waveform bars */}
      <div className="flex items-center gap-[2px] h-6 flex-1 min-w-0">
        {Array.from({ length: BAR_COUNT }, (_, i) => (
          <div
            key={i}
            ref={(el) => { barsRef.current[i] = el; }}
            className="sound-bar flex-1 min-w-[2px] max-w-[4px] rounded-full bg-blue-500/60"
            style={{ height: `${MIN_HEIGHT * 100}%` }}
          />
        ))}
      </div>

      {/* Label */}
      <div className="flex-shrink-0 flex items-center gap-2">
        <span className="text-xs font-medium text-blue-600 dark:text-blue-400">
          Listening...
        </span>
        {shortcutHint && (
          <span className="text-[10px] text-muted-foreground">
            {shortcutHint} to stop
          </span>
        )}
      </div>
    </div>
  );
}
