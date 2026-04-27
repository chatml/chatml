'use client';

import { useId, useState } from 'react';
import { AlertTriangle, RefreshCw, ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import type { LucideIcon } from 'lucide-react';

// Cap rendered error messages so a stringified HTML error page or a giant
// stack-as-message can't break the panel layout. The <pre> below also caps
// vertical size; this is the horizontal/character-count guard.
const MAX_ERROR_MESSAGE_CHARS = 1000;

interface InlineErrorFallbackProps {
  message?: string;
  className?: string;
}

/**
 * Compact inline error fallback for small components.
 * Displays a warning icon and short message.
 */
export function InlineErrorFallback({
  message = 'Unable to display content',
  className,
}: InlineErrorFallbackProps) {
  return (
    <div
      className={cn(
        'flex items-center gap-1.5 text-xs text-destructive/70',
        className
      )}
    >
      <AlertTriangle className="w-3 h-3 flex-shrink-0" />
      <span>{message}</span>
    </div>
  );
}

interface BlockErrorFallbackProps {
  icon?: LucideIcon;
  title?: string;
  description?: string;
  className?: string;
}

/**
 * Block-level error fallback for larger components like code viewers, diffs, editors.
 * Centers content with an icon, title, and optional description.
 */
export function BlockErrorFallback({
  icon: Icon = AlertTriangle,
  title = 'Something went wrong',
  description,
  className,
}: BlockErrorFallbackProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center h-full p-4 text-muted-foreground',
        className
      )}
    >
      <Icon className="w-8 h-8 mb-2 text-destructive/50" />
      <p className="text-sm font-medium">{title}</p>
      {description && (
        <p className="text-xs text-muted-foreground/70 mt-1">{description}</p>
      )}
    </div>
  );
}

interface PanelErrorFallbackProps {
  title?: string;
  description?: string;
  /** Underlying error to surface in the collapsible "Show details" section. */
  error?: Error | null;
  /** Retry handler — wired to ErrorBoundary's retry. Hides the button when omitted. */
  onRetry?: () => void;
  className?: string;
}

/**
 * Panel-shaped error fallback for tab content (Checks, Review, Files…).
 *
 * Larger and more informative than `BlockErrorFallback`: includes a retry
 * button (driven by the ErrorBoundary's retry callback) and a collapsible
 * error-details section so users can self-serve when the panel crashes.
 */
export function PanelErrorFallback({
  title = "Couldn't load this panel",
  description = 'Something prevented this view from rendering.',
  error,
  onRetry,
  className,
}: PanelErrorFallbackProps) {
  const [showDetails, setShowDetails] = useState(false);
  const detailsId = useId();
  const rawMessage = error?.message?.trim() ?? '';
  const message =
    rawMessage.length > MAX_ERROR_MESSAGE_CHARS
      ? `${rawMessage.slice(0, MAX_ERROR_MESSAGE_CHARS)}…`
      : rawMessage;

  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center h-full p-6 text-center',
        className
      )}
    >
      <AlertTriangle className="w-8 h-8 mb-2 text-destructive/50" />
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className="text-xs text-muted-foreground/80 mt-1.5 max-w-xs">{description}</p>

      {onRetry && (
        <Button
          variant="outline"
          size="sm"
          onClick={onRetry}
          className="gap-2 mt-4"
        >
          <RefreshCw />
          Try again
        </Button>
      )}

      {message && (
        <div className="mt-5 w-full max-w-md flex flex-col items-center">
          <button
            type="button"
            aria-expanded={showDetails}
            aria-controls={detailsId}
            onClick={() => setShowDetails((v) => !v)}
            className="flex items-center gap-1 text-2xs text-muted-foreground/70 hover:text-muted-foreground transition-colors rounded-sm outline-none focus-visible:ring-1 focus-visible:ring-ring/30"
          >
            {showDetails ? (
              <ChevronDown className="w-3 h-3" />
            ) : (
              <ChevronRight className="w-3 h-3" />
            )}
            <span>{showDetails ? 'Hide details' : 'Show details'}</span>
          </button>
          {showDetails && (
            <pre
              id={detailsId}
              className="mt-2 p-2 rounded-md bg-muted/50 border border-border text-xs font-mono text-muted-foreground whitespace-pre-wrap break-words max-h-40 overflow-auto text-left w-full"
            >
              {message}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

interface CardErrorFallbackProps {
  message?: string;
  className?: string;
}

/**
 * Card-shaped error fallback for list items like PRCard, SessionCard.
 * Maintains card layout structure while showing an error state.
 */
export function CardErrorFallback({
  message = 'Error loading item',
  className,
}: CardErrorFallbackProps) {
  return (
    <div
      className={cn(
        'border border-destructive/30 rounded-lg bg-card p-3',
        className
      )}
    >
      <div className="flex items-center gap-2 text-sm text-destructive/70">
        <AlertTriangle className="h-4 w-4 flex-shrink-0" />
        <span>{message}</span>
      </div>
    </div>
  );
}
