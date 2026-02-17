'use client';

import { useCallback, useRef, useMemo, useImperativeHandle, forwardRef } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  type Connection,
  type Node,
  type Edge,
  type OnConnect,
  type ReactFlowInstance,
  BackgroundVariant,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import Dagre from '@dagrejs/dagre';

import { WORKFLOW_NODE_TYPES } from './nodes/WorkflowNodes';
import { DataFlowEdge } from './edges/DataFlowEdge';
import { getNodeKind, type WorkflowNodeData } from './nodes/nodeRegistry';

export interface WorkflowCanvasHandle {
  autoLayout: () => void;
}

const edgeTypes = { dataflow: DataFlowEdge };

interface WorkflowCanvasProps {
  initialNodes: Node<WorkflowNodeData>[];
  initialEdges: Edge[];
  onNodesChange?: (nodes: Node<WorkflowNodeData>[]) => void;
  onEdgesChange?: (edges: Edge[]) => void;
  onNodeSelect?: (nodeId: string | null) => void;
}

export const WorkflowCanvas = forwardRef<WorkflowCanvasHandle, WorkflowCanvasProps>(function WorkflowCanvas({
  initialNodes,
  initialEdges,
  onNodesChange: onNodesChangeCallback,
  onEdgesChange: onEdgesChangeCallback,
  onNodeSelect,
}, ref) {
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const reactFlowInstance = useRef<ReactFlowInstance<Node<WorkflowNodeData>, Edge> | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  const onConnect: OnConnect = useCallback(
    (connection: Connection) => {
      setEdges((eds) => addEdge({ ...connection, type: 'dataflow' }, eds));
    },
    [setEdges],
  );

  const onInit = useCallback((instance: ReactFlowInstance<Node<WorkflowNodeData>, Edge>) => {
    reactFlowInstance.current = instance;
  }, []);

  const autoLayout = useCallback(() => {
    const g = new Dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));
    g.setGraph({ rankdir: 'TB', nodesep: 60, ranksep: 80 });

    nodes.forEach((node) => {
      g.setNode(node.id, { width: 200, height: 80 });
    });
    edges.forEach((edge) => {
      g.setEdge(edge.source, edge.target);
    });

    Dagre.layout(g);

    setNodes((nds) =>
      nds.map((node) => {
        const pos = g.node(node.id);
        return { ...node, position: { x: pos.x - 100, y: pos.y - 40 } };
      }),
    );

    // Fit view after layout settles
    setTimeout(() => reactFlowInstance.current?.fitView({ padding: 0.2 }), 50);
  }, [nodes, edges, setNodes]);

  useImperativeHandle(ref, () => ({ autoLayout }), [autoLayout]);

  const onSelectionChange = useCallback(
    ({ nodes: selectedNodes }: { nodes: Node[] }) => {
      onNodeSelect?.(selectedNodes.length === 1 ? selectedNodes[0].id : null);
    },
    [onNodeSelect],
  );

  // Handle drop from palette
  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      const kind = event.dataTransfer.getData('application/workflow-node-kind');
      if (!kind || !reactFlowInstance.current) return;

      const kindDef = getNodeKind(kind);
      if (!kindDef) return;

      const position = reactFlowInstance.current.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });

      const newNode: Node<WorkflowNodeData> = {
        id: `${kind}-${Date.now()}`,
        type: kind,
        position,
        data: {
          kind,
          label: kindDef.label,
          config: { ...kindDef.defaultConfig },
        },
      };

      setNodes((nds) => [...nds, newNode]);
    },
    [setNodes],
  );

  // Sync changes back to parent
  const handleNodesChange: typeof onNodesChange = useCallback(
    (changes) => {
      onNodesChange(changes);
      // Defer callback to next tick so state is updated
      setTimeout(() => {
        onNodesChangeCallback?.(nodes);
      }, 0);
    },
    [onNodesChange, onNodesChangeCallback, nodes],
  );

  const handleEdgesChange: typeof onEdgesChange = useCallback(
    (changes) => {
      onEdgesChange(changes);
      setTimeout(() => {
        onEdgesChangeCallback?.(edges);
      }, 0);
    },
    [onEdgesChange, onEdgesChangeCallback, edges],
  );

  // Stable nodeTypes reference (React Flow re-renders if this changes)
  const nodeTypes = useMemo(() => WORKFLOW_NODE_TYPES, []);

  return (
    <div ref={reactFlowWrapper} className="h-full w-full" onDragOver={onDragOver} onDrop={onDrop}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={handleNodesChange}
        onEdgesChange={handleEdgesChange}
        onConnect={onConnect}
        onInit={onInit}
        onSelectionChange={onSelectionChange}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        defaultEdgeOptions={{ type: 'dataflow' }}
        fitView
        snapToGrid
        snapGrid={[16, 16]}
        deleteKeyCode={['Backspace', 'Delete']}
        className="bg-content-background"
      >
        <Background variant={BackgroundVariant.Dots} gap={16} size={1} className="opacity-30" />
        <Controls className="!shadow-md !rounded-lg !border !border-border" />
        <MiniMap
          className="!shadow-md !rounded-lg !border !border-border !bg-background"
          nodeColor={(node) => {
            const kind = (node.data as WorkflowNodeData)?.kind;
            const kindDef = getNodeKind(kind);
            switch (kindDef?.category) {
              case 'trigger': return '#10b981';
              case 'action': return '#6366f1';
              case 'logic': return '#f59e0b';
              case 'data': return '#a855f7';
              default: return '#6b7280';
            }
          }}
          maskColor="rgba(0, 0, 0, 0.1)"
        />
      </ReactFlow>
    </div>
  );
});
