'use client';

import { useCallback, useEffect, useState } from 'react';
import { useMcpServers } from '@/stores/selectors';
import { useAppStore } from '@/stores/appStore';
import { ScrollArea } from '@/components/ui/scroll-area';
import { EmptyState } from '@/components/ui/empty-state';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Server,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Clock,
  Plus,
  Pencil,
  Trash2,
  Settings2,
  Wrench,
  Minus,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { McpServerStatus, McpServerConfig } from '@/lib/types';

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
  idle: {
    icon: Minus,
    color: 'text-muted-foreground',
    bgColor: 'bg-muted/30',
    label: 'Idle',
  },
} as const;

const EMPTY_SERVER: McpServerConfig = {
  name: '',
  type: 'stdio',
  command: '',
  args: [],
  env: {},
  enabled: true,
};

export function McpServersPanel() {
  const mcpServers = useMcpServers();
  const workspaceId = useAppStore((s) => s.selectedWorkspaceId);
  const mcpServerConfigs = useAppStore((s) => s.mcpServerConfigs);
  const mcpConfigLoading = useAppStore((s) => s.mcpConfigLoading);
  const fetchMcpServerConfigs = useAppStore((s) => s.fetchMcpServerConfigs);
  const saveMcpServerConfigs = useAppStore((s) => s.saveMcpServerConfigs);
  const mcpToolsByServer = useAppStore((s) => s.mcpToolsByServer);

  const [showConfig, setShowConfig] = useState(false);
  const [editingServer, setEditingServer] = useState<McpServerConfig | null>(null);
  const [editingIndex, setEditingIndex] = useState<number>(-1);
  const [dialogOpen, setDialogOpen] = useState(false);

  // Load configs when workspace changes (needed for both status and config views)
  useEffect(() => {
    if (workspaceId) {
      fetchMcpServerConfigs(workspaceId);
    }
  }, [workspaceId, fetchMcpServerConfigs]);

  const handleAdd = useCallback(() => {
    setEditingServer({ ...EMPTY_SERVER });
    setEditingIndex(-1);
    setDialogOpen(true);
  }, []);

  const handleEdit = useCallback((config: McpServerConfig, index: number) => {
    setEditingServer({ ...config });
    setEditingIndex(index);
    setDialogOpen(true);
  }, []);

  const handleDelete = useCallback((index: number) => {
    if (!workspaceId) return;
    const updated = mcpServerConfigs.filter((_, i) => i !== index);
    saveMcpServerConfigs(workspaceId, updated);
  }, [workspaceId, mcpServerConfigs, saveMcpServerConfigs]);

  const handleToggle = useCallback((index: number) => {
    if (!workspaceId) return;
    const updated = mcpServerConfigs.map((s, i) =>
      i === index ? { ...s, enabled: !s.enabled } : s
    );
    saveMcpServerConfigs(workspaceId, updated);
  }, [workspaceId, mcpServerConfigs, saveMcpServerConfigs]);

  const handleSave = useCallback((server: McpServerConfig) => {
    if (!workspaceId) return;
    let updated: McpServerConfig[];
    if (editingIndex >= 0) {
      updated = mcpServerConfigs.map((s, i) => (i === editingIndex ? server : s));
    } else {
      updated = [...mcpServerConfigs, server];
    }
    saveMcpServerConfigs(workspaceId, updated);
    setDialogOpen(false);
  }, [workspaceId, mcpServerConfigs, editingIndex, saveMcpServerConfigs]);

  // Build a status lookup from runtime status
  const statusMap = new Map<string, McpServerStatus>();
  for (const s of mcpServers) {
    statusMap.set(s.name, s);
  }

  const hasContent = mcpServers.length > 0 || mcpServerConfigs.length > 0;

  return (
    <div className="h-full flex flex-col">
      {/* Header with toggle */}
      <div className="flex items-center justify-between px-2 py-1.5 border-b border-border/50">
        <button
          className={cn(
            'flex items-center gap-1.5 text-xs font-medium transition-colors',
            showConfig ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
          )}
          onClick={() => setShowConfig(!showConfig)}
        >
          <Settings2 className="w-3.5 h-3.5" />
          Configure
        </button>
        {showConfig && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0"
            onClick={handleAdd}
            disabled={!workspaceId}
          >
            <Plus className="w-3.5 h-3.5" />
          </Button>
        )}
      </div>

      <ScrollArea className="flex-1">
        {showConfig ? (
          // Configuration view
          <div className="p-2 space-y-1">
            {mcpConfigLoading && mcpServerConfigs.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-4">Loading...</p>
            )}
            {!mcpConfigLoading && mcpServerConfigs.length === 0 && (
              <EmptyState
                icon={Server}
                title="No MCP servers configured"
                description="Add servers to extend agent capabilities"
              />
            )}
            {mcpServerConfigs.map((config, i) => {
              const status = statusMap.get(config.name);
              return (
                <ConfigRow
                  key={`${config.name}-${i}`}
                  config={config}
                  status={status}
                  toolCount={mcpToolsByServer[config.name]?.length}
                  onEdit={() => handleEdit(config, i)}
                  onDelete={() => handleDelete(i)}
                  onToggle={() => handleToggle(i)}
                />
              );
            })}
          </div>
        ) : (
          // Runtime status view — shows live servers + configured idle ones
          <div className="p-2 space-y-1">
            {!hasContent && (
              <EmptyState
                icon={Server}
                title="No MCP servers"
                description="Servers will appear when agent starts"
              />
            )}
            {mcpServers.map((server) => (
              <StatusRow
                key={server.name}
                server={server}
                toolCount={mcpToolsByServer[server.name]?.length}
              />
            ))}
            {/* Show configured servers that aren't in runtime status as "idle" */}
            {mcpServerConfigs
              .filter((c) => c.enabled && !statusMap.has(c.name))
              .map((config) => (
                <StatusRow
                  key={`idle-${config.name}`}
                  server={{ name: config.name, status: 'idle' }}
                />
              ))}
          </div>
        )}
      </ScrollArea>

      {/* Edit/Add dialog */}
      {dialogOpen && editingServer && (
        <McpServerDialog
          server={editingServer}
          isNew={editingIndex < 0}
          onSave={handleSave}
          onCancel={() => setDialogOpen(false)}
        />
      )}
    </div>
  );
}

