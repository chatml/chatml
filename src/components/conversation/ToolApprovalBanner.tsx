import { useCallback, useEffect, useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Shield, ShieldAlert, Terminal, FileEdit, Globe, Wrench } from 'lucide-react';
import { useAppStore } from '@/stores/appStore';
import { approveTool } from '@/lib/api/conversations';

const TIMEOUT_MS = 60_000; // 60 seconds

function getToolIcon(toolName: string) {
  switch (toolName) {
    case 'Bash':
      return <Terminal className="h-4 w-4" />;
    case 'Write':
    case 'Edit':
    case 'NotebookEdit':
      return <FileEdit className="h-4 w-4" />;
    case 'WebFetch':
      return <Globe className="h-4 w-4" />;
    default:
      return <Wrench className="h-4 w-4" />;
  }
}

function getToolSummary(toolName: string, toolInput: Record<string, unknown>): string {
  switch (toolName) {
    case 'Bash':
      return (toolInput.command as string) || 'shell command';
    case 'Write':
    case 'Edit':
      return (toolInput.file_path as string) || 'file modification';
    case 'Read':
      return (toolInput.file_path as string) || 'file read';
    case 'WebFetch':
      return (toolInput.url as string) || 'web request';
    default:
      return toolName;
  }
}

function ToolInputPreview({ toolName, toolInput }: { toolName: string; toolInput: Record<string, unknown> }) {
  if (toolName === 'Bash') {
    return (
      <pre className="mt-1.5 p-2 rounded bg-muted text-xs font-mono overflow-x-auto max-h-24 whitespace-pre-wrap break-all">
        {(toolInput.command as string) || ''}
      </pre>
    );
  }

  if (toolName === 'Write' || toolName === 'Edit') {
    return (
      <div className="mt-1.5 text-xs text-muted-foreground">
        <span className="font-mono">{(toolInput.file_path as string) || ''}</span>
        {typeof toolInput.old_string === 'string' && (
          <pre className="mt-1 p-2 rounded bg-muted font-mono overflow-x-auto max-h-20 whitespace-pre-wrap break-all">
            {`- ${(toolInput.old_string as string).slice(0, 200)}\n+ ${((toolInput.new_string as string) || '').slice(0, 200)}`}
          </pre>
        )}
        {typeof toolInput.content === 'string' && !toolInput.old_string && (
          <pre className="mt-1 p-2 rounded bg-muted font-mono overflow-x-auto max-h-20 whitespace-pre-wrap break-all">
            {(toolInput.content as string).slice(0, 500)}
          </pre>
        )}
      </div>
    );
  }

  if (toolName === 'WebFetch') {
    return (
      <div className="mt-1.5 text-xs text-muted-foreground font-mono">
        {(toolInput.url as string) || ''}
      </div>
    );
  }

  // Generic: show JSON
  return (
    <pre className="mt-1.5 p-2 rounded bg-muted text-xs font-mono overflow-x-auto max-h-24 whitespace-pre-wrap break-all">
      {JSON.stringify(toolInput, null, 2).slice(0, 500)}
    </pre>
  );
}

interface ToolApprovalBannerProps {
  conversationId: string;
}

