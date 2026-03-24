'use client';

import { useCallback, useEffect, useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Terminal, FileEdit, Globe, Search, Wrench } from 'lucide-react';
import { useAppStore } from '@/stores/appStore';
import { approveTool } from '@/lib/api/conversations';

const TIMEOUT_MS = 55_000; // 55s — 5s before agent-runner's 60s timeout so our deny arrives first

function getActionVerb(toolName: string): string {
  switch (toolName) {
    case 'Bash':
      return 'Run';
    case 'Write':
      return 'Write';
    case 'Edit':
    case 'NotebookEdit':
      return 'Edit';
    case 'WebFetch':
      return 'Fetch';
    case 'WebSearch':
      return 'Search';
    default:
      return 'Use';
  }
}

function getToolIcon(toolName: string) {
  switch (toolName) {
    case 'Bash':
      return <Terminal className="h-4 w-4 inline-block align-text-bottom mr-1" />;
    case 'Write':
    case 'Edit':
    case 'NotebookEdit':
      return <FileEdit className="h-4 w-4 inline-block align-text-bottom mr-1" />;
    case 'WebFetch':
      return <Globe className="h-4 w-4 inline-block align-text-bottom mr-1" />;
    case 'WebSearch':
      return <Search className="h-4 w-4 inline-block align-text-bottom mr-1" />;
    default:
      return <Wrench className="h-4 w-4 inline-block align-text-bottom mr-1" />;
  }
}

function getHeaderSummary(toolName: string, toolInput: Record<string, unknown>): string {
  switch (toolName) {
    case 'Bash':
      return (toolInput.command as string) || 'shell command';
    case 'Write':
    case 'Edit':
    case 'NotebookEdit':
      return (toolInput.file_path as string) || 'file';
    case 'WebFetch':
      return (toolInput.url as string) || 'URL';
    case 'WebSearch':
      return (toolInput.query as string) || 'web search';
    default:
      return toolName;
  }
}

function getDescription(toolName: string, toolInput: Record<string, unknown>): string | null {
  switch (toolName) {
    case 'Bash':
      return (toolInput.description as string) || null;
    case 'Write':
    case 'Edit':
    case 'NotebookEdit':
      return (toolInput.file_path as string) || null;
    case 'WebFetch':
      return (toolInput.url as string) || null;
    default:
      return null;
  }
}

function ReadOnlyPreview({ toolName, toolInput }: { toolName: string; toolInput: Record<string, unknown> }) {
  if (toolName === 'Write' || toolName === 'Edit') {
    return (
      <div className="space-y-1.5">
        <div className="text-xs text-muted-foreground font-mono">{(toolInput.file_path as string) || ''}</div>
        {typeof toolInput.old_string === 'string' && (
          <pre className="p-3 rounded-lg border border-border bg-muted/30 text-xs font-mono overflow-x-auto max-h-32 whitespace-pre-wrap break-all">
            {`- ${(toolInput.old_string as string).slice(0, 300)}\n+ ${((toolInput.new_string as string) || '').slice(0, 300)}`}
          </pre>
        )}
        {typeof toolInput.content === 'string' && !toolInput.old_string && (
          <pre className="p-3 rounded-lg border border-border bg-muted/30 text-xs font-mono overflow-x-auto max-h-32 whitespace-pre-wrap break-all">
            {(toolInput.content as string).slice(0, 500)}
          </pre>
        )}
      </div>
    );
  }

  if (toolName === 'WebFetch') {
    return (
      <div className="text-xs text-muted-foreground font-mono p-3 rounded-lg border border-border bg-muted/30">
        {(toolInput.url as string) || ''}
      </div>
    );
  }

  // Generic: show JSON
  return (
    <pre className="p-3 rounded-lg border border-border bg-muted/30 text-xs font-mono overflow-x-auto max-h-32 whitespace-pre-wrap break-all">
      {JSON.stringify(toolInput, null, 2).slice(0, 500)}
    </pre>
  );
}

interface ToolApprovalPromptProps {
  conversationId: string;
}

