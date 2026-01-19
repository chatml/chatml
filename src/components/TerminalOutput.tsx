'use client';

import { useEffect, useRef } from 'react';
import { useTerminalOutput } from '@/hooks/useTerminal';
import { useAppStore } from '@/stores/appStore';
import { cn } from '@/lib/utils';
import '@xterm/xterm/css/xterm.css';

// Stable empty array to avoid infinite re-renders
const EMPTY_OUTPUT: string[] = [];

export interface TerminalOutputProps {
  sessionId: string;
  type: 'setup' | 'run';
  className?: string;
}

export function TerminalOutput({ sessionId, type, className }: TerminalOutputProps) {
  const { containerRef, fit, write, clear } = useTerminalOutput();
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const lastOutputLengthRef = useRef(0);

  // Get output from store based on type
  const outputKey = `${sessionId}-${type}`;
  const output = useAppStore((state) => state.sessionOutputs[outputKey] ?? EMPTY_OUTPUT);

  // Handle container resize
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    resizeObserverRef.current = new ResizeObserver(() => {
      requestAnimationFrame(() => {
        fit();
      });
    });

    resizeObserverRef.current.observe(container);

    return () => {
      resizeObserverRef.current?.disconnect();
    };
  }, [fit, containerRef]);

  // Write new output lines to terminal
  useEffect(() => {
    if (output.length > lastOutputLengthRef.current) {
      // Write only new lines
      const newLines = output.slice(lastOutputLengthRef.current);
      newLines.forEach((line) => {
        write(line + '\r\n');
      });
      lastOutputLengthRef.current = output.length;
    } else if (output.length < lastOutputLengthRef.current) {
      // Output was cleared, reset terminal
      clear();
      lastOutputLengthRef.current = 0;
      // Re-write all lines
      output.forEach((line) => {
        write(line + '\r\n');
      });
      lastOutputLengthRef.current = output.length;
    }
  }, [output, write, clear]);

  // Show placeholder when no output
  const hasOutput = output.length > 0;

  return (
    <div className={cn('h-full w-full relative', className)}>
      <div
        ref={containerRef}
        className={cn(
          'h-full w-full bg-black/90 overflow-hidden',
          '[&_.xterm]:h-full [&_.xterm]:p-2',
          '[&_.xterm-viewport]:!overflow-y-auto',
          '[&_.xterm-screen]:h-full',
          !hasOutput && 'opacity-50'
        )}
        data-session-id={sessionId}
        data-output-type={type}
      />
      {!hasOutput && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span className="text-xs text-muted-foreground">
            {type === 'setup' ? 'No setup output yet' : 'No run output yet'}
          </span>
        </div>
      )}
    </div>
  );
}
