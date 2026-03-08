'use client';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import type { DotMcpServerInfo } from '@/lib/api';

interface DotMcpTrustDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceName: string;
  servers: DotMcpServerInfo[];
  onAllow: () => void;
  onDeny: () => void;
}

export function DotMcpTrustDialog({
  open,
  onOpenChange,
  workspaceName,
  servers,
  onAllow,
  onDeny,
}: DotMcpTrustDialogProps) {
  const stdioServers = servers.filter((s) => s.type === 'stdio');
  const hasStdio = stdioServers.length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="sm:max-w-lg"
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Workspace MCP servers detected</DialogTitle>
          <DialogDescription>
            <span className="font-medium text-foreground">{workspaceName}</span> contains a{' '}
            <code className="text-xs bg-muted px-1 py-0.5 rounded">.mcp.json</code> file that
            defines MCP servers.
            {hasStdio && ' Some of these servers will execute commands on your system.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 py-2">
          {servers.map((server) => (
            <div
              key={server.name}
              className={`rounded-md border px-3 py-2 text-sm ${
                server.type === 'stdio'
                  ? 'border-orange-500/30 bg-orange-500/5'
                  : 'border-border bg-muted/30'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-medium">{server.name}</span>
                <span className="text-xs text-muted-foreground uppercase">{server.type}</span>
              </div>
              {server.command && (
                <div className="mt-1 font-mono text-xs text-muted-foreground truncate">
                  {server.command}
                </div>
              )}
            </div>
          ))}
        </div>

        {hasStdio && (
          <p className="text-xs text-orange-600 dark:text-orange-400">
            Stdio servers run shell commands under your user account. Only allow this if you trust
            the repository.
          </p>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onDeny}>
            Deny
          </Button>
          <Button onClick={onAllow}>Allow</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