export function ToolApprovalBanner({ conversationId }: ToolApprovalBannerProps) {
  const streamingState = useAppStore((s) => s.streamingState[conversationId]);
  const clearPendingToolApproval = useAppStore((s) => s.clearPendingToolApproval);
  const pending = streamingState?.pendingToolApproval;

  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoDeniedRef = useRef(false);

  // Reset guards when a new request arrives
  useEffect(() => {
    autoDeniedRef.current = false;
    setSubmitting(false);
  }, [pending?.requestId]);

  // Progress bar timer
  useEffect(() => {
    if (!pending) {
      setElapsed(0);
      return;
    }
    const startTime = pending.timestamp;
    timerRef.current = setInterval(() => {
      const now = Date.now();
      setElapsed(now - startTime);
    }, 200);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [pending]);

  // Auto-deny on timeout (guarded to prevent retry loop on API failure)
  useEffect(() => {
    if (!pending || elapsed < TIMEOUT_MS || autoDeniedRef.current) return;
    autoDeniedRef.current = true;
    handleAction('deny_once');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elapsed, pending]);

  const handleAction = useCallback(async (action: 'allow_once' | 'allow_session' | 'allow_always' | 'deny_once' | 'deny_always') => {
    if (!pending || submitting) return;
    setSubmitting(true);
    try {
      setError(null);
      await approveTool(conversationId, pending.requestId, action, pending.specifier);
      clearPendingToolApproval(conversationId);
    } catch (err) {
      setSubmitting(false);
      setError(err instanceof Error ? err.message : 'Failed to send tool approval');
    }
  }, [conversationId, pending, clearPendingToolApproval, submitting]);

  // Keyboard shortcuts — only active when no editable element is focused.
  // Uses closest('[data-slate-editor]') to detect the Plate rich-text editor
  // in addition to standard INPUT/TEXTAREA/contentEditable checks.
  useEffect(() => {
    if (!pending) return;

    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isEditable = target.tagName === 'INPUT'
        || target.tagName === 'TEXTAREA'
        || target.isContentEditable
        || target.closest?.('[data-slate-editor]') != null;

      if (isEditable) {
        // Only handle Escape in editable areas
        if (e.key === 'Escape') {
          e.preventDefault();
          handleAction('deny_once');
        }
        return;
      }

      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handleAction('allow_always'); // Allow for entire session
      } else if (e.key === 'Enter' && e.shiftKey) {
        e.preventDefault();
        handleAction('allow_once');
      } else if (e.key === 'Escape') {
        e.preventDefault();
        handleAction('deny_once');
      }
    };

    window.addEventListener('keydown', handler, { capture: true });
    return () => window.removeEventListener('keydown', handler, { capture: true });
  }, [pending, handleAction]);

  if (!pending) return null;

  const progressPct = Math.min(100, (elapsed / TIMEOUT_MS) * 100);

  return (
    <div className="space-y-1.5 mb-2">
      {/* Timeout progress bar */}
      <div className="h-0.5 bg-muted rounded-full overflow-hidden">
        <div
          className="h-full bg-orange-500 transition-all duration-200"
          style={{ width: `${100 - progressPct}%` }}
        />
      </div>

      {/* Tool info */}
      <div className="flex items-start gap-2 text-sm">
        <div className="flex items-center gap-1.5 text-orange-500 mt-0.5">
          <ShieldAlert className="h-4 w-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 font-medium">
            {getToolIcon(pending.toolName)}
            <span>{pending.toolName}</span>
            <span className="text-muted-foreground font-normal truncate">
              {getToolSummary(pending.toolName, pending.toolInput)}
            </span>
          </div>
          <ToolInputPreview toolName={pending.toolName} toolInput={pending.toolInput} />
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs text-destructive hover:text-destructive"
            disabled={submitting}
            onClick={() => handleAction('deny_once')}
          >
            Deny
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs text-destructive hover:text-destructive"
            disabled={submitting}
            onClick={() => handleAction('deny_always')}
          >
            Deny Session
          </Button>
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            disabled={submitting}
            onClick={() => handleAction('allow_once')}
          >
            Allow Once
            <kbd className="ml-1 px-1 py-0.5 rounded bg-muted text-2xs font-mono">⇧↵</kbd>
          </Button>
          <Button
            variant="secondary"
            size="sm"
            className="h-7 text-xs font-semibold bg-foreground text-background hover:bg-foreground/80"
            disabled={submitting}
            onClick={() => handleAction('allow_always')}
          >
            <Shield className="h-3.5 w-3.5 mr-1" />
            Allow Session
            <kbd className="ml-1 px-1 py-0.5 rounded bg-background/20 text-background text-2xs font-mono">⌘↵</kbd>
          </Button>
        </div>
      </div>

      {error && (
        <div className="text-xs text-destructive">{error}</div>
      )}
    </div>
  );
}
