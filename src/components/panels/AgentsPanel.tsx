'use client';

import { useAppStore } from '@/stores/appStore';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Bot,
  Circle,
  Play,
  Pause,
  Square,
  MoreHorizontal,
  GitBranch,
  Clock,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

interface Agent {
  id: string;
  sessionId: string;
  sessionName: string;
  workspaceName: string;
  status: 'running' | 'paused' | 'idle' | 'error';
  task: string;
  startedAt: string;
}

export function AgentsPanel() {
  const { sessions, workspaces } = useAppStore();

  // Mock agents data - in real app this would come from the store
  const agents: Agent[] = sessions
    .filter((s) => s.status === 'active')
    .map((s) => {
      const workspace = workspaces.find((w) => w.id === s.workspaceId);
      return {
        id: `agent-${s.id}`,
        sessionId: s.id,
        sessionName: s.name,
        workspaceName: workspace?.name || 'Unknown',
        status: 'running' as const,
        task: s.task || 'Working...',
        startedAt: s.updatedAt,
      };
    });

  const getStatusColor = (status: Agent['status']) => {
    switch (status) {
      case 'running':
        return 'text-text-success';
      case 'paused':
        return 'text-text-warning';
      case 'error':
        return 'text-text-error';
      default:
        return 'text-muted-foreground';
    }
  };

  const formatTimeAgo = (date: string) => {
    const now = new Date();
    const then = new Date(date);
    const diffMs = now.getTime() - then.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays}d ago`;
  };

  return (
    <div className="flex flex-col h-full bg-sidebar text-sidebar-foreground">
      {/* Header */}
      <div className="h-11 flex items-center gap-2 px-3 border-b border-sidebar-border shrink-0">
        <Bot className="w-4 h-4 text-muted-foreground" />
        <span className="text-sm font-semibold">Agents</span>
        <div className="flex-1" />
        {agents.length > 0 && (
          <span className="text-xs text-muted-foreground">
            {agents.filter((a) => a.status === 'running').length} running
          </span>
        )}
      </div>

      {/* Agents List */}
      <ScrollArea className="flex-1">
        {agents.length === 0 ? (
          <div className="px-3 py-12 text-center">
            <div className="w-12 h-12 rounded-full bg-muted/50 flex items-center justify-center mx-auto mb-3">
              <Bot className="w-6 h-6 text-muted-foreground/50" />
            </div>
            <p className="text-sm text-muted-foreground">No active agents</p>
            <p className="text-xs text-muted-foreground/70 mt-1">
              Start a session to spawn an agent
            </p>
          </div>
        ) : (
          <div className="p-2">
            {agents.map((agent) => (
              <div
                key={agent.id}
                className="group p-2 rounded-md hover:bg-sidebar-accent cursor-pointer mb-1"
              >
                <div className="flex items-start gap-2">
                  <div className="mt-1">
                    <Circle
                      className={cn('w-2 h-2 fill-current', getStatusColor(agent.status))}
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <GitBranch className="w-3 h-3 text-muted-foreground shrink-0" />
                      <span className="text-sm font-medium truncate">
                        {agent.sessionName}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground truncate mt-0.5">
                      {agent.task}
                    </p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-[10px] text-muted-foreground/70">
                        {agent.workspaceName}
                      </span>
                      <span className="text-[10px] text-muted-foreground/70 flex items-center gap-1">
                        <Clock className="w-2.5 h-2.5" />
                        {formatTimeAgo(agent.startedAt)}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    {agent.status === 'running' ? (
                      <Button variant="ghost" size="icon" className="h-6 w-6">
                        <Pause className="h-3 w-3" />
                      </Button>
                    ) : (
                      <Button variant="ghost" size="icon" className="h-6 w-6">
                        <Play className="h-3 w-3" />
                      </Button>
                    )}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-6 w-6">
                          <MoreHorizontal className="h-3 w-3" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem>View logs</DropdownMenuItem>
                        <DropdownMenuItem>Open session</DropdownMenuItem>
                        <DropdownMenuItem className="text-destructive">
                          <Square className="size-3.5" />
                          Stop agent
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
