'use client';

import { useState } from 'react';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  ChevronRight,
  ChevronDown,
  FileText,
  FileEdit,
  Terminal,
  Search,
  Globe,
  Loader2,
  CheckCircle2,
  XCircle,
  FolderOpen,
  Circle,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface ToolUsageBlockProps {
  id: string;
  tool: string;
  params?: Record<string, unknown>;
  isActive?: boolean;
  success?: boolean;
  summary?: string;
  duration?: number;
}

export function ToolUsageBlock({
  id,
  tool,
  params,
  isActive = false,
  success,
  summary,
  duration,
}: ToolUsageBlockProps) {
  const [isOpen, setIsOpen] = useState(false);

  const getToolIcon = () => {
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
  };

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

  const getTarget = () => {
    if (!params) return null;

    // Common param names for file paths
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
      // Truncate long paths/commands
      if (path.length > 50) {
        return path.slice(0, 47) + '...';
      }
      return path;
    }

    return null;
  };

  const Icon = getToolIcon();
  const target = getTarget();
  const hasDetails = params && Object.keys(params).length > 0;

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger
        className={cn(
          'flex items-center gap-1.5 text-[11px] w-full rounded px-1.5 py-1 transition-colors',
          'hover:bg-muted/50',
          isActive && 'bg-primary/5'
        )}
      >
        {/* Status indicator */}
        {isActive ? (
          <Loader2 className="w-3 h-3 animate-spin text-primary shrink-0" />
        ) : success === true ? (
          <Circle className="w-2 h-2 fill-green-500 text-green-500 shrink-0" />
        ) : success === false ? (
          <Circle className="w-2 h-2 fill-red-500 text-red-500 shrink-0" />
        ) : (
          <Circle className="w-2 h-2 fill-muted-foreground/50 text-muted-foreground/50 shrink-0" />
        )}

        {/* Tool icon and label */}
        <Icon className="w-3 h-3 text-muted-foreground shrink-0" />
        <span className="font-medium text-foreground">{getToolLabel()}</span>

        {target && (
          <code className="text-[10px] px-1 py-0.5 rounded bg-muted text-muted-foreground font-mono truncate max-w-[250px]">
            {target}
          </code>
        )}

        {/* Spacer */}
        <span className="flex-1" />

        {/* Duration */}
        {duration && !isActive && (
          <span className="text-[10px] text-muted-foreground/70 shrink-0">
            {duration < 1000 ? `${duration}ms` : `${(duration / 1000).toFixed(1)}s`}
          </span>
        )}

        {/* Expand indicator */}
        {hasDetails && (
          <span className="shrink-0 text-muted-foreground">
            {isOpen ? (
              <ChevronDown className="w-2.5 h-2.5" />
            ) : (
              <ChevronRight className="w-2.5 h-2.5" />
            )}
          </span>
        )}
      </CollapsibleTrigger>

      {hasDetails && (
        <CollapsibleContent>
          <div className="mt-0.5 ml-4 rounded border bg-muted/30 p-1.5 text-[10px]">
            {summary && (
              <div className="mb-1 text-muted-foreground">{summary}</div>
            )}
            <pre className="font-mono text-[9px] text-muted-foreground overflow-x-auto">
              {JSON.stringify(params, null, 2)}
            </pre>
          </div>
        </CollapsibleContent>
      )}
    </Collapsible>
  );
}

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
}

export function ActiveToolsDisplay({ conversationId }: ActiveToolsDisplayProps) {
  const { activeTools } = require('@/stores/appStore').useAppStore();
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
        />
      ))}
    </div>
  );
}
