'use client';

import { useEffect, useState, useRef } from 'react';

interface GuidedTourTooltipProps {
  targetSelector: string;
  description: string;
  onDismiss: () => void;
}

interface Position {
  top: number;
  left: number;
}

function getPosition(rect: DOMRect): Position {
  const tooltipWidth = 300;
  const tooltipHeight = 80;
  const gap = 12;

  // Prefer positioning below the element
  if (rect.bottom + gap + tooltipHeight < window.innerHeight) {
    return {
      top: rect.bottom + gap,
      left: Math.max(8, Math.min(rect.left + rect.width / 2 - tooltipWidth / 2, window.innerWidth - tooltipWidth - 8)),
    };
  }

  // Otherwise position above
  return {
    top: rect.top - gap - tooltipHeight,
    left: Math.max(8, Math.min(rect.left + rect.width / 2 - tooltipWidth / 2, window.innerWidth - tooltipWidth - 8)),
  };
}

export function GuidedTourTooltip({
  targetSelector,
  description,
  onDismiss,
}: GuidedTourTooltipProps) {
  const [position, setPosition] = useState<Position | null>(null);
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const updatePosition = () => {
      const target = document.querySelector(targetSelector);
      if (!target) return;

      const rect = target.getBoundingClientRect();
      setTargetRect(rect);
      setPosition(getPosition(rect));
    };

    updatePosition();

    const observer = new ResizeObserver(updatePosition);
    observer.observe(document.body);

    window.addEventListener('resize', updatePosition);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updatePosition);
    };
  }, [targetSelector]);

  if (!position || !targetRect) return null;

  const padding = 6;
  const clipPath = `polygon(
    0% 0%, 0% 100%,
    ${targetRect.left - padding}px 100%,
    ${targetRect.left - padding}px ${targetRect.top - padding}px,
    ${targetRect.right + padding}px ${targetRect.top - padding}px,
    ${targetRect.right + padding}px ${targetRect.bottom + padding}px,
    ${targetRect.left - padding}px ${targetRect.bottom + padding}px,
    ${targetRect.left - padding}px 100%,
    100% 100%, 100% 0%
  )`;

  return (
    <div className="fixed inset-0 z-40 pointer-events-none">
      {/* Overlay with cutout */}
      <div
        className="absolute inset-0 bg-black/60 pointer-events-auto"
        style={{ clipPath }}
        onClick={onDismiss}
      />

      {/* Highlight ring around target */}
      <div
        className="absolute rounded-xl ring-2 ring-primary ring-offset-2 ring-offset-transparent"
        style={{
          top: targetRect.top - padding,
          left: targetRect.left - padding,
          width: targetRect.width + padding * 2,
          height: targetRect.height + padding * 2,
        }}
      />

      {/* Tooltip */}
      <div
        ref={tooltipRef}
        className="absolute w-[300px] bg-surface-1 border border-border/50 rounded-lg shadow-lg p-4 animate-slide-up-fade pointer-events-auto"
        style={{ top: position.top, left: position.left }}
      >
        <div className="flex items-start justify-between mb-1.5">
          <p className="text-sm text-foreground leading-relaxed pr-4">{description}</p>
          <button
            onClick={onDismiss}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors shrink-0"
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}
