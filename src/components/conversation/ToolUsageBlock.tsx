'use client';

import { useState, useRef, useMemo, useCallback, memo, lazy, Suspense } from 'react';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  ChevronRight,
  ChevronDown,
  FileText,
  FilePlus2,
  Pencil,
  Terminal,
  FileSearch,
  FolderSearch2,
  Globe,
  FolderOpen,
  ClipboardCheck,
  ListTodo,
  Circle,
  Plug,
  type LucideIcon,
} from 'lucide-react';
import { cn, toRelativePath } from '@/lib/utils';
import { parseMcpToolName, formatToolDuration, stripCdPrefix } from '@/lib/format';
import { TOOL_TARGET_TRUNCATE, TOOL_COMMAND_TRUNCATE } from '@/lib/constants';
import { useAppStore } from '@/stores/appStore';
import { ErrorBoundary } from '@/components/shared/ErrorBoundary';
import { TodoToolDetail } from '@/components/conversation/tool-details/TodoToolDetail';
import { getMessage, toStoreMessage } from '@/lib/api';
import type { ToolMetadata } from '@/lib/types';

// Lazy-load heavy Pierre-based components (only loaded when user expands a tool block)
const EditToolDetail = lazy(() => import('@/components/conversation/tool-details/EditToolDetail').then(m => ({ default: m.EditToolDetail })));
const WriteToolDetail = lazy(() => import('@/components/conversation/tool-details/WriteToolDetail').then(m => ({ default: m.WriteToolDetail })));
const ReadToolDetail = lazy(() => import('@/components/conversation/tool-details/ReadToolDetail').then(m => ({ default: m.ReadToolDetail })));
const WorkspaceDiffDetail = lazy(() => import('@/components/conversation/tool-details/WorkspaceDiffDetail').then(m => ({ default: m.WorkspaceDiffDetail })));

interface ToolUsageBlockProps {
  id: string;
  tool: string;
  params?: Record<string, unknown>;
  worktreePath?: string;
  isActive?: boolean;
  success?: boolean;
  summary?: string;
  duration?: number;
  /** stdout from Bash command execution */
  stdout?: string;
  /** stderr from Bash command execution */
  stderr?: string;
  /** Elapsed seconds from tool_progress events (live update for active tools) */
  elapsedSeconds?: number;
  /** Structured metadata extracted from tool results */
  metadata?: ToolMetadata;
  /** For on-demand hydration of compact messages */
  conversationId?: string;
  /** For on-demand hydration of compact messages */
  messageId?: string;
  /** True when the parent message was loaded in compact mode */
  compacted?: boolean;
}

// Helper to calculate line stats for Edit tool
function calculateEditStats(params?: Record<string, unknown>): { additions: number; deletions: number } | null {
  if (!params) return null;

  const oldString = params.old_string as string | undefined;
  const newString = params.new_string as string | undefined;

  // Only calculate if we have at least one of the strings
  if (oldString === undefined && newString === undefined) return null;

  // Count lines in a string (number of newlines + 1 for non-empty, 0 for empty)
  const countLines = (s: string | undefined) => {
    if (!s) return 0;
    return s.split('\n').length;
  };

  const oldLines = countLines(oldString);
  const newLines = countLines(newString);

  return {
    additions: Math.max(0, newLines - oldLines),
    deletions: Math.max(0, oldLines - newLines),
  };
}

