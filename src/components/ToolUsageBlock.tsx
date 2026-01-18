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
    switch (tool) {
      case 'Read':
      case 'read_file':
        return 'Reading file';
      case 'Write':
      case 'write_file':
        return 'Writing file';
      case 'Edit':
      case 'edit_file':
        return 'Editing file';
      case 'Bash':
      case 'bash':
      case 'execute_command':
        return 'Running command';
      case 'Grep':
        return 'Searching content';
      case 'Glob':
        return 'Finding files';
      case 'WebFetch':
        return 'Fetching URL';
      case 'WebSearch':
        return 'Searching web';
      case 'list_dir':
        return 'Listing directory';
      default:
        return `Using ${tool}`;
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
      if (path.length > 60) {
        return path.slice(0, 57) + '...';
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
          'flex items-center gap-2 text-xs w-full rounded px-2 py-1.5 transition-colors',
          'hover:bg-muted/50',
          isActive && 'bg-primary/5 border border-primary/20'
        )}
      >
        {/* Status indicator */}
        {isActive ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin text-primary shrink-0" />
        ) : success === true ? (
          <CheckCircle2 className="w-3.5 h-3.5 text-green-500 shrink-0" />
        ) : success === false ? (
          <XCircle className="w-3.5 h-3.5 text-red-500 shrink-0" />
        ) : (
          <Icon className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        )}

        {/* Tool info */}
        <span className="font-medium text-foreground">{getToolLabel()}</span>

        {target && (
          <span className="font-mono text-muted-foreground truncate flex-1 text-left">
            {target}
          </span>
        )}

        {/* Duration */}
        {duration && !isActive && (
          <span className="text-muted-foreground/70 shrink-0">
            {duration < 1000 ? `${duration}ms` : `${(duration / 1000).toFixed(1)}s`}
          </span>
        )}

        {/* Expand indicator */}
        {hasDetails && (
          <span className="shrink-0 text-muted-foreground">
            {isOpen ? (
              <ChevronDown className="w-3 h-3" />
            ) : (
              <ChevronRight className="w-3 h-3" />
            )}
          </span>
        )}
      </CollapsibleTrigger>

      {hasDetails && (
        <CollapsibleContent>
          <div className="mt-1 ml-5 rounded border bg-muted/30 p-2 text-xs">
            {summary && (
              <div className="mb-2 text-muted-foreground">{summary}</div>
            )}
            <pre className="font-mono text-[10px] text-muted-foreground overflow-x-auto">
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

export function ActiveToolsDisplay({ conversationId }: ActiveToolsDisplayProps) {
  const { activeTools } = require('@/stores/appStore').useAppStore();
  const tools = activeTools[conversationId] || [];

  if (tools.length === 0) return null;

  return (
    <div className="space-y-1 my-2">
      {tools.map((tool: { id: string; tool: string; params?: Record<string, unknown>; startTime: number }) => (
        <ToolUsageBlock
          key={tool.id}
          id={tool.id}
          tool={tool.tool}
          params={tool.params}
          isActive={true}
        />
      ))}
    </div>
  );
}
