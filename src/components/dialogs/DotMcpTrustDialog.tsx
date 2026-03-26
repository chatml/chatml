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
import { ScrollArea } from '@/components/ui/scroll-area';
import { ShieldAlert, Terminal, Globe } from 'lucide-react';
import type { DotMcpServerInfo } from '@/lib/api';

interface DotMcpTrustDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceName: string;
  servers: DotMcpServerInfo[];
  onAllow: () => void;
  onDeny: () => void;
}

function sourceLabel(source?: string): string {
  switch (source) {
    case 'claude-cli-project':
      return '.claude/settings.json';
    case 'dot-mcp':
      return '.mcp.json';
    default:
      return '.mcp.json';
  }
}

export function DotMcpTrustDialog({
  open,
  onOpenChange,
  workspaceName,
  servers,
  onAllow,
  onDeny,
}: DotMcpTrustDialogProps) {
  const hasStdio = servers.some((s) => s.type === 'stdio');
  const hasMcpJson = servers.some((s) => !s.source || s.source === 'dot-mcp');
  const hasClaudeSettings = servers.some((s) => s.source === 'claude-cli-project');

  // Build description of which config files were found
  const configFiles: string[] = [];
  if (hasMcpJson || !hasClaudeSettings) configFiles.push('.mcp.json');
  if (hasClaudeSettings) configFiles.push('.claude/settings.json');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="sm:max-w-lg"
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldAlert className="w-5 h-5 text-orange-500 shrink-0" />
            Project MCP servers detected
          </DialogTitle>
          <DialogDescription className="pt-1">
            <span className="font-medium text-foreground">{workspaceName}</span>{' '}
            contains {configFiles.length === 1 ? 'a ' : ''}
            {configFiles.map((f, i) => (
              <span key={f}>
                {i > 0 && ' and '}
                <code className="text-xs bg-muted px-1 py-0.5 rounded">{f}</code>
              </span>
            ))}{' '}
            {configFiles.length === 1 ? 'file' : 'files'} that{' '}
            {configFiles.length === 1 ? 'defines' : 'define'} MCP servers.
            {hasStdio && ' Some of these servers will execute commands on your system.'}
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[240px]">
          <div className="space-y-2 py-3">
            {servers.map((server) => {
              const isStdio = server.type === 'stdio';
              const TypeIcon = isStdio ? Terminal : Globe;

              return (
                <div
                  key={`${server.name}-${server.source}`}
                  className={`rounded-md border px-3 py-2.5 text-sm ${
                    isStdio
                      ? 'border-orange-500/30 bg-orange-500/5'
                      : 'border-border bg-muted/30'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <TypeIcon className={`w-3.5 h-3.5 shrink-0 ${isStdio ? 'text-orange-500' : 'text-muted-foreground'}`} />
                    <span className="font-medium flex-1 truncate">{server.name}</span>
                    <span className="text-[10px] text-muted-foreground bg-muted/50 px-1.5 py-0.5 rounded">
                      {sourceLabel(server.source)}
                    </span>
                    <span className="text-[10px] text-muted-foreground uppercase">{server.type}</span>
                  </div>
                  {server.command && (
                    <div className="mt-1.5 ml-5.5 font-mono text-xs text-muted-foreground truncate">
                      {server.command}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </ScrollArea>

        {hasStdio && (
          <div className="flex items-start gap-2 rounded-md bg-orange-500/5 border border-orange-500/20 px-3 py-2.5">
            <Terminal className="w-3.5 h-3.5 text-orange-500 shrink-0 mt-0.5" />
            <p className="text-xs text-orange-600 dark:text-orange-400">
              Stdio servers run shell commands under your user account. Only allow this if you trust
              the repository.
            </p>
          </div>
        )}

        <div className="border-t border-border/50 pt-4">
          <DialogFooter className="gap-3 sm:gap-3">
            <Button
              variant="outline"
              onClick={onDeny}
              className="flex-1 text-destructive hover:text-destructive hover:bg-destructive/10 border-destructive/30"
            >
              Deny
            </Button>
            <Button onClick={onAllow} className="flex-1">
              Allow
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
