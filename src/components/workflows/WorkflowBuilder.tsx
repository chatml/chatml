'use client';

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useWorkflowStore } from '@/stores/workflowStore';
import { FullContentLayout } from '@/components/layout/FullContentLayout';
import { useMainToolbarContent } from '@/hooks/useMainToolbarContent';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { navigate } from '@/lib/navigation';
import {
  ArrowLeft,
  Save,
  Play,
  Workflow,
  Loader2,
  LayoutGrid,
} from 'lucide-react';
import { WorkflowCanvas, type WorkflowCanvasHandle } from './WorkflowCanvas';
import { NodePalette } from './NodePalette';
import { NodeConfigPanel } from './NodeConfigPanel';
import { WorkflowRunPanel } from './WorkflowRunPanel';
import type { WorkflowDefinition } from '@/lib/types';
import type { Node, Edge } from '@xyflow/react';
import type { WorkflowNodeData } from './nodes/nodeRegistry';

interface GraphState {
  nodes: Node<WorkflowNodeData>[];
  edges: Edge[];
  viewport?: { x: number; y: number; zoom: number };
}

function parseGraphJSON(json: string): GraphState {
  try {
    const parsed = JSON.parse(json);
    return {
      nodes: parsed.nodes || [],
      edges: parsed.edges || [],
      viewport: parsed.viewport,
    };
  } catch {
    return { nodes: [], edges: [] };
  }
}

interface WorkflowBuilderProps {
  workflowId?: string;
}

export function WorkflowBuilder({ workflowId }: WorkflowBuilderProps) {
  const { workflows, fetchWorkflows, updateWorkflow } = useWorkflowStore();
  const [workflow, setWorkflow] = useState<WorkflowDefinition | null>(null);
  const [name, setName] = useState('');
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [showPalette, setShowPalette] = useState(true);

  // Graph state refs for save (avoid re-render on every node move)
  const nodesRef = useRef<Node<WorkflowNodeData>[]>([]);
  const edgesRef = useRef<Edge[]>([]);
  const canvasRef = useRef<WorkflowCanvasHandle>(null);

  useEffect(() => {
    if (workflows.length === 0) {
      fetchWorkflows();
    }
  }, [workflows.length, fetchWorkflows]);

  useEffect(() => {
    if (workflowId && workflows.length > 0) {
      const found = workflows.find((w) => w.id === workflowId);
      if (found) {
        setWorkflow(found);
        setName(found.name);
        const graph = parseGraphJSON(found.graphJson);
        nodesRef.current = graph.nodes;
        edgesRef.current = graph.edges;
      }
    }
  }, [workflowId, workflows]);

  const handleBack = useCallback(() => {
    navigate({ contentView: { type: 'workflows' } });
  }, []);

  const handleSave = useCallback(async () => {
    if (!workflow) return;
    setIsSaving(true);
    try {
      const graphJson = JSON.stringify({
        nodes: nodesRef.current,
        edges: edgesRef.current,
      });
      await updateWorkflow(workflow.id, { name, graphJson });
      setIsDirty(false);
    } finally {
      setIsSaving(false);
    }
  }, [workflow, name, updateWorkflow]);

  const handleNameChange = useCallback((value: string) => {
    setName(value);
    setIsDirty(true);
  }, []);

  const handleNodesChange = useCallback((nodes: Node<WorkflowNodeData>[]) => {
    nodesRef.current = nodes;
    setIsDirty(true);
  }, []);

  const handleEdgesChange = useCallback((edges: Edge[]) => {
    edgesRef.current = edges;
    setIsDirty(true);
  }, []);

  const handleNodeSelect = useCallback((nodeId: string | null) => {
    setSelectedNodeId(nodeId);
  }, []);

  const handleNodeConfigChange = useCallback((nodeId: string, config: Record<string, unknown>) => {
    nodesRef.current = nodesRef.current.map((n) =>
      n.id === nodeId ? { ...n, data: { ...n.data, config } } : n
    );
    setIsDirty(true);
  }, []);

  // Initial graph from workflow
  const initialGraph = useMemo(() => {
    if (!workflow) return { nodes: [], edges: [] };
    return parseGraphJSON(workflow.graphJson);
  }, [workflow]);

  // Selected node data for config panel
  const selectedNode = selectedNodeId
    ? nodesRef.current.find((n) => n.id === selectedNodeId)
    : null;

  // Toolbar content
  const toolbarConfig = useMemo(() => ({
    leading: (
      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleBack} title="Back to workflows">
        <ArrowLeft className="h-4 w-4" />
      </Button>
    ),
    title: (
      <div className="flex items-center gap-1.5">
        <Workflow className="h-4 w-4 text-muted-foreground shrink-0" />
        <Input
          value={name}
          onChange={(e) => handleNameChange(e.target.value)}
          className="h-7 text-sm font-medium max-w-xs"
          placeholder="Workflow name"
        />
      </div>
    ),
    actions: (
      <div className="flex items-center gap-1.5">
        <Button
          size="sm"
          variant="ghost"
          className="h-7 text-xs gap-1"
          onClick={() => canvasRef.current?.autoLayout()}
          title="Auto-layout nodes"
        >
          <LayoutGrid className="h-3.5 w-3.5" />
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs gap-1"
          disabled={!isDirty || isSaving}
          onClick={handleSave}
        >
          {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          Save
        </Button>
        <Button
          size="sm"
          className="h-7 text-xs gap-1"
          disabled={!workflow?.enabled}
          title="Run workflow"
        >
          <Play className="h-3.5 w-3.5" /> Run
        </Button>
      </div>
    ),
  }), [name, isDirty, isSaving, workflow?.enabled, handleBack, handleSave, handleNameChange]);
  useMainToolbarContent(toolbarConfig);

  if (!workflow) {
    return (
      <FullContentLayout>
        <div className="flex items-center justify-center h-full">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      </FullContentLayout>
    );
  }

  return (
    <FullContentLayout>
      <div className="flex flex-col h-full">
        <div className="flex flex-1 min-h-0">
          {/* Left: Node Palette */}
          {showPalette && (
            <div className="w-52 border-r border-border shrink-0 overflow-y-auto">
              <NodePalette />
            </div>
          )}

          {/* Center: Canvas */}
          <div className="flex-1 min-w-0">
            <WorkflowCanvas
              ref={canvasRef}
              initialNodes={initialGraph.nodes}
              initialEdges={initialGraph.edges}
              onNodesChange={handleNodesChange}
              onEdgesChange={handleEdgesChange}
              onNodeSelect={handleNodeSelect}
            />
          </div>

          {/* Right: Config Panel */}
          {selectedNode && (
            <div className="w-72 border-l border-border shrink-0 overflow-y-auto">
              <NodeConfigPanel
                nodeId={selectedNode.id}
                kind={selectedNode.data.kind}
                config={selectedNode.data.config}
                onChange={(config) => handleNodeConfigChange(selectedNode.id, config)}
              />
            </div>
          )}
        </div>

        {/* Bottom: Run Panel */}
        <WorkflowRunPanel workflowId={workflow.id} />
      </div>
    </FullContentLayout>
  );
}
