'use client';

import { useCallback } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { getNodeKind, CATEGORY_COLORS } from './nodes/nodeRegistry';
import { cn } from '@/lib/utils';

interface NodeConfigPanelProps {
  nodeId: string;
  kind: string;
  config: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
}

export function NodeConfigPanel({ nodeId, kind, config, onChange }: NodeConfigPanelProps) {
  const kindDef = getNodeKind(kind);
  const colors = kindDef ? CATEGORY_COLORS[kindDef.category] : CATEGORY_COLORS.action;

  const updateField = useCallback(
    (field: string, value: unknown) => {
      onChange({ ...config, [field]: value });
    },
    [config, onChange],
  );

  return (
    <div className="p-3 space-y-4">
      {/* Header */}
      <div>
        <div className={cn('text-xs font-semibold px-1.5 py-0.5 rounded w-fit mb-1', colors.badge)}>
          {kindDef?.category}
        </div>
        <h3 className="text-sm font-medium">{kindDef?.label ?? kind}</h3>
        <p className="text-[10px] text-muted-foreground">{kindDef?.description}</p>
      </div>

      {/* Config fields based on node kind */}
      {kind === 'action-agent' && (
        <AgentSessionConfig config={config} updateField={updateField} />
      )}
      {kind === 'action-webhook' && (
        <WebhookConfig config={config} updateField={updateField} />
      )}
      {kind === 'action-script' && (
        <ScriptConfig config={config} updateField={updateField} />
      )}
      {kind === 'trigger-cron' && (
        <CronConfig config={config} updateField={updateField} />
      )}
      {kind === 'trigger-event' && (
        <EventConfig config={config} updateField={updateField} />
      )}
      {kind === 'logic-conditional' && (
        <ConditionalConfig config={config} updateField={updateField} />
      )}
      {kind === 'logic-delay' && (
        <DelayConfig config={config} updateField={updateField} />
      )}
      {kind === 'data-transform' && (
        <TransformConfig config={config} updateField={updateField} />
      )}
      {kind === 'data-variable' && (
        <VariableConfig config={config} updateField={updateField} />
      )}

      {/* Error handling — shown for non-trigger nodes */}
      {!kind.startsWith('trigger-') && (
        <ErrorHandlingConfig config={config} updateField={updateField} />
      )}
    </div>
  );
}

// ============================================================================
// Config sub-forms
// ============================================================================

interface ConfigProps {
  config: Record<string, unknown>;
  updateField: (field: string, value: unknown) => void;
}

function AgentSessionConfig({ config, updateField }: ConfigProps) {
  return (
    <div className="space-y-3">
      <div>
        <Label className="text-xs">Workspace Mode</Label>
        <select
          className="w-full h-8 text-xs rounded-md border border-input bg-background px-2 mt-1"
          value={String(config.workspaceMode ?? 'scratch')}
          onChange={(e) => updateField('workspaceMode', e.target.value)}
        >
          <option value="scratch">Scratch (no git)</option>
          <option value="specific">Specific repo</option>
          <option value="from-input">From pipeline input</option>
        </select>
      </div>
      {config.workspaceMode === 'specific' && (
        <div>
          <Label className="text-xs">Workspace ID</Label>
          <Input
            className="h-8 text-xs mt-1"
            value={String(config.workspaceId ?? '')}
            onChange={(e) => updateField('workspaceId', e.target.value)}
            placeholder="workspace-uuid"
          />
        </div>
      )}
      <div>
        <Label className="text-xs">Instructions</Label>
        <Textarea
          className="text-xs mt-1 min-h-[80px]"
          value={String(config.instructions ?? '')}
          onChange={(e) => updateField('instructions', e.target.value)}
          placeholder="Task instructions for the agent..."
        />
      </div>
      <div>
        <Label className="text-xs">Model</Label>
        <select
          className="w-full h-8 text-xs rounded-md border border-input bg-background px-2 mt-1"
          value={String(config.model ?? 'claude-sonnet-4-5-20250929')}
          onChange={(e) => updateField('model', e.target.value)}
        >
          <option value="claude-opus-4-6">Claude Opus 4.6</option>
          <option value="claude-sonnet-4-5-20250929">Claude Sonnet 4.5</option>
          <option value="claude-haiku-4-5-20251001">Claude Haiku 4.5</option>
        </select>
      </div>
      <div>
        <Label className="text-xs">Tool Preset</Label>
        <select
          className="w-full h-8 text-xs rounded-md border border-input bg-background px-2 mt-1"
          value={String(config.toolPreset ?? 'full')}
          onChange={(e) => updateField('toolPreset', e.target.value)}
        >
          <option value="full">Full access</option>
          <option value="read-only">Read only</option>
          <option value="no-bash">No bash</option>
          <option value="safe-edit">Safe edit</option>
        </select>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label className="text-xs">Max Turns</Label>
          <Input
            type="number"
            className="h-8 text-xs mt-1"
            value={String(config.maxTurns ?? 0)}
            onChange={(e) => updateField('maxTurns', Number(e.target.value))}
          />
        </div>
        <div>
          <Label className="text-xs">Max Budget ($)</Label>
          <Input
            type="number"
            step="0.01"
            className="h-8 text-xs mt-1"
            value={String(config.maxBudgetUsd ?? 0)}
            onChange={(e) => updateField('maxBudgetUsd', Number(e.target.value))}
          />
        </div>
      </div>
    </div>
  );
}

