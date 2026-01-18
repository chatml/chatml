'use client';

import { useEffect, useState } from 'react';
import { check, Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Download, RefreshCw, Loader2, CheckCircle2 } from 'lucide-react';

type UpdateState = 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'error';

export function UpdateChecker() {
  const [state, setState] = useState<UpdateState>('idle');
  const [update, setUpdate] = useState<Update | null>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [showDialog, setShowDialog] = useState(false);

  // Check for updates on mount and periodically
  useEffect(() => {
    // Only run in Tauri environment
    if (typeof window === 'undefined' || !('__TAURI__' in window)) {
      return;
    }

    const checkForUpdates = async () => {
      try {
        setState('checking');
        const result = await check();

        if (result) {
          setUpdate(result);
          setState('available');
          setShowDialog(true);
        } else {
          setState('idle');
        }
      } catch (err) {
        console.error('Update check failed:', err);
        setState('idle');
      }
    };

    // Check on mount after a short delay
    const timeout = setTimeout(checkForUpdates, 3000);

    // Check every 4 hours
    const interval = setInterval(checkForUpdates, 4 * 60 * 60 * 1000);

    return () => {
      clearTimeout(timeout);
      clearInterval(interval);
    };
  }, []);

  const handleDownloadAndInstall = async () => {
    if (!update) return;

    try {
      setState('downloading');
      setProgress(0);

      let contentLength = 0;
      let downloaded = 0;

      await update.downloadAndInstall((event) => {
        switch (event.event) {
          case 'Started':
            contentLength = (event.data as { contentLength?: number }).contentLength || 0;
            downloaded = 0;
            setProgress(0);
            break;
          case 'Progress':
            downloaded += event.data.chunkLength;
            if (contentLength > 0) {
              setProgress(Math.min((downloaded / contentLength) * 100, 99));
            }
            break;
          case 'Finished':
            setProgress(100);
            break;
        }
      });

      setState('ready');
    } catch (err) {
      console.error('Update download failed:', err);
      setError(err instanceof Error ? err.message : 'Download failed');
      setState('error');
    }
  };

  const handleRelaunch = async () => {
    await relaunch();
  };

  const handleClose = () => {
    if (state !== 'downloading') {
      setShowDialog(false);
    }
  };

  // Don't render anything in non-Tauri environment
  if (typeof window === 'undefined' || !('__TAURI__' in window)) {
    return null;
  }

  return (
    <Dialog open={showDialog} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {state === 'available' && <Download className="w-5 h-5" />}
            {state === 'downloading' && <Loader2 className="w-5 h-5 animate-spin" />}
            {state === 'ready' && <CheckCircle2 className="w-5 h-5 text-green-500" />}
            {state === 'error' && <RefreshCw className="w-5 h-5 text-red-500" />}
            {state === 'available' && 'Update Available'}
            {state === 'downloading' && 'Downloading Update'}
            {state === 'ready' && 'Update Ready'}
            {state === 'error' && 'Update Failed'}
          </DialogTitle>
          <DialogDescription>
            {state === 'available' && update && (
              <>
                A new version <span className="font-medium text-foreground">v{update.version}</span> is available.
                {update.body && (
                  <p className="mt-2 text-sm">{update.body}</p>
                )}
              </>
            )}
            {state === 'downloading' && (
              <>
                Downloading update... {Math.round(progress)}%
                <div className="mt-2 w-full bg-muted rounded-full h-2">
                  <div
                    className="bg-primary h-2 rounded-full transition-all"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              </>
            )}
            {state === 'ready' && 'Update downloaded. Restart to apply changes.'}
            {state === 'error' && (
              <>
                {error || 'Failed to download update. Please try again later.'}
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        <DialogFooter>
          {state === 'available' && (
            <>
              <Button variant="outline" onClick={handleClose}>
                Later
              </Button>
              <Button onClick={handleDownloadAndInstall}>
                <Download className="w-4 h-4 mr-2" />
                Download & Install
              </Button>
            </>
          )}
          {state === 'downloading' && (
            <Button disabled>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Downloading...
            </Button>
          )}
          {state === 'ready' && (
            <>
              <Button variant="outline" onClick={handleClose}>
                Later
              </Button>
              <Button onClick={handleRelaunch}>
                <RefreshCw className="w-4 h-4 mr-2" />
                Restart Now
              </Button>
            </>
          )}
          {state === 'error' && (
            <>
              <Button variant="outline" onClick={handleClose}>
                Close
              </Button>
              <Button onClick={handleDownloadAndInstall}>
                Try Again
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
