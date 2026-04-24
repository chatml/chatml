'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  RefreshCw,
  Loader2,
  CheckCircle2,
  Download,
  RotateCcw,
  BookOpen,
  FileText,
  Github,
  MessageSquare,
} from 'lucide-react';
import { useUpdateStore } from '@/stores/updateStore';
import { openUrlInBrowser } from '@/lib/tauri';

interface AboutDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AboutDialog({ open, onOpenChange }: AboutDialogProps) {
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
    if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
      import('@tauri-apps/api/app').then(({ getVersion }) => {
        getVersion().then(setVersion);
      }).catch(() => {});
    }
  }, []);

  const handleCheckForUpdates = useCallback(async () => {
    const result = await checkForUpdates();
    if (result !== null) {
      setCheckedOnce(true);
    }
  }, [checkForUpdates]);

  const handleUpdateClick = useCallback(() => {
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
      case 'waiting':
        return 'Waiting for agents...';
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
      case 'waiting':
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

  const links = [
    { label: 'Docs', icon: BookOpen, url: 'https://docs.chatml.com' },
    { label: 'Changelog', icon: FileText, url: 'https://chatml.com/changelog' },
    { label: 'GitHub', icon: Github, url: 'https://github.com/chatml/chatml' },
    { label: 'Feedback', icon: MessageSquare, url: 'https://github.com/chatml/chatml/issues' },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-[400px] p-0 overflow-hidden gap-0"
        showCloseButton={false}
      >
        <DialogTitle className="sr-only">About ChatML</DialogTitle>
        <DialogDescription className="sr-only">
          App version information and update controls.
        </DialogDescription>

        <div className="flex flex-col items-center px-8 pt-8 pb-6">
          {/* Mascot */}
          <img
            src="/mascot.png"
            alt="ChatML"
            className="w-20 h-20 rounded-2xl shadow-[0_0_40px_oklch(0.5_0.2_290/0.35)]"
            draggable={false}
          />

          {/* App name */}
          <h2 className="font-display text-[1.75rem] leading-tight tracking-tight mt-4">
            ChatML
          </h2>

          {/* Version */}
          <p className="text-sm text-muted-foreground mt-1">
            {version ? `Version ${version}` : '\u00A0'}
          </p>

          {/* Tagline */}
          <p className="text-xs text-muted-foreground/70 mt-0.5">
            AI-Powered Development Studio
          </p>

          {/* Update button */}
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 mt-5"
            disabled={isChecking || updateStatus === 'downloading' || updateStatus === 'waiting'}
            onClick={handleUpdateClick}
          >
            {buttonIcon}
            {buttonLabel}
          </Button>
        </div>

        {/* Links */}
        <div className="flex items-center justify-center gap-0.5 px-4 py-3 border-t border-border/50">
          {links.map(({ label, icon: Icon, url }) => (
            <Button
              key={label}
              variant="ghost"
              size="sm"
              className="h-8 px-2 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
              onClick={() => openUrlInBrowser(url)}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
            </Button>
          ))}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-border/50 text-center">
          <p className="text-[11px] text-muted-foreground/60">
            © {new Date().getFullYear()} ChatML · GPL-3.0
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
