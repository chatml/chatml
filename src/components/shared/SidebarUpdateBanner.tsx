'use client';

import { Gift, Loader2, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useUpdateStore } from '@/stores/updateStore';
import { useAppStore } from '@/stores/appStore';

export function SidebarUpdateBanner() {
  const status = useUpdateStore((s) => s.status);
  const version = useUpdateStore((s) => s.version);
  const progress = useUpdateStore((s) => s.progress);
  const relaunch = useUpdateStore((s) => s.relaunch);
  const waitForAgents = useUpdateStore((s) => s.waitForAgents);
  const downloadAndInstall = useUpdateStore((s) => s.downloadAndInstall);
  const streamingState = useAppStore((s) => s.streamingState);

  // Only show for actionable states
  if (status !== 'downloading' && status !== 'ready' && status !== 'waiting' && status !== 'error') {
    return null;
  }

  const handleRelaunch = () => {
    const hasActive = Object.values(streamingState).some((s) => s.isStreaming);
    if (hasActive) {
      waitForAgents();
    } else {
      relaunch();
    }
  };

  const handleClick = () => {
    switch (status) {
      case 'ready':
        handleRelaunch();
        break;
      case 'waiting':
        relaunch();
        break;
      case 'error':
        downloadAndInstall();
        break;
    }
  };

  const title = (() => {
    switch (status) {
      case 'downloading':
        return `Updating ${Math.round(progress)}%`;
      case 'ready':
        return `Updated to ${version ?? 'latest'}`;
      case 'waiting':
        return 'Waiting for agents...';
      case 'error':
        return 'Update failed';
      default:
        return '';
    }
  })();

  const subtitle = (() => {
    switch (status) {
      case 'downloading':
        return 'Downloading update...';
      case 'ready':
        return 'Relaunch to apply';
      case 'waiting':
        return 'Click to restart now';
      case 'error':
        return 'Click retry to try again';
      default:
        return '';
    }
  })();

  const buttonLabel = (() => {
    switch (status) {
      case 'ready':
        return 'Relaunch';
      case 'waiting':
        return 'Relaunch';
      case 'error':
        return 'Retry';
      default:
        return null;
    }
  })();

  return (
    <div className="px-2 pt-2">
      <div className="flex items-center gap-3 rounded-lg border border-sidebar-border bg-sidebar-accent/50 p-2.5">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-sidebar-accent">
          {status === 'downloading' ? (
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          ) : status === 'error' ? (
            <RotateCcw className="h-5 w-5 text-muted-foreground" />
          ) : (
            <Gift className="h-5 w-5 text-muted-foreground" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium leading-tight truncate">{title}</p>
          <p className="text-xs text-muted-foreground leading-tight mt-0.5">{subtitle}</p>
        </div>
        {buttonLabel && (
          <Button
            variant="outline"
            size="sm"
            className="shrink-0 h-7 text-xs"
            onClick={handleClick}
          >
            {buttonLabel}
          </Button>
        )}
      </div>
    </div>
  );
}
