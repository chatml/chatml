'use client';

import { useState } from 'react';
import {
  CheckCircle2,
  XCircle,
  ChevronRight,
  ChevronDown,
  FileText,
  Terminal,
  Search,
  Edit3,
  Globe,
  GitBranch,
  Wrench,
} from 'lucide-react';
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
import { cn } from '@/lib/utils';
import type { ToolUsage } from '@/lib/types';

// Truncation limits (increased from original)
const COMMAND_TRUNCATE_LENGTH = 60;
const PATH_TRUNCATE_LENGTH = 50;

interface ToolUsageHistoryProps {
  tools: ToolUsage[];
}

const toolIcons: Record<string, React.ElementType> = {
  Read: FileText,
  Glob: Search,
  Grep: Search,
  Write: Edit3,
  Edit: Edit3,
  Bash: Terminal,
  WebSearch: Globe,
  WebFetch: Globe,
  Task: GitBranch,
};

function getToolIcon(toolName: string) {
  return toolIcons[toolName] || Wrench;
}

interface ToolTargetInfo {
  display: string;
  full: string;
  isTruncated: boolean;
}

function formatToolTarget(tool: string, params?: Record<string, unknown>): ToolTargetInfo {
  const empty = { display: '', full: '', isTruncated: false };
  if (!params) return empty;

  let full = '';
  let display = '';

  switch (tool) {
    case 'Read':
    case 'Write':
    case 'Edit': {
      const filePath = params.file_path ? String(params.file_path) : '';
      full = filePath;
      // Show more of the path now - last 2 directories + filename
      const parts = filePath.split('/').filter(Boolean);
      if (parts.length <= 3) {
        display = filePath;
      } else {
        display = '.../' + parts.slice(-3).join('/');
      }
      if (display.length > PATH_TRUNCATE_LENGTH) {
        display = display.slice(0, PATH_TRUNCATE_LENGTH - 3) + '...';
      }
      break;
    }
    case 'Glob':
      full = params.pattern ? String(params.pattern) : '';
      display = full.length > PATH_TRUNCATE_LENGTH
        ? full.slice(0, PATH_TRUNCATE_LENGTH - 3) + '...'
        : full;
      break;
    case 'Grep':
      full = params.pattern ? String(params.pattern) : '';
      display = full.length > PATH_TRUNCATE_LENGTH
        ? full.slice(0, PATH_TRUNCATE_LENGTH - 3) + '...'
        : full;
      break;
    case 'Bash': {
      const cmd = params.command ? String(params.command) : '';
      full = cmd;
      // Use description if available (more meaningful)
      const description = params.description ? String(params.description) : '';
      if (description) {
        display = description.length > COMMAND_TRUNCATE_LENGTH
          ? description.slice(0, COMMAND_TRUNCATE_LENGTH - 3) + '...'
          : description;
      } else {
        display = cmd.length > COMMAND_TRUNCATE_LENGTH
          ? cmd.slice(0, COMMAND_TRUNCATE_LENGTH - 3) + '...'
          : cmd;
      }
      break;
    }
    case 'WebSearch':
    case 'WebFetch': {
      full = params.query ? String(params.query) : params.url ? String(params.url) : '';
      display = full.length > PATH_TRUNCATE_LENGTH
        ? full.slice(0, PATH_TRUNCATE_LENGTH - 3) + '...'
        : full;
      break;
    }
    case 'Task':
      full = params.description ? String(params.description) : '';
      display = full.length > PATH_TRUNCATE_LENGTH
        ? full.slice(0, PATH_TRUNCATE_LENGTH - 3) + '...'
        : full;
      break;
    default:
      return empty;
  }

  return {
    display,
    full,
    isTruncated: display !== full && full.length > 0,
  };
}

export function ToolUsageHistory({ tools }: ToolUsageHistoryProps) {
  const [isOpen, setIsOpen] = useState(false);

  if (tools.length === 0) return null;

  const successCount = tools.filter((t) => t.success !== false).length;
  const failCount = tools.filter((t) => t.success === false).length;

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger className="flex items-center gap-2 text-[11px] text-muted-foreground hover:text-foreground transition-colors">
        {isOpen ? (
          <ChevronDown className="w-3 h-3" />
        ) : (
          <ChevronRight className="w-3 h-3" />
        )}
        <Wrench className="w-3 h-3" />
        <span>{tools.length} tool{tools.length !== 1 ? 's' : ''}</span>
        {successCount > 0 && (
          <span className="text-green-500">{successCount} passed</span>
        )}
        {failCount > 0 && (
          <span className="text-destructive">{failCount} failed</span>
        )}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-1.5 space-y-0.5">
          {tools.map((tool) => {
            const Icon = getToolIcon(tool.tool);
            const targetInfo = formatToolTarget(tool.tool, tool.params);

            return (
              <div
                key={tool.id}
                className="flex items-center gap-2 text-[11px] py-0.5 text-muted-foreground"
              >
                {tool.success === false ? (
                  <XCircle className="w-3 h-3 text-destructive shrink-0" />
                ) : (
                  <CheckCircle2 className="w-3 h-3 text-green-500 shrink-0" />
                )}
                <Icon className="w-3 h-3 shrink-0" />
                <span className="font-medium">{tool.tool}</span>
                {targetInfo.display && (
                  targetInfo.isTruncated ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <code className="text-[10px] px-1 py-0.5 bg-muted rounded truncate max-w-[250px] cursor-help">
                          {targetInfo.display}
                        </code>
                      </TooltipTrigger>
                      <TooltipContent
                        side="top"
                        className="max-w-[500px] break-all font-mono text-[11px]"
                      >
                        {targetInfo.full}
                      </TooltipContent>
                    </Tooltip>
                  ) : (
                    <code className="text-[10px] px-1 py-0.5 bg-muted rounded truncate max-w-[250px]">
                      {targetInfo.display}
                    </code>
                  )
                )}
                {tool.durationMs !== undefined && (
                  <span className="text-muted-foreground/60 ml-auto shrink-0">
                    {tool.durationMs < 1000
                      ? `${tool.durationMs}ms`
                      : `${(tool.durationMs / 1000).toFixed(1)}s`}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
