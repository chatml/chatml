'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import {
  ExternalLink,
  RefreshCw,
  Loader2,
  CheckCircle2,
  Download,
  RotateCcw,
} from 'lucide-react';
import { useUpdateStore } from '@/stores/updateStore';

export function AboutSettings() {
  const [version, setVersion] = useState<string | null>(null);
  const [checkedOnce, setCheckedOnce] = useState(false);

  const updateStatus = useUpdateStore((s) => s.status);
  const updateVersion = useUpdateStore((s) => s.version);
  const progress = useUpdateStore((s) => s.progress);
  const checkForUpdates = useUpdateStore((s) => s.checkForUpdates);
  const downloadAndInstall = useUpdateStore((s) => s.downloadAndInstall);
  const relaunch = useUpdateStore((s) => s.relaunch);

  const isChecking = updateStatus === 'checking';
  const isUpToDate = checkedOnce && updateStatus === 'idle';

  useEffect(() => {
    // Get app version from Tauri
    if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
      import('@tauri-apps/api/app').then(({ getVersion }) => {
        getVersion().then(setVersion);
      }).catch(() => {
        // Not in Tauri environment
      });
    }
  }, []);

  const handleCheckForUpdates = useCallback(async () => {
    await checkForUpdates();
    setCheckedOnce(true);
  }, [checkForUpdates]);

  const handleClick = useCallback(() => {
    switch (updateStatus) {
      case 'available':
      case 'error':
        downloadAndInstall();
        break;
      case 'ready':
        relaunch();
        break;
      default:
        handleCheckForUpdates();
    }
  }, [updateStatus, downloadAndInstall, relaunch, handleCheckForUpdates]);

  const buttonLabel = (() => {
    switch (updateStatus) {
      case 'checking':
        return 'Checking...';
      case 'available':
        return updateVersion ? `Download v${updateVersion}` : 'Download update';
      case 'downloading':
        return `Downloading ${Math.round(progress)}%`;
      case 'ready':
        return 'Restart to update';
      case 'error':
        return 'Retry download';
      default:
        return isUpToDate ? 'Up to date' : 'Check for updates';
    }
  })();

  const buttonIcon = (() => {
    switch (updateStatus) {
      case 'checking':
      case 'downloading':
        return <Loader2 className="w-3.5 h-3.5 animate-spin" />;
      case 'available':
        return <Download className="w-3.5 h-3.5 text-blue-400" />;
      case 'ready':
        return <RefreshCw className="w-3.5 h-3.5 text-emerald-400" />;
      case 'error':
        return <RotateCcw className="w-3.5 h-3.5 text-red-400" />;
      default:
        return isUpToDate
          ? <CheckCircle2 className="w-3.5 h-3.5 text-text-success" />
          : <RefreshCw className="w-3.5 h-3.5" />;
    }
  })();

  return (
    <div>
      <h2 className="text-xl font-semibold mb-5">About</h2>

      {/* Version */}
      <div className="flex items-center justify-between py-4 border-b border-border/50">
        <div>
          <h4 className="text-sm font-medium">ChatML</h4>
          <p className="text-sm text-muted-foreground mt-0.5">
            {version ? `Version ${version}` : 'AI-assisted development'}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          disabled={isChecking || updateStatus === 'downloading'}
          onClick={handleClick}
        >
          {buttonIcon}
          {buttonLabel}
        </Button>
      </div>

      {/* Links */}
      <div className="py-4 space-y-3">
        <a
          href="https://docs.chatml.com"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-between py-2 text-sm hover:text-foreground text-muted-foreground transition-colors"
        >
          Documentation
          <ExternalLink className="w-3.5 h-3.5" />
        </a>
        <a
          href="https://chatml.com/changelog"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-between py-2 text-sm hover:text-foreground text-muted-foreground transition-colors"
        >
          Changelog
          <ExternalLink className="w-3.5 h-3.5" />
        </a>
        <a
          href="https://github.com/chatml/chatml/issues"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-between py-2 text-sm hover:text-foreground text-muted-foreground transition-colors"
        >
          Send feedback
          <ExternalLink className="w-3.5 h-3.5" />
        </a>
      </div>
    </div>
  );
}