export function ToolApprovalPrompt({ conversationId }: ToolApprovalPromptProps) {
  const streamingState = useAppStore((s) => s.streamingState[conversationId]);
  const clearPendingToolApproval = useAppStore((s) => s.clearPendingToolApproval);
  const pending = streamingState?.pendingToolApproval;

  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [editedCommand, setEditedCommand] = useState('');
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoDeniedRef = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const handleActionRef = useRef<(action: 'allow_once' | 'allow_session' | 'allow_always' | 'deny_once' | 'deny_always') => void>(() => {});

  const isBash = pending?.toolName === 'Bash';

  // Reset state when a new request arrives (render-time adjustment — not an effect)
  const [prevRequestId, setPrevRequestId] = useState<string>();
  if (pending?.requestId !== prevRequestId) {
    setPrevRequestId(pending?.requestId);
    if (pending) {
      setSubmitting(false);
      setError(null);
      setElapsed(0);
      if (pending.toolName === 'Bash') {
        setEditedCommand((pending.toolInput.command as string) || '');
      }
    }
  }

  // Reset autoDeniedRef when request changes (refs must be updated in effects, not during render)
  useEffect(() => {
    if (pending) {
      autoDeniedRef.current = false;
    }
  }, [pending?.requestId, pending]);

  // Auto-focus textarea for Bash commands
  useEffect(() => {
    if (isBash && textareaRef.current) {
      textareaRef.current.focus();
      // Move cursor to end
      const len = textareaRef.current.value.length;
      textareaRef.current.setSelectionRange(len, len);
    }
  }, [isBash, pending?.requestId]);

  const handleAction = useCallback(async (action: 'allow_once' | 'allow_session' | 'allow_always' | 'deny_once' | 'deny_always') => {
    if (!pending || submitting) return;
    setSubmitting(true);
    try {
      setError(null);
      // Build updatedInput if user edited the Bash command
      let updatedInput: Record<string, unknown> | undefined;
      if (isBash && action.startsWith('allow') && editedCommand !== (pending.toolInput.command as string)) {
        updatedInput = { ...pending.toolInput, command: editedCommand };
      }
      await approveTool(conversationId, pending.requestId, action, pending.specifier, updatedInput);
      clearPendingToolApproval(conversationId);
    } catch (err) {
      setSubmitting(false);
      setError(err instanceof Error ? err.message : 'Failed to send tool approval');
    }
  }, [conversationId, pending, clearPendingToolApproval, submitting, isBash, editedCommand]);

  // Keep ref in sync so the interval callback always has the latest handleAction
  useEffect(() => {
    handleActionRef.current = handleAction;
  }, [handleAction]);

  // Progress bar timer + auto-deny on timeout
  useEffect(() => {
    if (!pending) return;
    const startTime = pending.timestamp;
    timerRef.current = setInterval(() => {
      const now = Date.now() - startTime;
      setElapsed(now);
      if (now >= TIMEOUT_MS && !autoDeniedRef.current) {
        autoDeniedRef.current = true;
        handleActionRef.current('deny_once');
      }
    }, 200);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [pending]);

  // Keyboard shortcuts
  useEffect(() => {
    if (!pending) return;

    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        handleAction('deny_once');
        return;
      }

      // Cmd/Ctrl+Enter = Allow for session
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handleAction('allow_session');
        return;
      }

      // Plain Enter = Allow once (but NOT inside textarea — textarea needs Enter for newlines)
      const target = e.target as HTMLElement;
      const isTextarea = target.tagName === 'TEXTAREA';
      if (e.key === 'Enter' && !e.shiftKey && !isTextarea) {
        e.preventDefault();
        handleAction('allow_once');
      }
    };

    window.addEventListener('keydown', handler, { capture: true });
    return () => window.removeEventListener('keydown', handler, { capture: true });
  }, [pending, handleAction]);

  if (!pending) return null;

  const progressPct = Math.min(100, (elapsed / TIMEOUT_MS) * 100);
  const verb = getActionVerb(pending.toolName);
  const summary = getHeaderSummary(pending.toolName, pending.toolInput);
  const description = getDescription(pending.toolName, pending.toolInput);

  return (
    <div className="pt-1 px-3 pb-3">
      <div className="relative rounded-xl border border-border bg-card dark:bg-input overflow-hidden">
        {/* Header */}
        <div className="px-5 pt-4 pb-2">
          <p className="text-base leading-relaxed">
            {getToolIcon(pending.toolName)}
            Allow Claude to <strong>{verb}</strong>{' '}
            <span className="text-muted-foreground font-mono text-sm break-all">
              {summary.length > 120 ? summary.slice(0, 117) + '...' : summary}
            </span>
            ?
          </p>
          {description && description !== summary && (
            <p className="text-sm text-muted-foreground mt-1">{description}</p>
          )}
        </div>

        {/* Editable command area (Bash) or read-only preview (other tools) */}
        <div className="px-5 pb-3">
          {isBash ? (
            <textarea
              ref={textareaRef}
              className="w-full rounded-lg border border-border bg-muted/30 p-3 text-sm font-mono resize-none overflow-auto focus:outline-none focus:ring-1 focus:ring-ring max-h-40"
              value={editedCommand}
              onChange={(e) => setEditedCommand(e.target.value)}
              rows={Math.min(6, Math.max(1, editedCommand.split('\n').length))}
              spellCheck={false}
            />
          ) : (
            <ReadOnlyPreview toolName={pending.toolName} toolInput={pending.toolInput} />
          )}
        </div>

        {/* Timeout progress bar */}
        <div className="h-0.5 bg-muted">
          <div
            className="h-full bg-orange-500/60 transition-all duration-200"
            style={{ width: `${100 - progressPct}%` }}
          />
        </div>

        {/* Footer: action buttons */}
        <div className="flex items-center justify-end gap-2 px-5 py-3">
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs"
            disabled={submitting}
            onClick={() => handleAction('deny_once')}
          >
            Deny
            <kbd className="ml-1.5 px-1 py-0.5 rounded bg-muted text-2xs font-mono">Esc</kbd>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-xs"
            disabled={submitting}
            onClick={() => handleAction('allow_once')}
          >
            Allow once
            <kbd className="ml-1.5 px-1 py-0.5 rounded bg-muted text-2xs font-mono">↵</kbd>
          </Button>
          <Button
            size="sm"
            className="h-8 text-xs font-semibold bg-foreground text-background hover:bg-foreground/80"
            disabled={submitting}
            onClick={() => handleAction('allow_session')}
          >
            Allow for session
            <kbd className="ml-1.5 px-1 py-0.5 rounded bg-background/20 text-background text-2xs font-mono">⌘↵</kbd>
          </Button>
        </div>

        {error && (
          <div className="px-5 pb-3 text-xs text-destructive">{error}</div>
        )}
      </div>
    </div>
  );
}
