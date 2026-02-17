'use client';

import { memo, type ReactNode } from 'react';
import { Handle, Position } from '@xyflow/react';
import { cn } from '@/lib/utils';
import { useWorkflowStore } from '@/stores/workflowStore';
import { getNodeKind, CATEGORY_COLORS, type WorkflowNodeData } from './nodeRegistry';
import {
  Hand,
  Clock,
  Webhook,
  Zap,
  Bot,
  Globe,
  Terminal,
  GitBranch,
  Timer,
  Repeat,
  GitFork,
  Shuffle,
  Variable,
  Loader2,
  CheckCircle2,
  XCircle,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

// Icon mapping for each node kind
const NODE_ICONS: Record<string, LucideIcon> = {
  'trigger-manual': Hand,
  'trigger-cron': Clock,
  'trigger-webhook': Webhook,
  'trigger-event': Zap,
  'action-agent': Bot,
  'action-webhook': Globe,
  'action-script': Terminal,
  'logic-conditional': GitBranch,
  'logic-delay': Timer,
  'logic-loop': Repeat,
  'logic-parallel': GitFork,
  'data-transform': Shuffle,
  'data-variable': Variable,
};

interface BaseNodeProps {
  id?: string;
  data: WorkflowNodeData;
  selected?: boolean;
  children?: ReactNode;
}

export const BaseNode = memo(function BaseNode({ id, data, selected, children }: BaseNodeProps) {
  const kindDef = getNodeKind(data.kind);
  const category = kindDef?.category ?? 'action';
  const colors = CATEGORY_COLORS[category];
  const Icon = NODE_ICONS[data.kind] ?? Zap;
  const isTrigger = category === 'trigger';
  const isConditional = data.kind === 'logic-conditional';

  // Execution status from store
  const nodeStatus = useWorkflowStore((s) => id ? s.nodeStatuses[id] : undefined);

  return (
    <div
      className={cn(
        'rounded-lg border shadow-sm min-w-[180px] max-w-[220px] transition-shadow',
        colors.bg,
        colors.border,
        selected && 'ring-2 ring-primary shadow-md',
        nodeStatus?.status === 'running' && 'ring-2 ring-blue-500 shadow-blue-500/20 shadow-md',
        nodeStatus?.status === 'completed' && 'ring-2 ring-green-500/50',
        nodeStatus?.status === 'failed' && 'ring-2 ring-destructive/50',
      )}
    >
      {/* Input handle (not for triggers) */}
      {!isTrigger && (
        <Handle
          type="target"
          position={Position.Top}
          className="!w-3 !h-3 !bg-border !border-2 !border-background"
        />
      )}

      {/* Node header */}
      <div className="flex items-center gap-2 px-3 py-2">
        <div className={cn('flex items-center justify-center w-6 h-6 rounded shrink-0', colors.bg)}>
          <Icon className={cn('h-3.5 w-3.5', colors.icon)} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-xs font-medium truncate">{data.label}</div>
          <div className="text-[10px] text-muted-foreground truncate">
            {kindDef?.description}
          </div>
        </div>
        {/* Execution status badge */}
        {nodeStatus && (
          <div className="shrink-0">
            {nodeStatus.status === 'running' && (
              <Loader2 className="h-3.5 w-3.5 text-blue-500 animate-spin" />
            )}
            {nodeStatus.status === 'completed' && (
              <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
            )}
            {nodeStatus.status === 'failed' && (
              <XCircle className="h-3.5 w-3.5 text-destructive" />
            )}
          </div>
        )}
      </div>

      {/* Optional node body */}
      {children && (
        <div className="px-3 pb-2 text-[10px] text-muted-foreground border-t border-border/30 pt-1.5">
          {children}
        </div>
      )}

      {/* Error message */}
      {nodeStatus?.error && (
        <div className="px-3 pb-2 text-[10px] text-destructive truncate" title={nodeStatus.error}>
          {nodeStatus.error}
        </div>
      )}

      {/* Output handle */}
      <Handle
        type="source"
        position={Position.Bottom}
        className="!w-3 !h-3 !bg-border !border-2 !border-background"
      />

      {/* Conditional: extra "false" handle on the right */}
      {isConditional && (
        <Handle
          type="source"
          position={Position.Right}
          id="false"
          className="!w-3 !h-3 !bg-red-400 !border-2 !border-background"
        />
      )}
    </div>
  );
});
