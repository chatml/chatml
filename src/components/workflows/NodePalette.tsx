'use client';

import { useCallback } from 'react';
import { getNodeKindsByCategory, CATEGORY_COLORS, type NodeKindDefinition, type NodeCategory } from './nodes/nodeRegistry';
import { cn } from '@/lib/utils';
import {
  Hand, Clock, Webhook, Zap, Bot, Globe, Terminal,
  GitBranch, Timer, Repeat, GitFork, Shuffle, Variable,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

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

const CATEGORY_LABELS: Record<NodeCategory, string> = {
  trigger: 'Triggers',
  action: 'Actions',
  logic: 'Logic',
  data: 'Data',
};

// Module-level drag state: works around webviews (e.g. Tauri/WKWebView) that
// don't reliably transfer custom MIME types via dataTransfer or fire drop events.
let _draggedNodeKind: string | null = null;
let _lastDragOverClientPos: { x: number; y: number } | null = null;

export function getDraggedNodeKind(): string | null {
  const kind = _draggedNodeKind;
  _draggedNodeKind = null;
  return kind;
}

export function setLastDragOverPosition(x: number, y: number): void {
  _lastDragOverClientPos = { x, y };
}

function PaletteItem({ kind }: { kind: NodeKindDefinition }) {
  const colors = CATEGORY_COLORS[kind.category];
  const Icon = NODE_ICONS[kind.kind] ?? Zap;

  const onDragStart = useCallback(
    (event: React.DragEvent) => {
      // Store kind in dataTransfer and also in a module-level variable
      // as a fallback for webviews that don't support custom MIME types.
      event.dataTransfer.setData('application/workflow-node-kind', kind.kind);
      event.dataTransfer.setData('text/plain', kind.kind);
      event.dataTransfer.effectAllowed = 'move';
      _draggedNodeKind = kind.kind;
    },
    [kind.kind],
  );

  const onDragEnd = useCallback(
    (event: React.DragEvent) => {
      // Fallback for Tauri/WKWebView where the `drop` event may not fire.
      // If _draggedNodeKind is still set, the drop handler never consumed it.
      if (!_draggedNodeKind) return;
      const nodeKind = _draggedNodeKind;
      _draggedNodeKind = null;
      // Use the last known dragover position (more reliable than dragend coords
      // which Safari/WKWebView sometimes reports as 0,0).
      const pos = _lastDragOverClientPos ?? (
        event.clientX !== 0 || event.clientY !== 0
          ? { x: event.clientX, y: event.clientY }
          : null
      );
      _lastDragOverClientPos = null;
      // Last resort: use center of window if no position is available
      const finalPos = pos ?? { x: window.innerWidth / 2, y: window.innerHeight / 2 };
      window.dispatchEvent(new CustomEvent('workflow-node-drop-fallback', {
        detail: { kind: nodeKind, clientX: finalPos.x, clientY: finalPos.y },
      }));
    },
    [],
  );

  return (
    <div
      className={cn(
        'flex items-center gap-2 px-2 py-1.5 rounded-md cursor-grab hover:bg-muted/50 transition-colors',
        'active:cursor-grabbing',
      )}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
      <div className={cn('flex items-center justify-center w-6 h-6 rounded shrink-0', colors.bg)}>
        <Icon className={cn('h-3 w-3', colors.icon)} />
      </div>
      <div className="min-w-0">
        <div className="text-xs font-medium truncate">{kind.label}</div>
        <div className="text-[10px] text-muted-foreground truncate">{kind.description}</div>
      </div>
    </div>
  );
}

export function NodePalette() {
  const grouped = getNodeKindsByCategory();

  return (
    <div className="p-2 space-y-3">
      <div className="px-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        Nodes
      </div>
      {(Object.keys(grouped) as NodeCategory[]).map((category) => (
        <div key={category}>
          <div className="px-2 pb-1 text-[10px] font-medium text-muted-foreground">
            {CATEGORY_LABELS[category]}
          </div>
          <div className="space-y-0.5">
            {grouped[category].map((kind) => (
              <PaletteItem key={kind.kind} kind={kind} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
