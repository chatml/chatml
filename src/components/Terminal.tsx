'use client';

import { useEffect, useRef, useCallback } from 'react';
import { useTerminal } from '@/hooks/useTerminal';
import { cn } from '@/lib/utils';
import '@xterm/xterm/css/xterm.css';

export interface TerminalProps {
  sessionId: string;
  workspacePath?: string;
  className?: string;
  onExit?: (code: number | null) => void;
}

export function Terminal({ sessionId, workspacePath, className, onExit }: TerminalProps) {
  const { containerRef, fit, clear } = useTerminal({
    workspacePath,
    onExit,
  });

  const resizeObserverRef = useRef<ResizeObserver | null>(null);

  // Handle Cmd+K to clear terminal (capture phase to intercept before global handlers)
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'k' && e.metaKey && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        e.stopPropagation();
        clear();
      }
    };

    // Use capture phase to intercept before document-level handlers
    container.addEventListener('keydown', handleKeyDown, true);

    return () => {
      container.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [clear, containerRef]);

  // Handle container resize
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    resizeObserverRef.current = new ResizeObserver(() => {
      // Debounce fit calls
      requestAnimationFrame(() => {
        fit();
      });
    });

    resizeObserverRef.current.observe(container);

    return () => {
      resizeObserverRef.current?.disconnect();
    };
  }, [fit, containerRef]);

  return (
    <div
      ref={containerRef}
      className={cn(
        'h-full w-full bg-black/90 overflow-hidden',
        // Override xterm.js default styles
        '[&_.xterm]:h-full [&_.xterm]:p-2',
        '[&_.xterm-viewport]:!overflow-y-auto',
        '[&_.xterm-screen]:h-full',
        className
      )}
      data-session-id={sessionId}
    />
  );
}
