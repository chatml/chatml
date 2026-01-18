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
import { cn } from '@/lib/utils';
import type { ToolUsage } from '@/lib/types';

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

function formatToolTarget(tool: string, params?: Record<string, unknown>): string {
  if (!params) return '';

  switch (tool) {
    case 'Read':
    case 'Write':
    case 'Edit':
      return params.file_path ? String(params.file_path).split('/').pop() || '' : '';
    case 'Glob':
      return params.pattern ? String(params.pattern) : '';
    case 'Grep':
      return params.pattern ? String(params.pattern) : '';
    case 'Bash':
      const cmd = params.command ? String(params.command) : '';
      return cmd.length > 30 ? cmd.slice(0, 30) + '...' : cmd;
    case 'WebSearch':
    case 'WebFetch':
      return params.query ? String(params.query) : params.url ? String(params.url) : '';
    case 'Task':
      return params.description ? String(params.description) : '';
    default:
      return '';
  }
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
            const target = formatToolTarget(tool.tool, tool.params);

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
                {target && (
                  <code className="text-[10px] px-1 py-0.5 bg-muted rounded truncate max-w-[200px]">
                    {target}
                  </code>
                )}
                {tool.durationMs !== undefined && (
                  <span className="text-muted-foreground/60 ml-auto">
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