function WebhookConfig({ config, updateField }: ConfigProps) {
  return (
    <div className="space-y-3">
      <div>
        <Label className="text-xs">Method</Label>
        <select
          className="w-full h-8 text-xs rounded-md border border-input bg-background px-2 mt-1"
          value={String(config.method ?? 'POST')}
          onChange={(e) => updateField('method', e.target.value)}
        >
          <option value="GET">GET</option>
          <option value="POST">POST</option>
          <option value="PUT">PUT</option>
          <option value="PATCH">PATCH</option>
          <option value="DELETE">DELETE</option>
        </select>
      </div>
      <div>
        <Label className="text-xs">URL</Label>
        <Input
          className="h-8 text-xs mt-1"
          value={String(config.url ?? '')}
          onChange={(e) => updateField('url', e.target.value)}
          placeholder="https://..."
        />
      </div>
      <div>
        <Label className="text-xs">Headers (JSON)</Label>
        <Textarea
          className="text-xs mt-1 min-h-[60px] font-mono"
          value={String(config.headers ?? '{}')}
          onChange={(e) => updateField('headers', e.target.value)}
        />
      </div>
      <div>
        <Label className="text-xs">Body Template</Label>
        <Textarea
          className="text-xs mt-1 min-h-[60px] font-mono"
          value={String(config.bodyTemplate ?? '')}
          onChange={(e) => updateField('bodyTemplate', e.target.value)}
          placeholder='{"message": "{{.input.lastMessage}}"}'
        />
      </div>
    </div>
  );
}

function ScriptConfig({ config, updateField }: ConfigProps) {
  return (
    <div className="space-y-3">
      <div>
        <Label className="text-xs">Command</Label>
        <Input
          className="h-8 text-xs mt-1 font-mono"
          value={String(config.command ?? '')}
          onChange={(e) => updateField('command', e.target.value)}
          placeholder="npm test"
        />
      </div>
      <div>
        <Label className="text-xs">Working Directory</Label>
        <Input
          className="h-8 text-xs mt-1"
          value={String(config.workDir ?? '')}
          onChange={(e) => updateField('workDir', e.target.value)}
          placeholder="Leave empty for default"
        />
      </div>
    </div>
  );
}

function CronConfig({ config, updateField }: ConfigProps) {
  return (
    <div className="space-y-3">
      <div>
        <Label className="text-xs">Cron Expression</Label>
        <Input
          className="h-8 text-xs mt-1 font-mono"
          value={String(config.expression ?? '0 9 * * *')}
          onChange={(e) => updateField('expression', e.target.value)}
          placeholder="0 9 * * *"
        />
      </div>
      <div>
        <Label className="text-xs">Timezone</Label>
        <Input
          className="h-8 text-xs mt-1"
          value={String(config.timezone ?? 'UTC')}
          onChange={(e) => updateField('timezone', e.target.value)}
        />
      </div>
    </div>
  );
}