function StatusRow({ server, toolCount }: { server: McpServerStatus; toolCount?: number }) {
  const config = STATUS_CONFIG[server.status as keyof typeof STATUS_CONFIG] || STATUS_CONFIG.pending;
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
      {toolCount != null && toolCount > 0 && (
        <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground" title={`${toolCount} tools`}>
          <Wrench className="w-2.5 h-2.5" />
          {toolCount}
        </span>
      )}
      <span className={cn('text-xs', config.color)}>{config.label}</span>
    </div>
  );
}

function ConfigRow({
  config,
  status,
  toolCount,
  onEdit,
  onDelete,
  onToggle,
}: {
  config: McpServerConfig;
  status?: McpServerStatus;
  toolCount?: number;
  onEdit: () => void;
  onDelete: () => void;
  onToggle: () => void;
}) {
  const statusConfig = status ? STATUS_CONFIG[status.status] : null;
  const StatusIcon = statusConfig?.icon;

  return (
    <div className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-muted/30 group">
      <Switch
        checked={config.enabled}
        onCheckedChange={onToggle}
        className="scale-75"
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className={cn('text-sm font-medium truncate', !config.enabled && 'text-muted-foreground')}>
            {config.name}
          </span>
          {StatusIcon && (
            <StatusIcon className={cn('w-3 h-3 shrink-0', statusConfig?.color)} />
          )}
          {toolCount != null && toolCount > 0 && (
            <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground" title={`${toolCount} tools`}>
              <Wrench className="w-2.5 h-2.5" />
              {toolCount}
            </span>
          )}
        </div>
        <span className="text-[10px] text-muted-foreground">
          {config.type === 'stdio' ? config.command : config.url}
        </span>
      </div>
      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
        <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={onEdit}>
          <Pencil className="w-3 h-3" />
        </Button>
        <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-text-error" onClick={onDelete}>
          <Trash2 className="w-3 h-3" />
        </Button>
      </div>
    </div>
  );
}

