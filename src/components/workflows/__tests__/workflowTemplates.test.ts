import { describe, it, expect } from 'vitest';
import { WORKFLOW_TEMPLATES } from '../workflowTemplates';

describe('workflowTemplates', () => {
  it('exports at least one template', () => {
    expect(WORKFLOW_TEMPLATES.length).toBeGreaterThan(0);
  });

  it('each template has required fields', () => {
    for (const template of WORKFLOW_TEMPLATES) {
      expect(template.id).toBeTruthy();
      expect(template.name).toBeTruthy();
      expect(template.description).toBeTruthy();
      expect(template.graphJson).toBeTruthy();
    }
  });

  it('each template has unique id', () => {
    const ids = WORKFLOW_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('each template graphJson is valid JSON with nodes and edges', () => {
    for (const template of WORKFLOW_TEMPLATES) {
      const graph = JSON.parse(template.graphJson);
      expect(Array.isArray(graph.nodes)).toBe(true);
      expect(Array.isArray(graph.edges)).toBe(true);
      expect(graph.nodes.length).toBeGreaterThan(0);
    }
  });

  it('each node in templates has required fields', () => {
    for (const template of WORKFLOW_TEMPLATES) {
      const graph = JSON.parse(template.graphJson);
      for (const node of graph.nodes) {
        expect(node.id).toBeTruthy();
        expect(node.type).toBeTruthy();
        expect(node.position).toBeDefined();
        expect(typeof node.position.x).toBe('number');
        expect(typeof node.position.y).toBe('number');
        expect(node.data).toBeDefined();
        expect(node.data.kind).toBeTruthy();
        expect(node.data.label).toBeTruthy();
      }
    }
  });

  it('each edge references existing node ids', () => {
    for (const template of WORKFLOW_TEMPLATES) {
      const graph = JSON.parse(template.graphJson);
      const nodeIds = new Set(graph.nodes.map((n: { id: string }) => n.id));
      for (const edge of graph.edges) {
        expect(nodeIds.has(edge.source)).toBe(true);
        expect(nodeIds.has(edge.target)).toBe(true);
      }
    }
  });

  it('each template starts with a trigger node', () => {
    for (const template of WORKFLOW_TEMPLATES) {
      const graph = JSON.parse(template.graphJson);
      const triggerNodes = graph.nodes.filter((n: { type: string }) =>
        n.type.startsWith('trigger-')
      );
      expect(triggerNodes.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('edges have consistent dataflow type', () => {
    for (const template of WORKFLOW_TEMPLATES) {
      const graph = JSON.parse(template.graphJson);
      for (const edge of graph.edges) {
        expect(edge.type).toBe('dataflow');
      }
    }
  });

  describe('specific templates', () => {
    it('has PR Review Pipeline template', () => {
      const t = WORKFLOW_TEMPLATES.find((t) => t.id === 'pr-review');
      expect(t).toBeDefined();
      const graph = JSON.parse(t!.graphJson);
      expect(graph.nodes).toHaveLength(4);
      expect(graph.edges).toHaveLength(3);
    });

    it('has CI Failure Auto-Triage template', () => {
      const t = WORKFLOW_TEMPLATES.find((t) => t.id === 'ci-triage');
      expect(t).toBeDefined();
      const graph = JSON.parse(t!.graphJson);
      expect(graph.nodes).toHaveLength(5);
      expect(graph.edges).toHaveLength(4);
    });

    it('has Scheduled Report template', () => {
      const t = WORKFLOW_TEMPLATES.find((t) => t.id === 'cron-report');
      expect(t).toBeDefined();
      const graph = JSON.parse(t!.graphJson);
      // Linear chain: trigger -> research -> transform -> send
      expect(graph.nodes).toHaveLength(4);
      expect(graph.edges).toHaveLength(3);
    });

    it('has Multi-Step Agent Pipeline template', () => {
      const t = WORKFLOW_TEMPLATES.find((t) => t.id === 'multi-step-agent');
      expect(t).toBeDefined();
      const graph = JSON.parse(t!.graphJson);
      expect(graph.nodes).toHaveLength(4);
      expect(graph.edges).toHaveLength(3);
    });
  });
});
