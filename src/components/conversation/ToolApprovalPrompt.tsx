'use client';

import { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { useAppStore } from '@/stores/appStore';
import { approveTool, approveBatchTools } from '@/lib/api/conversations';
import { FileDiff, parseDiffFromFile, PIERRE_THEMES } from '@/lib/pierre';
import type { FileContents } from '@/lib/pierre';
import { useResolvedThemeType } from '@/hooks/useResolvedThemeType';
import { getShikiLanguage } from '@/lib/languageMapping';
import { useApprovalTimer, useApprovalKeyboard, type ApprovalAction } from '@/hooks/useApprovalPrompt';
import { Terminal, FilePlus2, Pencil, Globe, Search, Wrench, Plug } from 'lucide-react';

const MAX_PREVIEW_LINES = 200;

const ensureTrailingNewline = (s: string) => s.endsWith('\n') ? s : s + '\n';

function ToolIcon({ toolName, className }: { toolName: string; className?: string }) {
  switch (toolName) {
    case 'Bash':
      return <Terminal className={className} />;
    case 'Write':
      return <FilePlus2 className={className} />;
    case 'Edit':
    case 'NotebookEdit':
      return <Pencil className={className} />;
    case 'WebFetch':
      return <Globe className={className} />;
    case 'WebSearch':
      return <Search className={className} />;
    default:
      if (toolName.startsWith('mcp__')) return <Plug className={className} />;
      return <Wrench className={className} />;
  }
}

function getToolLabel(toolName: string): string {
  switch (toolName) {
    case 'Bash':
      return 'Run command';
    case 'Write':
      return 'Write file';
    case 'Edit':
    case 'NotebookEdit':
      return 'Edit file';
    case 'WebFetch':
      return 'Fetch URL';
    case 'WebSearch':
      return 'Search web';
    default:
      return `Use ${toolName}`;
  }
}

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

function getTargetName(toolName: string, toolInput: Record<string, unknown>): string {
  switch (toolName) {
    case 'Write':
    case 'Edit':
    case 'NotebookEdit': {
      const filePath = (toolInput.file_path as string) || 'file';
      return filePath.split('/').pop() || filePath;
    }
    case 'Bash': {
      const cmd = (toolInput.command as string) || 'shell command';
      return cmd.length > 60 ? cmd.slice(0, 57) + '...' : cmd;
    }
    case 'WebFetch': {
      const url = (toolInput.url as string) || 'URL';
      return url.length > 80 ? url.slice(0, 77) + '...' : url;
    }
    case 'WebSearch':
      return (toolInput.query as string) || 'web search';
    default:
      return toolName;
  }
}

function getSubtitle(toolName: string, toolInput: Record<string, unknown>): string | null {
  switch (toolName) {
    case 'Write':
    case 'Edit':
    case 'NotebookEdit':
      return (toolInput.file_path as string) || null;
    case 'Bash':
      return (toolInput.description as string) || null;
    case 'WebFetch':
      return (toolInput.url as string) || null;
    case 'WebSearch':
      return (toolInput.query as string) || null;
    default:
      return null;
  }
}

function truncateContent(content: string, maxLines: number): { text: string; truncated: boolean; totalLines: number } {
  const lines = content.split('\n');
  if (lines.length <= maxLines) return { text: content, truncated: false, totalLines: lines.length };
  return { text: lines.slice(0, maxLines).join('\n'), truncated: true, totalLines: lines.length };
}

function ApprovalDiffPreview({ toolName, toolInput }: { toolName: string; toolInput: Record<string, unknown> }) {
  const themeType = useResolvedThemeType();

  const diffData = useMemo(() => {
    if (toolName === 'Write' && typeof toolInput.content === 'string') {
      const filePath = (toolInput.file_path as string) || 'file';
      const filename = filePath.split('/').pop() || filePath;
      const language = getShikiLanguage(filename);
      const { text, truncated, totalLines } = truncateContent(toolInput.content as string, MAX_PREVIEW_LINES);

      const oldFile: FileContents = {
        name: filename,
        contents: '',
        lang: language as FileContents['lang'],
        cacheKey: `approval-write-old:${filePath}`,
      };
      const newFile: FileContents = {
        name: filename,
        contents: ensureTrailingNewline(text),
        lang: language as FileContents['lang'],
        cacheKey: `approval-write-new:${filePath}:${text.length}:${text.slice(0, 64)}`,
      };
      return { fileDiff: parseDiffFromFile(oldFile, newFile), truncated, totalLines };
    }

    if (toolName === 'Edit' && typeof toolInput.old_string === 'string') {
      const filePath = (toolInput.file_path as string) || 'file';
      const filename = filePath.split('/').pop() || filePath;
      const language = getShikiLanguage(filename);
      const oldStr = toolInput.old_string as string;
      const newStr = (toolInput.new_string as string) || '';

      const oldFile: FileContents = {
        name: filename,
        contents: ensureTrailingNewline(oldStr),
        lang: language as FileContents['lang'],
        cacheKey: `approval-edit-old:${filePath}:${oldStr.length}:${oldStr.slice(0, 64)}`,
      };
      const newFile: FileContents = {
        name: filename,
        contents: ensureTrailingNewline(newStr),
        lang: language as FileContents['lang'],
        cacheKey: `approval-edit-new:${filePath}:${newStr.length}:${newStr.slice(0, 64)}`,
      };
      return { fileDiff: parseDiffFromFile(oldFile, newFile), truncated: false, totalLines: 0 };
    }

    return null;
  }, [toolName, toolInput]);

  const options = useMemo(() => ({
    theme: PIERRE_THEMES,
    themeType,
    diffStyle: 'unified' as const,
    overflow: 'scroll' as const,
    diffIndicators: 'bars' as const,
    lineDiffType: 'word' as const,
    tokenizeMaxLineLength: 500,
  }), [themeType]);

  // Write/Edit with diff rendering
  if (diffData) {
    return (
      <div>
        <div className="max-h-[250px] overflow-auto overscroll-contain rounded-lg border">
          <FileDiff fileDiff={diffData.fileDiff} options={options} />
        </div>
        {diffData.truncated && (
          <p className="text-xs text-muted-foreground mt-1.5 px-1">
            Showing {MAX_PREVIEW_LINES} of {diffData.totalLines} lines
          </p>
        )}
      </div>
    );
  }

  // Write without content (shouldn't happen, but fallback)
  if (toolName === 'Write' || toolName === 'Edit') {
    return (
      <pre className="p-3 rounded-lg border border-border bg-muted/30 text-xs font-mono overflow-x-auto max-h-32 whitespace-pre-wrap break-all">
        {JSON.stringify(toolInput, null, 2).slice(0, 500)}
      </pre>
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

interface BatchToolApprovalPromptProps {
  conversationId: string;
}

export function ToolApprovalPrompt({ conversationId }: ToolApprovalPromptProps) {
  const streamingState = useAppStore((s) => s.streamingState[conversationId]);
  const clearPendingToolApproval = useAppStore((s) => s.clearPendingToolApproval);
  const pending = streamingState?.pendingToolApproval;

  const [error, setError] = useState<string | null>(null);
  const [editedCommand, setEditedCommand] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Reset edited command and error when request changes — render-time
  // derivation to avoid react-hooks/set-state-in-effect.
  const [prevSingleRequestId, setPrevSingleRequestId] = useState<string>();
  if (pending?.requestId !== prevSingleRequestId) {
    setPrevSingleRequestId(pending?.requestId);
    if (pending) {
      if (pending.toolName === 'Bash') {
        setEditedCommand((pending.toolInput.command as string) || '');
      }
      setError(null);
    }
  }

  const isBash = pending?.toolName === 'Bash';

  // Timer + auto-deny: declared before handleAction so submittingRef/setSubmitting
  // are available in handleAction's closure without a forward-reference.
  // useApprovalTimer captures onAction via an internal ref that syncs each render,
  // so passing handleAction (defined below) works: on first render the ref holds the
  // initial closure, and subsequent renders update it.
  const handleActionRef = useRef<(action: ApprovalAction) => void>(() => {});
  const { progressPct, submitting, setSubmitting, submittingRef } = useApprovalTimer(
    pending?.requestId,
    useCallback((action: ApprovalAction) => handleActionRef.current(action), []),
  );

  const handleAction = useCallback(async (action: ApprovalAction) => {
    if (!pending || submittingRef.current) return;
    setSubmitting(true);
    submittingRef.current = true;
    try {
      setError(null);
      let updatedInput: Record<string, unknown> | undefined;
      if (isBash && action.startsWith('allow') && editedCommand !== (pending.toolInput.command as string)) {
        updatedInput = { ...pending.toolInput, command: editedCommand };
      }
      await approveTool(conversationId, pending.requestId, action, pending.specifier, updatedInput);
      clearPendingToolApproval(conversationId);
    } catch (err) {
      setSubmitting(false);
      submittingRef.current = false;
      setError(err instanceof Error ? err.message : 'Failed to send tool approval');
    }
  }, [conversationId, pending, clearPendingToolApproval, isBash, editedCommand, submittingRef, setSubmitting]);
  useEffect(() => { handleActionRef.current = handleAction; }, [handleAction]);

  // Auto-focus textarea for Bash commands
  useEffect(() => {
    if (isBash && textareaRef.current) {
      textareaRef.current.focus();
      const len = textareaRef.current.value.length;
      textareaRef.current.setSelectionRange(len, len);
    }
  }, [isBash, pending?.requestId]);

  // Shared keyboard shortcuts (skip Enter action inside the Bash command textarea)
  useApprovalKeyboard(!!pending, handleAction, { skipEnterInTextarea: true });

  if (!pending) return null;

  const toolLabel = getToolLabel(pending.toolName);
  const subtitle = getSubtitle(pending.toolName, pending.toolInput);
  const showPreview = pending.toolName !== 'WebSearch';

  return (
    <div className="pt-1 px-3 pb-3">
      <div className="relative rounded-xl border border-border bg-card dark:bg-input overflow-hidden">
        {/* Header */}
        <div className="flex items-start gap-3 px-5 pt-4 pb-2">
          <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-muted/50 shrink-0 mt-0.5">
            <ToolIcon toolName={pending.toolName} className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-foreground leading-snug">
              {toolLabel}
            </p>
            {subtitle && (
              <p className="text-xs text-muted-foreground font-mono mt-0.5 truncate">{subtitle}</p>
            )}
          </div>
        </div>

        {/* Content preview */}
        {showPreview && (
          <div className="px-5 pb-2">
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
              <ApprovalDiffPreview toolName={pending.toolName} toolInput={pending.toolInput} />
            )}
          </div>
        )}

        {/* Timeout progress bar */}
        <div className="h-1 mx-5 mb-1 rounded-full bg-muted/60 overflow-hidden">
          <div
            className="h-full rounded-full bg-orange-500/70 transition-all duration-200 ease-linear"
            style={{ width: `${100 - progressPct}%` }}
          />
        </div>

        {/* Footer: action buttons */}
        <div className="flex items-center justify-between px-5 py-3">
          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-xs text-muted-foreground"
            disabled={submitting}
            onClick={() => handleAction('deny_once')}
          >
            Deny
            <kbd className="ml-1.5 px-1 py-0.5 rounded bg-muted text-2xs font-mono">Esc</kbd>
          </Button>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              disabled={submitting}
              onClick={() => handleAction('allow_session')}
            >
              Always allow
              <kbd className="ml-1.5 px-1 py-0.5 rounded bg-muted text-2xs font-mono">⌘↵</kbd>
            </Button>
            <Button
              size="sm"
              className="h-8 text-xs font-semibold bg-foreground text-background hover:bg-foreground/80"
              disabled={submitting}
              onClick={() => handleAction('allow_once')}
            >
              Allow
              <kbd className="ml-1.5 px-1 py-0.5 rounded bg-background/20 text-background text-2xs font-mono">↵</kbd>
            </Button>
          </div>
        </div>

        {error && (
          <div className="px-5 pb-3 text-xs text-destructive">{error}</div>
        )}
      </div>
    </div>
  );
}

export function BatchToolApprovalPrompt({ conversationId }: BatchToolApprovalPromptProps) {
  const streamingState = useAppStore((s) => s.streamingState[conversationId]);
  const clearPendingBatchToolApproval = useAppStore((s) => s.clearPendingBatchToolApproval);
  const pending = streamingState?.pendingBatchToolApproval;

  const [error, setError] = useState<string | null>(null);

  // Reset error when request changes — render-time derivation to
  // avoid react-hooks/set-state-in-effect.
  const [prevBatchRequestId, setPrevBatchRequestId] = useState<string>();
  if (pending?.requestId !== prevBatchRequestId) {
    setPrevBatchRequestId(pending?.requestId);
    if (pending) setError(null);
  }

  // Timer + auto-deny: declared before handleAction so submittingRef/setSubmitting
  // are available in handleAction's closure without a forward-reference.
  const handleActionRef = useRef<(action: ApprovalAction) => void>(() => {});
  const { progressPct, submitting, setSubmitting, submittingRef } = useApprovalTimer(
    pending?.requestId,
    useCallback((action: ApprovalAction) => handleActionRef.current(action), []),
  );

  const handleAction = useCallback(async (action: ApprovalAction) => {
    if (!pending || submittingRef.current) return;
    setSubmitting(true);
    submittingRef.current = true;
    try {
      setError(null);
      await approveBatchTools(conversationId, pending.requestId, action);
      clearPendingBatchToolApproval(conversationId);
    } catch (err) {
      setSubmitting(false);
      submittingRef.current = false;
      setError(err instanceof Error ? err.message : 'Failed to send batch tool approval');
    }
  }, [conversationId, pending, clearPendingBatchToolApproval, submittingRef, setSubmitting]);
  useEffect(() => { handleActionRef.current = handleAction; }, [handleAction]);

  // Shared keyboard shortcuts (no textarea — Enter always triggers allow)
  useApprovalKeyboard(!!pending, handleAction, { skipEnterInTextarea: false });

  if (!pending) return null;

  return (
    <div className="pt-1 px-3 pb-3">
      <div className="relative rounded-xl border border-border bg-card dark:bg-input overflow-hidden">
        {/* Header */}
        <div className="px-5 pt-4 pb-2">
          <p className="text-sm font-semibold text-foreground leading-snug">
            Run {pending.items.length} tools
          </p>
        </div>

        {/* Tool list */}
        <div className="px-5 pb-2 space-y-1">
          {pending.items.map((item) => {
            const verb = getActionVerb(item.toolName);
            const target = getTargetName(item.toolName, item.toolInput);
            return (
              <div key={item.toolUseId} className="flex items-center gap-2.5 py-1 text-xs">
                <ToolIcon toolName={item.toolName} className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <span className="font-medium">{verb}</span>
                <span className="text-muted-foreground font-mono truncate">{target}</span>
              </div>
            );
          })}
        </div>

        {/* Timeout progress bar */}
        <div className="h-1 mx-5 mb-1 rounded-full bg-muted/60 overflow-hidden">
          <div
            className="h-full rounded-full bg-orange-500/70 transition-all duration-200 ease-linear"
            style={{ width: `${100 - progressPct}%` }}
          />
        </div>

        {/* Footer: action buttons */}
        <div className="flex items-center justify-between px-5 py-3">
          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-xs text-muted-foreground"
            disabled={submitting}
            onClick={() => handleAction('deny_once')}
          >
            Deny all
            <kbd className="ml-1.5 px-1 py-0.5 rounded bg-muted text-2xs font-mono">Esc</kbd>
          </Button>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              disabled={submitting}
              onClick={() => handleAction('allow_session')}
            >
              Always allow
              <kbd className="ml-1.5 px-1 py-0.5 rounded bg-muted text-2xs font-mono">⌘↵</kbd>
            </Button>
            <Button
              size="sm"
              className="h-8 text-xs font-semibold bg-foreground text-background hover:bg-foreground/80"
              disabled={submitting}
              onClick={() => handleAction('allow_once')}
            >
              Allow all
              <kbd className="ml-1.5 px-1 py-0.5 rounded bg-background/20 text-background text-2xs font-mono">↵</kbd>
            </Button>
          </div>
        </div>

        {error && (
          <div className="px-5 pb-3 text-xs text-destructive">{error}</div>
        )}
      </div>
    </div>
  );
}
