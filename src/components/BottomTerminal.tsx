'use client';

import { useEffect } from 'react';
import dynamic from 'next/dynamic';
import { X, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAppStore } from '@/stores/appStore';
import { cn } from '@/lib/utils';

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
  workspaceId: string;
  workspacePath: string;
  onHide: () => void;
}

export function BottomTerminal({ workspaceId, workspacePath, onHide }: BottomTerminalProps) {
  const {
    terminalInstances,
    activeTerminalId,
    createTerminal,
    closeTerminal,
    setActiveTerminal,
    markTerminalExited,
  } = useAppStore();

  const instances = terminalInstances[workspaceId] || [];
  const activeId = activeTerminalId[workspaceId];
  const canCreateMore = instances.length < 5;

  // Auto-create first terminal when panel is shown and no terminals exist
  useEffect(() => {
    if (instances.length === 0) {
      createTerminal(workspaceId);
    }
  }, [workspaceId, instances.length, createTerminal]);

  const handleCreateTerminal = () => {
    if (canCreateMore) {
      createTerminal(workspaceId);
    }
  };

  const handleCloseTerminal = (terminalId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    // If this is the last terminal, hide the panel
    if (instances.length === 1) {
      closeTerminal(workspaceId, terminalId);
      onHide();
    } else {
      closeTerminal(workspaceId, terminalId);
    }
  };

  const handleTerminalExit = (terminalId: string) => {
    markTerminalExited(terminalId);
  };

  return (
    <div className="flex flex-col h-full bg-background border-t">
      {/* Header with tabs */}
      <div className="flex items-center gap-1 px-2 py-1 border-b bg-muted/30 shrink-0">
        {/* Terminal tabs */}
        <div className="flex items-center gap-1 flex-1 min-w-0 overflow-x-auto">
          {instances.map((terminal) => (
            <button
              key={terminal.id}
              onClick={() => setActiveTerminal(workspaceId, terminal.id)}
              className={cn(
                'flex items-center gap-1 px-2 py-1 text-xs rounded-sm shrink-0',
                'hover:bg-accent/50 transition-colors',
                activeId === terminal.id
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground'
              )}
            >
              <span>Terminal {terminal.slotNumber}</span>
              {terminal.status === 'exited' && (
                <span className="text-[10px] text-yellow-500">(exited)</span>
              )}
              <X
                className="h-3 w-3 hover:text-destructive"
                onClick={(e) => handleCloseTerminal(terminal.id, e)}
              />
            </button>
          ))}

          {/* Add terminal button */}
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 shrink-0"
            onClick={handleCreateTerminal}
            disabled={!canCreateMore}
            title={canCreateMore ? 'New terminal' : 'Maximum 5 terminals'}
          >
            <Plus className="h-3 w-3" />
          </Button>
        </div>

        {/* Hide panel button */}
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 shrink-0"
          onClick={onHide}
          title="Hide terminal panel"
        >
          <X className="h-3 w-3" />
        </Button>
      </div>

      {/* Terminal content */}
      <div className="flex-1 min-h-0 relative">
        {instances.length === 0 ? (
          <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
            Click + to create a terminal
          </div>
        ) : (
          instances.map((terminal) => (
            <div
              key={terminal.id}
              className={cn(
                'absolute inset-0',
                activeId === terminal.id ? 'block' : 'hidden'
              )}
            >
              <Terminal
                sessionId={terminal.id}
                workspacePath={workspacePath}
                onExit={() => handleTerminalExit(terminal.id)}
              />
            </div>
          ))
        )}
      </div>
    </div>
  );
}