function EventConfig({ config, updateField }: ConfigProps) {
  return (
    <div className="space-y-3">
      <div>
        <Label className="text-xs">Event Name</Label>
        <select
          className="w-full h-8 text-xs rounded-md border border-input bg-background px-2 mt-1"
          value={String(config.eventName ?? 'session_completed')}
          onChange={(e) => updateField('eventName', e.target.value)}
        >
          <option value="session_completed">Session Completed</option>
          <option value="pr_created">PR Created</option>
          <option value="pr_merged">PR Merged</option>
          <option value="check_failure">Check Failure</option>
          <option value="branch_changed">Branch Changed</option>
        </select>
      </div>
    </div>
  );
}

function ConditionalConfig({ config, updateField }: ConfigProps) {
  return (
    <div className="space-y-3">
      <div>
        <Label className="text-xs">Field</Label>
        <Input
          className="h-8 text-xs mt-1 font-mono"
          value={String(config.field ?? '')}
          onChange={(e) => updateField('field', e.target.value)}
          placeholder="input.status"
        />
      </div>
      <div>
        <Label className="text-xs">Operator</Label>
        <select
          className="w-full h-8 text-xs rounded-md border border-input bg-background px-2 mt-1"
          value={String(config.operator ?? 'equals')}
          onChange={(e) => updateField('operator', e.target.value)}
        >
          <option value="equals">Equals</option>
          <option value="not_equals">Not Equals</option>
          <option value="contains">Contains</option>
          <option value="gt">Greater Than</option>
          <option value="lt">Less Than</option>
          <option value="exists">Exists</option>
        </select>
      </div>
      <div>
        <Label className="text-xs">Value</Label>
        <Input
          className="h-8 text-xs mt-1"
          value={String(config.value ?? '')}
          onChange={(e) => updateField('value', e.target.value)}
        />
      </div>
    </div>
  );
}

function DelayConfig({ config, updateField }: ConfigProps) {
  return (
    <div className="space-y-3">
      <div>
        <Label className="text-xs">Duration (seconds)</Label>
        <Input
          type="number"
          className="h-8 text-xs mt-1"
          value={String(config.durationSecs ?? 60)}
          onChange={(e) => updateField('durationSecs', Number(e.target.value))}
        />
      </div>
    </div>
  );
}

function TransformConfig({ config, updateField }: ConfigProps) {
  return (
    <div className="space-y-3">
      <div>
        <Label className="text-xs">Template</Label>
        <Textarea
          className="text-xs mt-1 min-h-[100px] font-mono"
          value={String(config.template ?? '')}
          onChange={(e) => updateField('template', e.target.value)}
          placeholder='{"result": "{{.input.data}}"}'
        />
      </div>
    </div>
  );
}

function VariableConfig({ config, updateField }: ConfigProps) {
  return (
    <div className="space-y-3">
      <div>
        <Label className="text-xs">Variable Name</Label>
        <Input
          className="h-8 text-xs mt-1 font-mono"
          value={String(config.name ?? '')}
          onChange={(e) => updateField('name', e.target.value)}
        />
      </div>
      <div>
        <Label className="text-xs">Value</Label>
        <Input
          className="h-8 text-xs mt-1"
          value={String(config.value ?? '')}
          onChange={(e) => updateField('value', e.target.value)}
        />
      </div>
    </div>
  );
}

function ErrorHandlingConfig({ config, updateField }: ConfigProps) {
  const onFailure = String(config.onFailure ?? 'stop');

  return (
    <div className="space-y-3 border-t pt-3">
      <Label className="text-xs font-semibold text-muted-foreground">Error Handling</Label>
      <div>
        <Label className="text-xs">On Failure</Label>
        <select
          className="w-full h-8 text-xs rounded-md border border-input bg-background px-2 mt-1"
          value={onFailure}
          onChange={(e) => updateField('onFailure', e.target.value)}
        >
          <option value="stop">Stop workflow</option>
          <option value="skip">Skip and continue</option>
          <option value="retry">Retry with backoff</option>
        </select>
      </div>
      {onFailure === 'retry' && (
        <div>
          <Label className="text-xs">Max Retries</Label>
          <Input
            type="number"
            min={1}
            max={10}
            className="h-8 text-xs mt-1"
            value={String(config.maxRetries ?? 3)}
            onChange={(e) => updateField('maxRetries', Number(e.target.value))}
          />
          <p className="text-[10px] text-muted-foreground mt-0.5">
            Exponential backoff: 1s, 2s, 4s, 8s...
          </p>
        </div>
      )}
    </div>
  );
}