function McpServerDialog({
  server: initial,
  isNew,
  onSave,
  onCancel,
}: {
  server: McpServerConfig;
  isNew: boolean;
  onSave: (server: McpServerConfig) => void;
  onCancel: () => void;
}) {
  const [server, setServer] = useState<McpServerConfig>(initial);
  const [argsText, setArgsText] = useState((initial.args || []).join('\n'));
  const [envText, setEnvText] = useState(
    Object.entries(initial.env || {}).map(([k, v]) => `${k}=${v}`).join('\n')
  );
  const [headersText, setHeadersText] = useState(
    Object.entries(initial.headers || {}).map(([k, v]) => `${k}=${v}`).join('\n')
  );

  const handleSubmit = () => {
    const args = argsText.split('\n').map(s => s.trim()).filter(Boolean);
    const env: Record<string, string> = {};
    for (const line of envText.split('\n')) {
      const eq = line.indexOf('=');
      if (eq > 0) {
        env[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
      }
    }
    const headers: Record<string, string> = {};
    for (const line of headersText.split('\n')) {
      const eq = line.indexOf('=');
      if (eq > 0) {
        headers[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
      }
    }
    onSave({ ...server, args, env, headers });
  };

  const canSubmit = server.name.trim() !== '' &&
    (server.type === 'stdio' ? server.command?.trim() !== '' : server.url?.trim() !== '');

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isNew ? 'Add MCP Server' : 'Edit MCP Server'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div>
            <label className="text-xs font-medium text-muted-foreground">Name</label>
            <Input
              value={server.name}
              onChange={(e) => setServer({ ...server, name: e.target.value })}
              placeholder="my-server"
              className="mt-1 h-8 text-sm"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Type</label>
            <Select
              value={server.type}
              onValueChange={(v) => setServer({ ...server, type: v as McpServerConfig['type'] })}
            >
              <SelectTrigger className="mt-1 h-8 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="stdio">stdio (local process)</SelectItem>
                <SelectItem value="sse">SSE (remote)</SelectItem>
                <SelectItem value="http">HTTP (remote)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {server.type === 'stdio' ? (
            <>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Command</label>
                <Input
                  value={server.command || ''}
                  onChange={(e) => setServer({ ...server, command: e.target.value })}
                  placeholder="npx"
                  className="mt-1 h-8 text-sm font-mono"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Arguments (one per line)</label>
                <textarea
                  value={argsText}
                  onChange={(e) => setArgsText(e.target.value)}
                  placeholder={"-y\n@modelcontextprotocol/server-filesystem\n/path/to/dir"}
                  className="mt-1 w-full h-20 rounded-md border border-input bg-background px-3 py-2 text-sm font-mono resize-none focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Environment Variables (KEY=VALUE, one per line)</label>
                <textarea
                  value={envText}
                  onChange={(e) => setEnvText(e.target.value)}
                  placeholder="GITHUB_TOKEN=ghp_xxx"
                  className="mt-1 w-full h-16 rounded-md border border-input bg-background px-3 py-2 text-sm font-mono resize-none focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
            </>
          ) : (
            <>
              <div>
                <label className="text-xs font-medium text-muted-foreground">URL</label>
                <Input
                  value={server.url || ''}
                  onChange={(e) => setServer({ ...server, url: e.target.value })}
                  placeholder="https://mcp-server.example.com"
                  className="mt-1 h-8 text-sm font-mono"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Headers (KEY=VALUE, one per line)</label>
                <textarea
                  value={headersText}
                  onChange={(e) => setHeadersText(e.target.value)}
                  placeholder="Authorization=Bearer xxx"
                  className="mt-1 w-full h-16 rounded-md border border-input bg-background px-3 py-2 text-sm font-mono resize-none focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
          <Button size="sm" onClick={handleSubmit} disabled={!canSubmit}>
            {isNew ? 'Add' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
