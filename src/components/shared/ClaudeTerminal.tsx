'use client';

import { useEffect, useRef } from 'react';
import { useClaudeTerminal } from '@/hooks/useClaudeTerminal';
import { cn } from '@/lib/utils';
import '@xterm/xterm/css/xterm.css';

export interface ClaudeTerminalProps {
  instanceId: string;
  workspacePath?: string;
  className?: string;
  onExit?: (code: number | null) => void;
}

export function ClaudeTerminal({ instanceId, workspacePath, className, onExit }: ClaudeTerminalProps) {
  const { containerRef, fit } = useClaudeTerminal({
    workspacePath,
    onExit,
  });

  const resizeObserverRef = useRef<ResizeObserver | null>(null);

  // Handle container resize
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    resizeObserverRef.current = new ResizeObserver(() => {
      // Debounce fit calls, skip when hidden (0 dimensions)
      requestAnimationFrame(() => {
        if (container.offsetWidth > 0 && container.offsetHeight > 0) {
          fit();
        }
      });
    });

    resizeObserverRef.current.observe(container);

    return () => {
      resizeObserverRef.current?.disconnect();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- containerRef is a stable ref identity
  }, [fit]);

  return (
    <div
      ref={containerRef}
      className={cn(
        'h-full w-full bg-background overflow-hidden',
        // Override xterm.js default styles
        '[&_.xterm]:h-full [&_.xterm]:p-2 [&_.xterm]:bg-background',
        '[&_.xterm-viewport]:!overflow-y-auto',
        '[&_.xterm-screen]:h-full',
        className
      )}
      data-instance-id={instanceId}
    />
  );
}
