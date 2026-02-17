import type { ComponentType } from 'react';
import type { NodeProps } from '@xyflow/react';

// Node categories with their visual themes
export type NodeCategory = 'trigger' | 'action' | 'logic' | 'data';

export interface NodeKindDefinition {
  kind: string;
  label: string;
  category: NodeCategory;
  description: string;
  defaultConfig: Record<string, unknown>;
}

// Color themes per category
export const CATEGORY_COLORS: Record<NodeCategory, {
  bg: string;
  border: string;
  icon: string;
  badge: string;
}> = {
  trigger: {
    bg: 'bg-emerald-500/10',
    border: 'border-emerald-500/30',
    icon: 'text-emerald-500',
    badge: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  },
  action: {
    bg: 'bg-indigo-500/10',
    border: 'border-indigo-500/30',
    icon: 'text-indigo-500',
    badge: 'bg-indigo-500/15 text-indigo-600 dark:text-indigo-400',
  },
  logic: {
    bg: 'bg-amber-500/10',
    border: 'border-amber-500/30',
    icon: 'text-amber-500',
    badge: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  },
  data: {
    bg: 'bg-purple-500/10',
    border: 'border-purple-500/30',
    icon: 'text-purple-500',
    badge: 'bg-purple-500/15 text-purple-600 dark:text-purple-400',
  },
};

// All node kinds in the system
export const NODE_KINDS: NodeKindDefinition[] = [
  // Triggers (green) - output only
  {
    kind: 'trigger-manual',
    label: 'Manual Trigger',
    category: 'trigger',
    description: 'Start workflow manually',
    defaultConfig: {},
  },
  {
    kind: 'trigger-cron',
    label: 'Cron Schedule',
    category: 'trigger',
    description: 'Run on a schedule',
    defaultConfig: { expression: '0 9 * * *', timezone: 'UTC' },
  },
  {
    kind: 'trigger-webhook',
    label: 'Webhook',
    category: 'trigger',
    description: 'Triggered by HTTP request',
    defaultConfig: { secret: '' },
  },
  {
    kind: 'trigger-event',
    label: 'Event',
    category: 'trigger',
    description: 'Triggered by internal event',
    defaultConfig: { eventName: 'session_completed' },
  },

  // Actions (blue) - in + out
  {
    kind: 'action-agent',
    label: 'Agent Session',
    category: 'action',
    description: 'Run an AI agent',
    defaultConfig: {
      workspaceMode: 'scratch',
      workspaceId: '',
      instructions: '',
      model: 'claude-sonnet-4-5-20250929',
      toolPreset: 'full',
      maxTurns: 0,
      maxBudgetUsd: 0,
    },
  },
  {
    kind: 'action-webhook',
    label: 'HTTP Request',
    category: 'action',
    description: 'Make an HTTP request',
    defaultConfig: { url: '', method: 'POST', headers: '{}', bodyTemplate: '' },
  },
  {
    kind: 'action-script',
    label: 'Script',
    category: 'action',
    description: 'Run a shell command',
    defaultConfig: { command: '', workDir: '' },
  },

  // Logic (amber) - in + multiple out
  {
    kind: 'logic-conditional',
    label: 'Conditional',
    category: 'logic',
    description: 'Branch based on condition',
    defaultConfig: { field: '', operator: 'equals', value: '' },
  },
  {
    kind: 'logic-delay',
    label: 'Delay',
    category: 'logic',
    description: 'Wait before continuing',
    defaultConfig: { durationSecs: 60 },
  },
  {
    kind: 'logic-loop',
    label: 'Loop',
    category: 'logic',
    description: 'Iterate over items',
    defaultConfig: { itemsPath: '', maxIterations: 100 },
  },
  {
    kind: 'logic-parallel',
    label: 'Parallel',
    category: 'logic',
    description: 'Run branches in parallel',
    defaultConfig: {},
  },

  // Data (purple) - in + out
  {
    kind: 'data-transform',
    label: 'Transform',
    category: 'data',
    description: 'Reshape data with template',
    defaultConfig: { template: '' },
  },
  {
    kind: 'data-variable',
    label: 'Variable',
    category: 'data',
    description: 'Set or read a variable',
    defaultConfig: { name: '', value: '' },
  },
];

// Lookup helpers
export const NODE_KIND_MAP = new Map(NODE_KINDS.map((nk) => [nk.kind, nk]));

export function getNodeKind(kind: string): NodeKindDefinition | undefined {
  return NODE_KIND_MAP.get(kind);
}

// Group by category for palette display
export function getNodeKindsByCategory(): Record<NodeCategory, NodeKindDefinition[]> {
  const grouped: Record<NodeCategory, NodeKindDefinition[]> = {
    trigger: [],
    action: [],
    logic: [],
    data: [],
  };
  for (const nk of NODE_KINDS) {
    grouped[nk.category].push(nk);
  }
  return grouped;
}

// React Flow node data shape
export interface WorkflowNodeData {
  kind: string;
  label: string;
  config: Record<string, unknown>;
  [key: string]: unknown;
}
