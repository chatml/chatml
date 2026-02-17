/**
 * Pre-built workflow templates that populate the graph when creating a new workflow.
 * Each template provides a name, description, and pre-connected graph JSON.
 */

export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  graphJson: string;
}

function makeGraph(
  nodes: Array<{ id: string; type: string; x: number; y: number; data: Record<string, unknown> }>,
  edges: Array<{ id: string; source: string; target: string }>,
): string {
  return JSON.stringify({
    nodes: nodes.map((n) => ({
      id: n.id,
      type: n.type,
      position: { x: n.x, y: n.y },
      data: n.data,
    })),
    edges: edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      type: 'dataflow',
    })),
  });
}

export const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  {
    id: 'pr-review',
    name: 'PR Review Pipeline',
    description: 'Automatically review PRs, check for issues, and auto-fix',
    graphJson: makeGraph(
      [
        { id: 'trigger', type: 'trigger-event', x: 200, y: 0, data: { kind: 'trigger-event', label: 'PR Created', config: { eventName: 'pr_created' } } },
        { id: 'review', type: 'action-agent', x: 200, y: 120, data: { kind: 'action-agent', label: 'Code Review', config: { workspaceMode: 'from-input', instructions: 'Review the PR changes. Check for bugs, security issues, and style problems. Output a JSON summary with { hasIssues: boolean, summary: string }.', model: 'claude-sonnet-4-5-20250929', toolPreset: 'read-only' } } },
        { id: 'check', type: 'logic-conditional', x: 200, y: 260, data: { kind: 'logic-conditional', label: 'Has Issues?', config: { field: 'input.hasIssues', operator: 'equals', value: 'true' } } },
        { id: 'fix', type: 'action-agent', x: 200, y: 400, data: { kind: 'action-agent', label: 'Auto Fix', config: { workspaceMode: 'from-input', instructions: 'Fix the issues identified in the review. Create a commit with the changes.', model: 'claude-sonnet-4-5-20250929', toolPreset: 'full' } } },
      ],
      [
        { id: 'e1', source: 'trigger', target: 'review' },
        { id: 'e2', source: 'review', target: 'check' },
        { id: 'e3', source: 'check', target: 'fix' },
      ],
    ),
  },
  {
    id: 'ci-triage',
    name: 'CI Failure Auto-Triage',
    description: 'Analyze CI failures and create issues or apply fixes',
    graphJson: makeGraph(
      [
        { id: 'trigger', type: 'trigger-webhook', x: 200, y: 0, data: { kind: 'trigger-webhook', label: 'CI Webhook', config: {} } },
        { id: 'analyze', type: 'action-agent', x: 200, y: 120, data: { kind: 'action-agent', label: 'Analyze Failure', config: { workspaceMode: 'scratch', instructions: 'Analyze the CI failure logs provided in the webhook payload. Determine root cause and whether it can be auto-fixed. Output { canFix: boolean, rootCause: string, suggestion: string }.', model: 'claude-sonnet-4-5-20250929', toolPreset: 'read-only' } } },
        { id: 'check', type: 'logic-conditional', x: 200, y: 260, data: { kind: 'logic-conditional', label: 'Can Fix?', config: { field: 'input.canFix', operator: 'equals', value: 'true' } } },
        { id: 'fix', type: 'action-agent', x: 50, y: 400, data: { kind: 'action-agent', label: 'Apply Fix', config: { workspaceMode: 'from-input', instructions: 'Apply the suggested fix for the CI failure.', model: 'claude-sonnet-4-5-20250929', toolPreset: 'full' } } },
        { id: 'notify', type: 'action-webhook', x: 350, y: 400, data: { kind: 'action-webhook', label: 'Create Issue', config: { method: 'POST', url: '', bodyTemplate: '{"title": "CI Failure: {{.input.rootCause}}", "body": "{{.input.suggestion}}"}' } } },
      ],
      [
        { id: 'e1', source: 'trigger', target: 'analyze' },
        { id: 'e2', source: 'analyze', target: 'check' },
        { id: 'e3', source: 'check', target: 'fix' },
        { id: 'e4', source: 'check', target: 'notify' },
      ],
    ),
  },
  {
    id: 'cron-report',
    name: 'Scheduled Report',
    description: 'Generate a report on a schedule and send via webhook',
    graphJson: makeGraph(
      [
        { id: 'trigger', type: 'trigger-cron', x: 200, y: 0, data: { kind: 'trigger-cron', label: 'Daily 9am', config: { expression: '0 0 9 * * *', timezone: 'UTC' } } },
        { id: 'research', type: 'action-agent', x: 200, y: 120, data: { kind: 'action-agent', label: 'Research', config: { workspaceMode: 'scratch', instructions: 'Gather and summarize relevant data for the daily report.', model: 'claude-sonnet-4-5-20250929', toolPreset: 'full' } } },
        { id: 'transform', type: 'data-transform', x: 200, y: 260, data: { kind: 'data-transform', label: 'Format Report', config: { template: '{"report": "{{.input.lastMessage}}", "date": "{{.trigger.timestamp}}"}' } } },
        { id: 'send', type: 'action-webhook', x: 200, y: 380, data: { kind: 'action-webhook', label: 'Post Report', config: { method: 'POST', url: '', headers: '{"Content-Type": "application/json"}', bodyTemplate: '{{.input}}' } } },
      ],
      [
        { id: 'e1', source: 'trigger', target: 'research' },
        { id: 'e2', source: 'research', target: 'transform' },
        { id: 'e3', source: 'transform', target: 'send' },
      ],
    ),
  },
  {
    id: 'multi-step-agent',
    name: 'Multi-Step Agent Pipeline',
    description: 'Chain multiple agent steps with data passing',
    graphJson: makeGraph(
      [
        { id: 'trigger', type: 'trigger-manual', x: 200, y: 0, data: { kind: 'trigger-manual', label: 'Manual Trigger', config: {} } },
        { id: 'step1', type: 'action-agent', x: 200, y: 120, data: { kind: 'action-agent', label: 'Step 1: Analyze', config: { workspaceMode: 'scratch', instructions: 'Analyze the input and produce structured output.', model: 'claude-sonnet-4-5-20250929', toolPreset: 'full' } } },
        { id: 'step2', type: 'action-agent', x: 200, y: 260, data: { kind: 'action-agent', label: 'Step 2: Execute', config: { workspaceMode: 'scratch', instructions: 'Based on the analysis from the previous step, execute the required actions.', model: 'claude-sonnet-4-5-20250929', toolPreset: 'full' } } },
        { id: 'step3', type: 'action-agent', x: 200, y: 400, data: { kind: 'action-agent', label: 'Step 3: Verify', config: { workspaceMode: 'scratch', instructions: 'Verify the results from the previous steps and produce a final summary.', model: 'claude-sonnet-4-5-20250929', toolPreset: 'read-only' } } },
      ],
      [
        { id: 'e1', source: 'trigger', target: 'step1' },
        { id: 'e2', source: 'step1', target: 'step2' },
        { id: 'e3', source: 'step2', target: 'step3' },
      ],
    ),
  },
];
