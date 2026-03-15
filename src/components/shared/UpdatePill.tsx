'use client';

import { useEffect } from 'react';
import { Clock, Download, Loader2, RefreshCw, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useUpdateStore } from '@/stores/updateStore';
import { useAppStore } from '@/stores/appStore';
import { UPDATE_CHECK_DELAY_MS } from '@/lib/constants';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';

const UPDATE_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours

export function UpdatePill() {
  const status = useUpdateStore((s) => s.status);
  const version = useUpdateStore((s) => s.version);
  const progress = useUpdateStore((s) => s.progress);
  const checkForUpdates = useUpdateStore((s) => s.checkForUpdates);
  const downloadAndInstall = useUpdateStore((s) => s.downloadAndInstall);
  const relaunch = useUpdateStore((s) => s.relaunch);
  const waitForAgents = useUpdateStore((s) => s.waitForAgents);
  const streamingState = useAppStore((s) => s.streamingState);

  // Auto-check for updates on mount and periodically
  useEffect(() => {
    if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) {
      return;
    }

    const timeout = setTimeout(checkForUpdates, UPDATE_CHECK_DELAY_MS);
    const interval = setInterval(checkForUpdates, UPDATE_CHECK_INTERVAL_MS);

    return () => {
      clearTimeout(timeout);
      clearInterval(interval);
    };
  }, [checkForUpdates]);

  // Auto-relaunch when all agents finish while in 'waiting' state
  useEffect(() => {
    if (status !== 'waiting') return;
    const entries = Object.values(streamingState);
    if (entries.length === 0) return; // State not populated yet
    const hasActive = entries.some((s) => s.isStreaming);
    if (!hasActive) {
      relaunch().catch(() => {
        // IPC failure — fall back to ready so user can retry
        useUpdateStore.getState().cancelWait();
      });
    }
  }, [status, streamingState, relaunch]);

  // Don't render when there's nothing to show
  if (status === 'idle' || status === 'checking') {
    return null;
  }

  const handleClick = () => {
    switch (status) {
      case 'available':
        downloadAndInstall();
        break;
      case 'ready': {
        const hasActive = Object.values(streamingState).some((s) => s.isStreaming);
        if (hasActive) {
          waitForAgents();
        } else {
          relaunch();
        }
        break;
      }
      case 'waiting':
        // Force restart — user clicked again while waiting
        relaunch();
        break;
      case 'error':
        downloadAndInstall();
        break;
    }
  };

  const label = (() => {
    switch (status) {
      case 'available':
        return version ? `Update v${version}` : 'Update';
      case 'downloading':
        return `Updating ${Math.round(progress)}%`;
      case 'ready':
        return 'Restart';
      case 'waiting':
        return 'Waiting...';
      case 'error':
        return 'Retry';
      default:
        return '';
    }
  })();

  const icon = (() => {
    switch (status) {
      case 'available':
        return <Download className="h-3 w-3" />;
      case 'downloading':
        return <Loader2 className="h-3 w-3 animate-spin" />;
      case 'ready':
        return <RefreshCw className="h-3 w-3" />;
      case 'waiting':
        return <Clock className="h-3 w-3" />;
      case 'error':
        return <RotateCcw className="h-3 w-3" />;
      default:
        return null;
    }
  })();

  const tooltipText = (() => {
    switch (status) {
      case 'available':
        return `Version ${version} is available. Click to download and install.`;
      case 'downloading':
        return 'Downloading update...';
      case 'ready':
        return 'Update installed. Click to restart the app.';
      case 'waiting':
        return 'Waiting for agents to finish. Click to restart now.';
      case 'error':
        return 'Update failed. Click to retry.';
      default:
        return '';
    }
  })();

  const colorStyles = (() => {
    switch (status) {
      case 'available':
      case 'downloading':
        return 'bg-blue-500/15 text-blue-400 border-blue-500/25 hover:bg-blue-500/25';
      case 'ready':
        return 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25 hover:bg-emerald-500/25';
      case 'waiting':
        return 'bg-amber-500/15 text-amber-400 border-amber-500/25 hover:bg-amber-500/25';
      case 'error':
        return 'bg-red-500/15 text-red-400 border-red-500/25 hover:bg-red-500/25';
      default:
        return '';
    }
  })();

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          className={cn(
            'inline-flex items-center gap-1 px-2 h-6 rounded-full border text-xs font-medium transition-colors',
            colorStyles,
            status === 'downloading' && 'pointer-events-none',
          )}
          onClick={handleClick}
          disabled={status === 'downloading'}
        >
          {icon}
          <span>{label}</span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{tooltipText}</TooltipContent>
    </Tooltip>
  );
}
