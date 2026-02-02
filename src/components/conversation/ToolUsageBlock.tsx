'use client';

import { useState, useMemo, memo } from 'react';
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
  FileEdit,
  Terminal,
  Search,
  Globe,
  FolderOpen,
  Circle,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/stores/appStore';
import { ErrorBoundary } from '@/components/shared/ErrorBoundary';

interface ToolUsageBlockProps {
  id: string;
  tool: string;
  params?: Record<string, unknown>;
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
}

// Truncation limits
const TARGET_TRUNCATE_LENGTH = 60;
const COMMAND_TRUNCATE_LENGTH = 80;

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
  id,
  tool,
  params,
  isActive = false,
  success,
  summary,
  duration,
  stdout,
  stderr,
  elapsedSeconds,
}: ToolUsageBlockProps) {
  const [isOpen, setIsOpen] = useState(false);

  const ToolIcon = useMemo((): LucideIcon => {
    switch (tool) {
      case 'Read':
      case 'read_file':
        return FileText;
      case 'Write':
      case 'Edit':
      case 'write_file':
      case 'edit_file':
        return FileEdit;
      case 'Bash':
      case 'bash':
      case 'execute_command':
        return Terminal;
      case 'Grep':
      case 'Glob':
      case 'search':
        return Search;
      case 'WebFetch':
      case 'WebSearch':
      case 'web':
        return Globe;
      case 'list_dir':
        return FolderOpen;
      default:
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
      default:
        return tool;
    }
  };

  // Extract description from params (Bash tool provides this)
  const description = params?.description as string | undefined;

  // Check if this is a Bash tool
  const isBashTool = ['Bash', 'bash', 'execute_command'].includes(tool);

  // Check if this is an Edit tool and calculate line stats
  const isEditTool = ['Edit', 'edit_file'].includes(tool);
  const editStats = useMemo(() => {
    if (!isEditTool) return null;
    return calculateEditStats(params);
  }, [isEditTool, params]);

  const getTarget = () => {
    if (!params) return null;

    // Common param names for file paths/commands
    const path =
      params.path ||
      params.file_path ||
      params.filepath ||
      params.filename ||
      params.file ||
      params.command ||
      params.url ||
      params.pattern ||
      params.query;

    if (typeof path === 'string') {
      return path;
    }

    return null;
  };

  const target = getTarget();
  const fullTarget = target;

  // Truncate target for display
  const truncatedTarget = useMemo(() => {
    if (!target) return null;
    const limit = isBashTool ? COMMAND_TRUNCATE_LENGTH : TARGET_TRUNCATE_LENGTH;
    if (target.length > limit) {
      return target.slice(0, limit - 3) + '...';
    }
    return target;
  }, [target, isBashTool]);

  const isTargetTruncated = target && truncatedTarget && target !== truncatedTarget;

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
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger
        className={cn(
          'flex items-center gap-1.5 text-[11px] w-full rounded px-1.5 py-1 transition-colors',
          'hover:bg-surface-2',
          isActive && 'bg-primary/5'
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

        {/* Tool icon and label - show "Error" when tool failed */}
        {success === false ? (
          <>
            <ToolIcon className="w-3 h-3 text-text-error shrink-0" />
            <span className="font-medium text-text-error">Error</span>
            {summary && (
              <span className="text-text-error/80 text-[10px] truncate max-w-[350px]">
                {summary}
              </span>
            )}
          </>
        ) : (
          <>
            <ToolIcon className="w-3 h-3 text-muted-foreground shrink-0" />
            <span className="font-medium text-foreground">{getToolLabel()}</span>

            {/* Description (if available, shows instead of/before target) */}
            {description && (
              <span className="text-muted-foreground italic truncate max-w-[200px]">
                {description}
              </span>
            )}
          </>
        )}

        {/* Target with tooltip for truncated content - hide when error */}
        {success !== false && truncatedTarget && !description && (
          isTargetTruncated ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <code className="text-[10px] px-1 py-0.5 rounded bg-muted text-muted-foreground font-mono truncate max-w-[300px] cursor-help">
                  {truncatedTarget}
                </code>
              </TooltipTrigger>
              <TooltipContent
                side="top"
                className="max-w-[500px] break-all font-mono text-[11px]"
              >
                {fullTarget}
              </TooltipContent>
            </Tooltip>
          ) : (
            <code className="text-[10px] px-1 py-0.5 rounded bg-muted text-muted-foreground font-mono truncate max-w-[300px]">
              {truncatedTarget}
            </code>
          )
        )}

        {/* Target when description is shown (smaller, secondary) - hide when error */}
        {success !== false && truncatedTarget && description && (
          isTargetTruncated ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <code className="text-[9px] px-1 py-0.5 rounded bg-muted/50 text-muted-foreground/70 font-mono truncate max-w-[200px] cursor-help">
                  {truncatedTarget}
                </code>
              </TooltipTrigger>
              <TooltipContent
                side="top"
                className="max-w-[500px] break-all font-mono text-[11px]"
              >
                {fullTarget}
              </TooltipContent>
            </Tooltip>
          ) : (
            <code className="text-[9px] px-1 py-0.5 rounded bg-muted/50 text-muted-foreground/70 font-mono truncate max-w-[200px]">
              {truncatedTarget}
            </code>
          )
        )}

        {/* Git line stats for Edit tools - hide when error or no net change */}
        {success !== false && isEditTool && editStats && !isActive && (editStats.additions > 0 || editStats.deletions > 0) && (
          <span className="flex items-center gap-0.5 text-[10px] font-mono shrink-0">
            <span className="text-text-success">+{editStats.additions}</span>
            <span className="text-text-error">-{editStats.deletions}</span>
          </span>
        )}

        {/* Spacer */}
        <span className="flex-1" />

        {/* Duration / Elapsed time */}
        {isActive && elapsedSeconds !== undefined && elapsedSeconds > 0 ? (
          <span className="text-[10px] text-muted-foreground/70 shrink-0 font-mono tabular-nums">
            {elapsedSeconds}s
          </span>
        ) : duration && !isActive ? (
          <span className="text-[10px] text-muted-foreground/70 shrink-0">
            {duration < 1000 ? `${duration}ms` : `${(duration / 1000).toFixed(1)}s`}
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
          <ErrorBoundary
            section="ToolDetails"
            fallback={
              <div className="mt-0.5 ml-4 px-2 py-1 text-[10px] text-muted-foreground">
                Unable to display tool details
              </div>
            }
          >
            <div className="mt-0.5 ml-4 space-y-1.5">
              {/* Summary */}
              {summary && (
                <div className="text-[10px] text-muted-foreground px-2 py-1 rounded bg-muted/30">
                  {summary}
                </div>
              )}

              {/* Full command for Bash tools */}
              {isBashTool && fullTarget && (
                <div className="rounded border bg-muted p-2">
                  <div className="text-[9px] text-muted-foreground/60 mb-1">Command</div>
                  <pre className="font-mono text-[10px] text-text-success whitespace-pre-wrap break-all">
                    $ {fullTarget}
                  </pre>
                </div>
              )}

              {/* stdout output */}
              {stdout && (
                <div className="rounded border bg-muted p-2">
                  <div className="text-[9px] text-muted-foreground/60 mb-1">Output</div>
                  <pre className="font-mono text-[10px] text-foreground/80 whitespace-pre-wrap break-all max-h-[150px] overflow-y-auto">
                    {stdout}
                  </pre>
                </div>
              )}

              {/* stderr output */}
              {stderr && (
                <div className="rounded border border-text-error/30 bg-text-error/10 p-2">
                  <div className="text-[9px] text-text-error/60 mb-1">Error Output</div>
                  <pre className="font-mono text-[10px] text-text-error whitespace-pre-wrap break-all max-h-[150px] overflow-y-auto">
                    {stderr}
                  </pre>
                </div>
              )}

              {/* Additional parameters (structured display) */}
              {additionalParams.length > 0 && (
                <div className="rounded border bg-muted/30 p-2">
                  <div className="text-[9px] text-muted-foreground/60 mb-1">Parameters</div>
                  <div className="space-y-0.5">
                    {additionalParams.map(({ key, value }) => (
                      <div key={key} className="flex gap-2 text-[10px]">
                        <span className="text-muted-foreground font-medium shrink-0">{key}:</span>
                        <span className="text-foreground/80 font-mono break-all">{value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </ErrorBoundary>
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
