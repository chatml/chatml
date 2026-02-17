'use client';

import { memo } from 'react';
import { type NodeProps, type Node } from '@xyflow/react';
import { BaseNode } from './BaseNode';
import type { WorkflowNodeData } from './nodeRegistry';

type WFNodeProps = NodeProps<Node<WorkflowNodeData>>;

/** Helper: only render children when a config key is truthy. */
function hasConfig(config: Record<string, unknown>, key: string): boolean {
  return Boolean(config?.[key]);
}

// Trigger nodes
export const TriggerManualNode = memo(({ id, data, selected }: WFNodeProps) => (
  <BaseNode id={id} data={data} selected={selected} />
));
TriggerManualNode.displayName = 'TriggerManualNode';

export const TriggerCronNode = memo(({ id, data, selected }: WFNodeProps) => (
  <BaseNode id={id} data={data} selected={selected}>
    {hasConfig(data.config, 'expression') ? (
      <span className="font-mono">{String(data.config.expression)}</span>
    ) : null}
  </BaseNode>
));
TriggerCronNode.displayName = 'TriggerCronNode';

export const TriggerWebhookNode = memo(({ id, data, selected }: WFNodeProps) => (
  <BaseNode id={id} data={data} selected={selected} />
));
TriggerWebhookNode.displayName = 'TriggerWebhookNode';

export const TriggerEventNode = memo(({ id, data, selected }: WFNodeProps) => (
  <BaseNode id={id} data={data} selected={selected}>
    {hasConfig(data.config, 'eventName') ? (
      <span className="font-mono">{String(data.config.eventName)}</span>
    ) : null}
  </BaseNode>
));
TriggerEventNode.displayName = 'TriggerEventNode';

// Action nodes
export const ActionAgentNode = memo(({ id, data, selected }: WFNodeProps) => (
  <BaseNode id={id} data={data} selected={selected}>
    {hasConfig(data.config, 'instructions') ? (
      <span className="line-clamp-2">{String(data.config.instructions)}</span>
    ) : null}
    {hasConfig(data.config, 'workspaceMode') ? (
      <span className="block mt-0.5 opacity-60">{String(data.config.workspaceMode)}</span>
    ) : null}
  </BaseNode>
));
ActionAgentNode.displayName = 'ActionAgentNode';

export const ActionWebhookNode = memo(({ id, data, selected }: WFNodeProps) => (
  <BaseNode id={id} data={data} selected={selected}>
    {hasConfig(data.config, 'method') && hasConfig(data.config, 'url') ? (
      <span className="font-mono truncate block">
        {String(data.config.method)} {String(data.config.url)}
      </span>
    ) : null}
  </BaseNode>
));
ActionWebhookNode.displayName = 'ActionWebhookNode';

export const ActionScriptNode = memo(({ id, data, selected }: WFNodeProps) => (
  <BaseNode id={id} data={data} selected={selected}>
    {hasConfig(data.config, 'command') ? (
      <span className="font-mono truncate block">{String(data.config.command)}</span>
    ) : null}
  </BaseNode>
));
ActionScriptNode.displayName = 'ActionScriptNode';

// Logic nodes
export const LogicConditionalNode = memo(({ id, data, selected }: WFNodeProps) => (
  <BaseNode id={id} data={data} selected={selected}>
    {hasConfig(data.config, 'field') ? (
      <span className="font-mono">
        {String(data.config.field)} {String(data.config.operator)} {String(data.config.value)}
      </span>
    ) : null}
  </BaseNode>
));
LogicConditionalNode.displayName = 'LogicConditionalNode';

export const LogicDelayNode = memo(({ id, data, selected }: WFNodeProps) => (
  <BaseNode id={id} data={data} selected={selected}>
    {hasConfig(data.config, 'durationSecs') ? (
      <span>{String(data.config.durationSecs)}s</span>
    ) : null}
  </BaseNode>
));
LogicDelayNode.displayName = 'LogicDelayNode';

export const LogicLoopNode = memo(({ id, data, selected }: WFNodeProps) => (
  <BaseNode id={id} data={data} selected={selected} />
));
LogicLoopNode.displayName = 'LogicLoopNode';

export const LogicParallelNode = memo(({ id, data, selected }: WFNodeProps) => (
  <BaseNode id={id} data={data} selected={selected} />
));
LogicParallelNode.displayName = 'LogicParallelNode';

// Data nodes
export const DataTransformNode = memo(({ id, data, selected }: WFNodeProps) => (
  <BaseNode id={id} data={data} selected={selected}>
    {hasConfig(data.config, 'template') ? (
      <span className="font-mono line-clamp-2">{String(data.config.template)}</span>
    ) : null}
  </BaseNode>
));
DataTransformNode.displayName = 'DataTransformNode';

export const DataVariableNode = memo(({ id, data, selected }: WFNodeProps) => (
  <BaseNode id={id} data={data} selected={selected}>
    {hasConfig(data.config, 'name') ? (
      <span className="font-mono">{String(data.config.name)}</span>
    ) : null}
  </BaseNode>
));
DataVariableNode.displayName = 'DataVariableNode';

// Map from node kind to React component for React Flow's nodeTypes
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const WORKFLOW_NODE_TYPES: Record<string, React.ComponentType<any>> = {
  'trigger-manual': TriggerManualNode,
  'trigger-cron': TriggerCronNode,
  'trigger-webhook': TriggerWebhookNode,
  'trigger-event': TriggerEventNode,
  'action-agent': ActionAgentNode,
  'action-webhook': ActionWebhookNode,
  'action-script': ActionScriptNode,
  'logic-conditional': LogicConditionalNode,
  'logic-delay': LogicDelayNode,
  'logic-loop': LogicLoopNode,
  'logic-parallel': LogicParallelNode,
  'data-transform': DataTransformNode,
  'data-variable': DataVariableNode,
};