export const ToolUsageBlock = memo(function ToolUsageBlock({
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  id,
  tool,
  params,
  worktreePath,
  isActive = false,
  success,
  summary,
  duration,
  stdout,
  stderr,
  elapsedSeconds,
  metadata,
  conversationId,
  messageId,
  compacted,
}: ToolUsageBlockProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isHydrating, setIsHydrating] = useState(false);
  const isHydratingRef = useRef(false);

  // On-demand hydration: fetch full message when expanding a compact tool block.
  // Only triggers for messages loaded in compact mode; skips active (streaming) tools.
  const handleOpenChange = useCallback(async (open: boolean) => {
    setIsOpen(open);
    if (open && compacted && !isActive && conversationId && messageId && !isHydratingRef.current) {
      isHydratingRef.current = true;
      setIsHydrating(true);
      try {
        const fullMsg = await getMessage(conversationId, messageId);
        const storeMsg = toStoreMessage(fullMsg, conversationId);
        useAppStore.getState().hydrateMessage(conversationId, messageId, storeMsg);
      } catch (err) {
        console.warn('Failed to hydrate message:', err);
      } finally {
        isHydratingRef.current = false;
        setIsHydrating(false);
      }
    }
  }, [compacted, isActive, conversationId, messageId]);
  const mcpInfo = useMemo(() => parseMcpToolName(tool), [tool]);

  const ToolIcon = useMemo((): LucideIcon => {
    switch (tool) {
      case 'Read':
      case 'read_file':
        return FileText;
      case 'Write':
      case 'write_file':
        return FilePlus2;
      case 'Edit':
      case 'edit_file':
        return Pencil;
      case 'Bash':
      case 'bash':
      case 'execute_command':
        return Terminal;
      case 'Grep':
      case 'search':
        return FileSearch;
      case 'Glob':
        return FolderSearch2;
      case 'WebFetch':
      case 'WebSearch':
      case 'web':
        return Globe;
      case 'list_dir':
        return FolderOpen;
      case 'TodoWrite':
        return ListTodo;
      case 'ExitPlanMode':
        return ClipboardCheck;
      default:
        if (tool.startsWith('mcp__')) return Plug;
        return Terminal;
    }
  }, [tool]);

  const getToolLabel = () => {
    // Shorter, more concise labels
    switch (tool) {
      case 'Read':
      case 'read_file':
        return 'Read';
      case 'Write':
      case 'write_file':
        return 'Write';
      case 'Edit':
      case 'edit_file':
        return 'Edit';
      case 'Bash':
      case 'bash':
      case 'execute_command':
        return 'Run';
      case 'Grep':
        return 'Search';
      case 'Glob':
        return 'Find';
      case 'WebFetch':
        return 'Fetch';
      case 'WebSearch':
        return 'Search web';
      case 'list_dir':
        return 'List';
      case 'TodoWrite':
        return 'Update tasks';
      case 'ExitPlanMode':
        return isActive ? 'Propose Plan' : 'Exiting Plan mode';
      case 'Skill':
        return 'Loading Skill';
      default:
        return mcpInfo ? mcpInfo.displayLabel : tool;
    }
  };

  // Extract description from params (Bash tool provides this)
  const description = params?.description as string | undefined;

  // Check if this is a Bash tool
  const isBashTool = ['Bash', 'bash', 'execute_command'].includes(tool);

  // Check tool types for specialized rendering
  const isEditTool = ['Edit', 'edit_file'].includes(tool);
  const isWriteTool = ['Write', 'write_file'].includes(tool);
  const isReadTool = ['Read', 'read_file'].includes(tool);
  const isTodoTool = tool === 'TodoWrite';
  const isSkillTool = tool === 'Skill';
  const isWorkspaceDiffTool = tool === 'mcp__chatml__get_workspace_diff';

  const editStats = useMemo(() => {
    if (!isEditTool) return null;
    return calculateEditStats(params);
  }, [isEditTool, params]);

  const getTarget = () => {
    if (!params) return null;

    // Check file-path params first (these get worktree-relative conversion)
    const filePath =
      params.file_path ||
      params.path ||
      params.filepath ||
      params.filename ||
      params.file;

    if (typeof filePath === 'string') {
      return toRelativePath(filePath, worktreePath);
    }

    // Non-file params (commands, URLs, patterns, queries) — no path conversion
    const other =
      params.command ||
      params.url ||
      params.pattern ||
      params.query ||
      params.skill;

    if (typeof other === 'string') {
      return other;
    }

    // MCP tool fallback: try first short non-empty string parameter value
    if (tool.startsWith('mcp__')) {
      for (const value of Object.values(params)) {
        if (typeof value === 'string' && value.length > 0 && value.length < 200) {
          return value;
        }
      }
    }

    return null;
  };

  const rawTarget = getTarget();
  const fullTarget = rawTarget;
  const target = isBashTool && rawTarget ? stripCdPrefix(rawTarget) : rawTarget;

  // Truncate target for display
  const truncatedTarget = useMemo(() => {
    if (!target) return null;
    const limit = isBashTool ? TOOL_COMMAND_TRUNCATE : TOOL_TARGET_TRUNCATE;
    if (target.length > limit) {
      return target.slice(0, limit - 3) + '...';
    }
    return target;
  }, [target, isBashTool]);

  const isTargetTruncated = target && truncatedTarget && target !== truncatedTarget;

  // File tools with clickable paths (Read/Write/Edit)
  const isFileToolClickable = ['Read', 'Write', 'Edit', 'read_file', 'write_file', 'edit_file'].includes(tool);
  const fullFilePath = useMemo(() => {
    if (!isFileToolClickable || !params) return null;
    const filePath = params.file_path || params.path || params.filepath || params.filename || params.file;
    return typeof filePath === 'string' ? filePath : null;
  }, [isFileToolClickable, params]);

  const handleFileClick = useMemo(() => {
    if (!fullFilePath) return undefined;
    return (e: React.MouseEvent) => {
      e.stopPropagation();
      const state = useAppStore.getState();
      const workspaceId = state.selectedWorkspaceId;
      const sessionId = state.selectedSessionId;
      if (!workspaceId || !sessionId) return;
      const relativePath = toRelativePath(fullFilePath, worktreePath);
      const filename = relativePath.split('/').pop() || relativePath;
      const tabId = `${workspaceId}-${sessionId}-${relativePath}`;
      state.openFileTab({
        id: tabId,
        workspaceId,
        sessionId,
        path: relativePath,
        name: filename,
      });
    };
  }, [fullFilePath, worktreePath]);

  // Metadata summary text (inline after target)
  const metadataSummary = useMemo(() => {
    if (!metadata) return null;
    if (metadata.linesRead) return `${metadata.linesRead} lines`;
    if (metadata.bytesWritten) {
      const kb = metadata.bytesWritten / 1024;
      return kb >= 1 ? `${kb.toFixed(1)} KB` : `${metadata.bytesWritten} B`;
    }
    if (metadata.replacements) return `${metadata.replacements} replacement${metadata.replacements !== 1 ? 's' : ''}`;
    if (metadata.matchCount !== undefined && metadata.fileCount !== undefined) return `${metadata.matchCount} file${metadata.matchCount !== 1 ? 's' : ''} matched`;
    if (metadata.matchCount !== undefined) return `${metadata.matchCount} match${metadata.matchCount !== 1 ? 'es' : ''}`;
    if (metadata.resultCount) return `${metadata.resultCount} result${metadata.resultCount !== 1 ? 's' : ''}`;
    if (metadata.todosTotal !== undefined) {
      const parts: string[] = [];
      if (metadata.todosCompleted) parts.push(`${metadata.todosCompleted} done`);
      if (metadata.todosInProgress) parts.push(`${metadata.todosInProgress} active`);
      if (parts.length === 0) parts.push(`${metadata.todosTotal} total`);
      return parts.join(', ');
    }
    return null;
  }, [metadata]);

  const hasDetails = params && Object.keys(params).length > 0;
  const hasOutput = stdout || stderr;

  // Format params for structured display (exclude certain keys)
  const formatParams = () => {
    if (!params) return [];
    const excludeKeys = ['description', 'command', 'file_path', 'path', 'url', 'pattern', 'query'];
    return Object.entries(params)
      .filter(([key]) => !excludeKeys.includes(key))
      .map(([key, value]) => ({
        key,
        value: typeof value === 'string' ? value : JSON.stringify(value),
      }));
  };

  const additionalParams = formatParams();
  const showExpandable = hasDetails || hasOutput;

  return (
    <Collapsible open={isOpen} onOpenChange={handleOpenChange}>
      <CollapsibleTrigger
        className={cn(
          'flex items-center gap-1.5 text-base w-full rounded px-1.5 py-1 transition-colors',
          'hover:bg-surface-2',
          isActive && 'bg-brand/5'
        )}
      >
        {/* Status indicator — fixed 3x3 box to prevent layout shift */}
        <span className="flex items-center justify-center w-3 h-3 shrink-0">
          {isActive ? (
            <span className="block w-2 h-2 rounded-full border-[1.5px] border-primary border-t-transparent animate-spin" />
          ) : success === true ? (
            <Circle className="w-2 h-2 fill-text-success text-text-success" />
          ) : success === false ? (
            <Circle className="w-2 h-2 fill-text-error text-text-error" />
          ) : (
            <Circle className="w-2 h-2 fill-muted-foreground/50 text-muted-foreground/50" />
          )}
        </span>

        {/* Tool icon and label */}
        <ToolIcon className={cn('w-3 h-3 shrink-0', success === false ? 'text-text-error' : 'text-muted-foreground')} />
        <span className={cn('font-medium shrink-0 whitespace-nowrap', success === false ? 'text-text-error' : 'text-foreground')}>{getToolLabel()}</span>
        {success === false && (
          <span className="text-2xs px-1 py-0.5 rounded bg-text-error/10 text-text-error font-medium shrink-0">
            Error
          </span>
        )}
        {mcpInfo && (
          <span className="text-2xs px-1 py-0.5 rounded bg-muted text-muted-foreground/70 shrink-0">
            {mcpInfo.displayServer}
          </span>
        )}

        {/* Description (if available, shows instead of/before target) */}
        {description && (
          <span className={cn('italic truncate shrink-0', success === false ? 'text-text-error/70' : 'text-muted-foreground')}>
            {description}
          </span>
        )}

        {/* Summary fallback when no target/description (e.g., params missing from DB) */}
        {!truncatedTarget && !description && summary && (
          <span className={cn(
            'text-2xs truncate shrink-0',
            success === false ? 'text-text-error/80' : 'text-muted-foreground'
          )}>
            {summary}
          </span>
        )}

        {/* Target with tooltip for truncated content */}
        {truncatedTarget && !description && (
          isTargetTruncated ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <code
                  className={cn(
                    'text-2xs px-1 py-0.5 rounded font-mono truncate min-w-0',
                    isSkillTool ? 'bg-blue-500/15 text-blue-600 dark:text-blue-400' : 'bg-muted text-muted-foreground',
                    handleFileClick ? 'cursor-pointer hover:underline hover:text-foreground' : 'cursor-help'
                  )}
                  onClick={handleFileClick}
                >
                  {truncatedTarget}
                </code>
              </TooltipTrigger>
              <TooltipContent
                side="top"
                className="max-w-[500px] break-all font-mono text-xs"
              >
                {fullTarget}
              </TooltipContent>
            </Tooltip>
          ) : (
            <code
              className={cn(
                'text-2xs px-1 py-0.5 rounded font-mono truncate min-w-0',
                isSkillTool ? 'bg-blue-500/15 text-blue-600 dark:text-blue-400' : 'bg-muted text-muted-foreground',
                handleFileClick && 'cursor-pointer hover:underline hover:text-foreground'
              )}
              onClick={handleFileClick}
            >
              {truncatedTarget}
            </code>
          )
        )}

        {/* Target when description is shown (smaller, secondary) */}
        {truncatedTarget && description && (
          isTargetTruncated ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <code
                  className={cn(
                    'text-2xs px-1 py-0.5 rounded bg-muted/50 text-muted-foreground/70 font-mono truncate min-w-0',
                    handleFileClick ? 'cursor-pointer hover:underline hover:text-foreground' : 'cursor-help'
                  )}
                  onClick={handleFileClick}
                >
                  {truncatedTarget}
                </code>
              </TooltipTrigger>
              <TooltipContent
                side="top"
                className="max-w-[500px] break-all font-mono text-xs"
              >
                {fullTarget}
              </TooltipContent>
            </Tooltip>
          ) : (
            <code
              className={cn(
                'text-2xs px-1 py-0.5 rounded bg-muted/50 text-muted-foreground/70 font-mono truncate min-w-0',
                handleFileClick && 'cursor-pointer hover:underline hover:text-foreground'
              )}
              onClick={handleFileClick}
            >
              {truncatedTarget}
            </code>
          )
        )}

        {/* Git line stats for Edit tools */}
        {isEditTool && editStats && !isActive && (editStats.additions > 0 || editStats.deletions > 0) && (
          <span className="flex items-center gap-0.5 text-2xs font-mono shrink-0">
            <span className="text-text-success">+{editStats.additions}</span>
            <span className="text-text-error">-{editStats.deletions}</span>
          </span>
        )}

        {/* Metadata summary (line counts, match counts, etc.) */}
        {metadataSummary && !isActive && (
          <span className="text-2xs text-muted-foreground/70 shrink-0">
            {metadataSummary}
          </span>
        )}

        {/* Spacer */}
        <span className="flex-1" />

        {/* Duration / Elapsed time */}
        {isActive && elapsedSeconds !== undefined && elapsedSeconds > 0 ? (
          <span className="text-2xs text-muted-foreground/70 shrink-0 font-mono tabular-nums">
            {elapsedSeconds}s
          </span>
        ) : duration && !isActive ? (
          <span className="text-2xs text-muted-foreground/70 shrink-0">
            {formatToolDuration(duration)}
          </span>
        ) : null}

        {/* Expand indicator */}
        {showExpandable && (
          <span className="shrink-0 text-muted-foreground">
            {isOpen ? (
              <ChevronDown className="w-2.5 h-2.5" />
            ) : (
              <ChevronRight className="w-2.5 h-2.5" />
            )}
          </span>
        )}
      </CollapsibleTrigger>

      {showExpandable && (
        <CollapsibleContent>
          {isHydrating ? (
            <div className="mt-0.5 ml-4 px-2 py-1 text-2xs text-muted-foreground">
              Loading tool details...
            </div>
          ) : (
          <ErrorBoundary
            section="ToolDetails"
            fallback={
              <div className="mt-0.5 ml-4 px-2 py-1 text-2xs text-muted-foreground">
                Unable to display tool details
              </div>
            }
          >
            <div className="mt-0.5 ml-4 space-y-1.5">
              {/* Edit tool: inline diff viewer */}
              {isEditTool && typeof params?.old_string === 'string' && typeof params?.new_string === 'string' && fullFilePath ? (
                <Suspense fallback={<div className="rounded border bg-muted p-2 text-2xs text-muted-foreground">Loading diff viewer...</div>}>
                  <EditToolDetail
                    oldString={params.old_string as string}
                    newString={params.new_string as string}
                    filePath={fullFilePath}
                  />
                </Suspense>
              ) : isWriteTool && typeof params?.content === 'string' && fullFilePath ? (
                /* Write tool: syntax-highlighted code viewer */
                <Suspense fallback={<div className="rounded border bg-muted p-2 text-2xs text-muted-foreground">Loading code viewer...</div>}>
                  <WriteToolDetail
                    content={params.content as string}
                    filePath={fullFilePath}
                  />
                </Suspense>
              ) : isReadTool && stdout && fullFilePath ? (
                /* Read tool: syntax-highlighted file preview */
                <Suspense fallback={<div className="rounded border bg-muted p-2 text-2xs text-muted-foreground">Loading code viewer...</div>}>
                  <ReadToolDetail
                    content={stdout}
                    filePath={fullFilePath}
                  />
                </Suspense>
              ) : isTodoTool && Array.isArray(params?.todos) ? (
                /* TodoWrite: formatted task list */
                <TodoToolDetail todos={params.todos as Array<{ content: string; status: 'pending' | 'in_progress' | 'completed'; activeForm?: string }>} />
              ) : isWorkspaceDiffTool && stdout ? (
                /* Workspace diff: rich multi-file diff viewer */
                <Suspense fallback={<div className="rounded border bg-muted p-2 text-2xs text-muted-foreground">Loading diff viewer...</div>}>
                  <WorkspaceDiffDetail stdout={stdout} worktreePath={worktreePath} />
                </Suspense>
              ) : (
                /* Generic fallback for all other tools */
                <>
                  {/* Full command for Bash tools */}
                  {isBashTool && fullTarget && (
                    <div className="rounded border bg-muted p-2">
                      <div className="text-2xs text-muted-foreground/60 mb-1">Command</div>
                      <pre className="font-mono text-2xs text-text-success whitespace-pre-wrap break-all">
                        $ {fullTarget}
                      </pre>
                    </div>
                  )}

                  {/* Summary (hidden when stdout is present since the Output box already shows the full content) */}
                  {summary && !stdout && (
                    <div className={cn(
                      'text-2xs px-2 py-1 rounded',
                      success === false ? 'text-text-error bg-text-error/10' : 'text-muted-foreground bg-muted/30'
                    )}>
                      {summary}
                    </div>
                  )}

                  {/* stdout output */}
                  {stdout && (
                    <div className="rounded border bg-muted p-2">
                      <div className="text-2xs text-muted-foreground/60 mb-1">Output</div>
                      <pre className="font-mono text-2xs text-foreground/80 whitespace-pre-wrap break-all max-h-[500px] overflow-y-auto">
                        {stdout}
                      </pre>
                    </div>
                  )}

                  {/* Additional parameters (structured display) */}
                  {additionalParams.length > 0 && (
                    <div className="rounded border bg-muted/30 p-2">
                      <div className="text-2xs text-muted-foreground/60 mb-1">Parameters</div>
                      <div className="space-y-0.5">
                        {additionalParams.map(({ key, value }) => (
                          <div key={key} className="flex gap-2 text-2xs">
                            <span className="text-muted-foreground font-medium shrink-0">{key}:</span>
                            <span className="text-foreground/80 font-mono break-all">{value}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* stderr — always shown when present, regardless of which renderer was used */}
              {stderr && (
                <div className="rounded border border-text-error/30 bg-text-error/10 p-2">
                  <div className="text-2xs text-text-error/60 mb-1">Error Output</div>
                  <pre className="font-mono text-2xs text-text-error whitespace-pre-wrap break-all max-h-[500px] overflow-y-auto">
                    {stderr}
                  </pre>
                </div>
              )}
            </div>
          </ErrorBoundary>
          )}
        </CollapsibleContent>
      )}
    </Collapsible>
  );
});

interface ActiveToolsDisplayProps {
  conversationId: string;
}

interface ActiveToolType {
  id: string;
  tool: string;
  params?: Record<string, unknown>;
  startTime: number;
  endTime?: number;
  success?: boolean;
  summary?: string;
  stdout?: string;
  stderr?: string;
  elapsedSeconds?: number;
}

export function ActiveToolsDisplay({ conversationId }: ActiveToolsDisplayProps) {
  const activeTools = useAppStore((s) => s.activeTools);
  const tools: ActiveToolType[] = activeTools[conversationId] || [];

  if (tools.length === 0) return null;

  return (
    <div className="space-y-0.5">
      {tools.map((tool, index) => (
        <ToolUsageBlock
          key={`${tool.id}-${index}`}
          id={tool.id}
          tool={tool.tool}
          params={tool.params}
          isActive={!tool.endTime}
          success={tool.success}
          summary={tool.summary}
          duration={tool.endTime ? tool.endTime - tool.startTime : undefined}
          stdout={tool.stdout}
          stderr={tool.stderr}
          elapsedSeconds={tool.elapsedSeconds}
        />
      ))}
    </div>
  );
}
