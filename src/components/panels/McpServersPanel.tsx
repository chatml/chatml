'use client';

import { useMcpServers } from '@/stores/selectors';
import { ScrollArea } from '@/components/ui/scroll-area';
import { EmptyState } from '@/components/ui/empty-state';
import { Server, CheckCircle2, XCircle, AlertCircle, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { McpServerStatus } from '@/lib/types';

const STATUS_CONFIG = {
  connected: {
    icon: CheckCircle2,
    color: 'text-text-success',
    bgColor: 'bg-text-success/10',
    label: 'Connected',
  },
  failed: {
    icon: XCircle,
    color: 'text-text-error',
    bgColor: 'bg-text-error/10',
    label: 'Failed',
  },
  'needs-auth': {
    icon: AlertCircle,
    color: 'text-text-warning',
    bgColor: 'bg-text-warning/10',
    label: 'Needs Auth',
  },
  pending: {
    icon: Clock,
    color: 'text-muted-foreground',
    bgColor: 'bg-muted/50',
    label: 'Connecting...',
  },
} as const;

export function McpServersPanel() {
  const mcpServers = useMcpServers();

  if (!mcpServers || mcpServers.length === 0) {
    return (
      <div className="h-full flex items-center justify-center">
        <EmptyState
          icon={Server}
          title="No MCP servers"
          description="Servers will appear when agent starts"
        />
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="p-2 space-y-1">
        {mcpServers.map((server) => (
          <McpServerRow key={server.name} server={server} />
        ))}
      </div>
    </ScrollArea>
  );
}

function McpServerRow({ server }: { server: McpServerStatus }) {
  const config = STATUS_CONFIG[server.status] || STATUS_CONFIG.pending;
  const Icon = config.icon;

  return (
    <div
      className={cn(
        'flex items-center gap-2 px-2 py-1.5 rounded-md',
        config.bgColor
      )}
    >
      <Icon className={cn('w-3.5 h-3.5 shrink-0', config.color)} />
      <span className="text-sm font-medium flex-1 truncate">{server.name}</span>
      <span className={cn('text-xs', config.color)}>{config.label}</span>
    </div>
  );
}
