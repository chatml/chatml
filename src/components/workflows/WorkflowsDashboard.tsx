'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useWorkflowStore } from '@/stores/workflowStore';
import { FullContentLayout } from '@/components/layout/FullContentLayout';
import { useMainToolbarContent } from '@/hooks/useMainToolbarContent';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { navigate } from '@/lib/navigation';
import {
  Plus,
  Search,
  Workflow,
  MoreVertical,
  Trash2,
  Play,
  ToggleLeft,
  ToggleRight,
  Loader2,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuLabel,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import type { WorkflowDefinition } from '@/lib/types';
import { WORKFLOW_TEMPLATES, type WorkflowTemplate } from './workflowTemplates';

function WorkflowRow({
  workflow,
  onOpen,
  onToggle,
  onDelete,
  onRun,
}: {
  workflow: WorkflowDefinition;
  onOpen: (id: string) => void;
  onToggle: (id: string, enabled: boolean) => void;
  onDelete: (id: string) => void;
  onRun: (id: string) => void;
}) {
  return (
    <div
      className="flex items-center gap-3 px-4 py-3 hover:bg-muted/50 cursor-pointer border-b border-border/50 transition-colors"
      onClick={() => onOpen(workflow.id)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen(workflow.id);
        }
      }}
    >
      <div className={cn(
        'flex items-center justify-center w-8 h-8 rounded-md shrink-0',
        workflow.enabled ? 'bg-emerald-500/10 text-emerald-500' : 'bg-muted text-muted-foreground'
      )}>
        <Workflow className="h-4 w-4" />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm truncate">{workflow.name}</span>
          {!workflow.enabled && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
              Disabled
            </span>
          )}
        </div>
        {workflow.description && (
          <p className="text-xs text-muted-foreground truncate mt-0.5">{workflow.description}</p>
        )}
      </div>

      <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          title="Run workflow"
          disabled={!workflow.enabled}
          onClick={() => onRun(workflow.id)}
        >
          <Play className="h-3.5 w-3.5" />
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-7 w-7">
              <MoreVertical className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => onToggle(workflow.id, !workflow.enabled)}>
              {workflow.enabled ? (
                <><ToggleLeft className="size-4" /> Disable</>
              ) : (
                <><ToggleRight className="size-4" /> Enable</>
              )}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive"
              onClick={() => onDelete(workflow.id)}
            >
              <Trash2 className="size-4" /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

export function WorkflowsDashboard() {
  const { workflows, isLoading, fetchWorkflows, createWorkflow, updateWorkflow, deleteWorkflow, toggleWorkflow, triggerRun } = useWorkflowStore();
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    fetchWorkflows();
  }, [fetchWorkflows]);

  const filteredWorkflows = searchQuery
    ? workflows.filter((w) =>
        w.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (w.description?.toLowerCase().includes(searchQuery.toLowerCase()))
      )
    : workflows;

  const handleCreate = useCallback(async (template?: WorkflowTemplate) => {
    const name = template?.name ?? 'New Workflow';
    const description = template?.description;
    const workflow = await createWorkflow(name, description);
    if (template) {
      await updateWorkflow(workflow.id, { graphJson: template.graphJson });
    }
    navigate({ contentView: { type: 'workflow-builder', workflowId: workflow.id } });
  }, [createWorkflow, updateWorkflow]);

  const handleOpen = useCallback((id: string) => {
    navigate({ contentView: { type: 'workflow-builder', workflowId: id } });
  }, []);

  const handleDelete = useCallback(async (id: string) => {
    await deleteWorkflow(id);
  }, [deleteWorkflow]);

  const handleToggle = useCallback(async (id: string, enabled: boolean) => {
    await toggleWorkflow(id, enabled);
  }, [toggleWorkflow]);

  const handleRun = useCallback(async (id: string) => {
    await triggerRun(id);
  }, [triggerRun]);

  // Toolbar content
  const toolbarConfig = useMemo(() => ({
    titlePosition: 'center' as const,
    title: (
      <span className="flex items-center gap-1.5 shrink-0">
        <Workflow className="h-4 w-4 text-muted-foreground" />
        <h1 className="text-base font-semibold">Workflows</h1>
      </span>
    ),
    actions: (
      <div className="flex items-center gap-1.5">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
          <Input
            placeholder="Search..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-7 w-40 text-xs pl-7"
          />
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" className="h-7 text-xs gap-1">
              <Plus className="h-3.5 w-3.5" /> New
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem onClick={() => handleCreate()}>
              <Plus className="size-4" /> Blank Workflow
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-[10px] text-muted-foreground">Templates</DropdownMenuLabel>
            {WORKFLOW_TEMPLATES.map((t) => (
              <DropdownMenuItem key={t.id} onClick={() => handleCreate(t)}>
                <Workflow className="size-4" />
                <div className="flex flex-col">
                  <span>{t.name}</span>
                  <span className="text-[10px] text-muted-foreground">{t.description}</span>
                </div>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    ),
  }), [searchQuery, handleCreate]);
  useMainToolbarContent(toolbarConfig);

  return (
    <FullContentLayout>
      <div className="h-full overflow-y-auto">
        {isLoading && workflows.length === 0 ? (
          <div className="flex items-center justify-center h-32">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : filteredWorkflows.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-center px-4">
            <Workflow className="h-12 w-12 text-muted-foreground/30 mb-4" />
            <h3 className="text-sm font-medium mb-1">
              {searchQuery ? 'No workflows found' : 'No workflows yet'}
            </h3>
            <p className="text-xs text-muted-foreground mb-4">
              {searchQuery
                ? 'Try a different search term'
                : 'Create your first workflow to automate multi-step tasks'}
            </p>
            {!searchQuery && (
              <div className="flex gap-2">
                <Button size="sm" onClick={() => handleCreate()} className="gap-1">
                  <Plus className="h-3.5 w-3.5" /> Blank Workflow
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="sm" variant="outline" className="gap-1">
                      <Workflow className="h-3.5 w-3.5" /> From Template
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    {WORKFLOW_TEMPLATES.map((t) => (
                      <DropdownMenuItem key={t.id} onClick={() => handleCreate(t)}>
                        <div className="flex flex-col">
                          <span>{t.name}</span>
                          <span className="text-[10px] text-muted-foreground">{t.description}</span>
                        </div>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            )}
          </div>
        ) : (
          <div>
            {filteredWorkflows.map((workflow) => (
              <WorkflowRow
                key={workflow.id}
                workflow={workflow}
                onOpen={handleOpen}
                onToggle={handleToggle}
                onDelete={handleDelete}
                onRun={handleRun}
              />
            ))}
          </div>
        )}
      </div>
    </FullContentLayout>
  );
}
