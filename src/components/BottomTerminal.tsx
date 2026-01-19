'use client';

import dynamic from 'next/dynamic';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';

// Dynamic import for xterm.js (browser-only)
const Terminal = dynamic(
  () => import('@/components/Terminal').then((mod) => mod.Terminal),
  {
    ssr: false,
    loading: () => (
      <div className="h-full bg-black/90 flex items-center justify-center">
        <span className="text-xs text-muted-foreground">Loading terminal...</span>
      </div>
    ),
  }
);

interface BottomTerminalProps {
  sessionId: string;
  workspacePath?: string;
  onClose: () => void;
}

export function BottomTerminal({ sessionId, workspacePath, onClose }: BottomTerminalProps) {
  return (
    <div className="flex flex-col h-full bg-background border-t">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b bg-muted/30">
        <span className="text-xs font-medium text-muted-foreground">Terminal</span>
        <Button
          variant="ghost"
          size="icon"
          className="h-5 w-5"
          onClick={onClose}
        >
          <X className="h-3 w-3" />
        </Button>
      </div>
      {/* Terminal */}
      <div className="flex-1 min-h-0">
        <Terminal sessionId={sessionId} workspacePath={workspacePath} />
      </div>
    </div>
  );
}
