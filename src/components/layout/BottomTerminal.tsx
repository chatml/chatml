'use client';

import { useEffect, useRef } from 'react';
import dynamic from 'next/dynamic';
import { X, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTerminalState, useAllTerminalInstances } from '@/stores/selectors';
import { cn } from '@/lib/utils';
import { ErrorBoundary } from '@/components/shared/ErrorBoundary';
import { BlockErrorFallback } from '@/components/shared/ErrorFallbacks';

const Terminal = dynamic(
  () => import('@/components/shared/Terminal').then((mod) => mod.Terminal),
  {
    ssr: false,
    loading: () => (
      <div className="h-full bg-background flex items-center justify-center">
        <span className="text-xs text-muted-foreground">Loading terminal...</span>
      </div>
    ),
  }
);

interface BottomTerminalProps {
  currentSessionId: string | null;
  currentWorkspacePath: string | null;
  isExpanded: boolean;
  onHide: () => void;
}

export function BottomTerminal({ currentSessionId, currentWorkspacePath, isExpanded, onHide }: BottomTerminalProps) {
  // Current session's terminals for tab bar display
  const {
    instances,
    activeId,
    createTerminal,
    closeTerminal,
    setActiveTerminal,
    markTerminalExited,
  } = useTerminalState(currentSessionId);

  // ALL sessions' terminals for persistent rendering
  const { allInstances, allActiveIds } = useAllTerminalInstances();

  const canCreateMore = instances.length < 5;

  // Ref to track if we've already created a terminal for this session
  // Prevents React Strict Mode from creating duplicate terminals
  const createdRef = useRef<string | null>(null);

  // Auto-create first terminal when panel is shown and no terminals exist
  // Deferred so it doesn't block session navigation render
  // Gated on isExpanded to avoid spawning PTYs when the panel is collapsed
  useEffect(() => {
    if (isExpanded && currentSessionId && currentWorkspacePath && instances.length === 0 && createdRef.current !== currentSessionId) {
      const id = setTimeout(() => {
        createdRef.current = currentSessionId;
        createTerminal(currentSessionId, currentWorkspacePath);
      }, 500);
      return () => clearTimeout(id);
    }
  }, [isExpanded, currentSessionId, currentWorkspacePath, instances.length, createTerminal]);

  const handleCreateTerminal = () => {
    if (canCreateMore && currentSessionId && currentWorkspacePath) {
      createTerminal(currentSessionId, currentWorkspacePath);
    }
  };

  const handleCloseTerminal = (terminalId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!currentSessionId) return;
    // If this is the last terminal, hide the panel
    if (instances.length === 1) {
      closeTerminal(currentSessionId, terminalId);
      onHide();
    } else {
      closeTerminal(currentSessionId, terminalId);
    }
  };

  const handleTerminalExit = (terminalId: string) => {
    markTerminalExited(terminalId);
  };

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header with terminal instance tabs */}
      <div className="flex items-center gap-1 px-2 py-0.5 border-b bg-muted/20 shrink-0">
        {/* Terminal tabs */}
        <div role="tablist" aria-label="Terminal tabs" className="flex items-center gap-1 flex-1 min-w-0 overflow-x-auto">
          {instances.map((terminal) => (
            <button
              key={terminal.id}
              id={`terminal-tab-${terminal.id}`}
              role="tab"
              aria-selected={activeId === terminal.id}
              aria-label={`Terminal ${terminal.slotNumber}${terminal.status === 'exited' ? ' (exited)' : ''}`}
              aria-controls={`terminal-panel-${terminal.id}`}
              tabIndex={activeId === terminal.id ? 0 : -1}
              onClick={() => currentSessionId && setActiveTerminal(currentSessionId, terminal.id)}
              className={cn(
                'flex items-center gap-1 px-2 py-1 text-xs rounded-sm shrink-0',
                'hover:bg-surface-2 transition-colors',
                activeId === terminal.id
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground'
              )}
            >
              <span>Terminal {terminal.slotNumber}</span>
              {terminal.status === 'exited' && (
                <span className="text-2xs text-text-warning">(exited)</span>
              )}
              <span
                role="button"
                tabIndex={-1}
                aria-label={`Close Terminal ${terminal.slotNumber}`}
                onClick={(e) => handleCloseTerminal(terminal.id, e)}
              >
                <X className="h-3 w-3 hover:text-destructive" />
              </span>
            </button>
          ))}

          {/* Add terminal button */}
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 shrink-0"
            onClick={handleCreateTerminal}
            disabled={!canCreateMore || !currentSessionId}
            title={canCreateMore ? 'New terminal' : 'Maximum 5 terminals'}
            aria-label={canCreateMore ? 'New terminal' : 'Maximum 5 terminals'}
          >
            <Plus className="h-3 w-3" />
          </Button>
        </div>

      </div>

      {/* Terminal content - render ALL sessions' terminals for persistence */}
      <div className="flex-1 min-h-0 relative bg-background">
        {currentSessionId && instances.length === 0 && (
          <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
            Click + to create a terminal
          </div>
        )}

        {/* Render terminals for EVERY session that has instances - CSS controls visibility */}
        {Object.entries(allInstances).map(([sessionId, sessionTerminals]) =>
          sessionTerminals.map((terminal) => {
            const isCurrentSession = sessionId === currentSessionId;
            const isActiveTab = allActiveIds[sessionId] === terminal.id;
            const isVisible = isCurrentSession && isActiveTab;

            return (
              <div
                key={terminal.id}
                id={`terminal-panel-${terminal.id}`}
                role="tabpanel"
                aria-labelledby={`terminal-tab-${terminal.id}`}
                className={cn(
                  'absolute inset-0 bg-background',
                  isVisible ? 'block' : 'hidden'
                )}
              >
                <ErrorBoundary
                  section="TerminalTab"
                  fallback={<BlockErrorFallback title="Terminal error" description="This terminal encountered an error" />}
                >
                  <Terminal
                    sessionId={terminal.id}
                    workspacePath={terminal.workspacePath}
                    onExit={() => handleTerminalExit(terminal.id)}
                  />
                </ErrorBoundary>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
