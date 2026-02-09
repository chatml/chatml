'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import {
  ExternalLink,
  RefreshCw,
  Loader2,
  CheckCircle2,
} from 'lucide-react';

export function AboutSettings() {
  const [version, setVersion] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [upToDate, setUpToDate] = useState(false);

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

  const handleCheckForUpdates = async () => {
    if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) return;
    setChecking(true);
    setUpToDate(false);
    try {
      const { check } = await import('@tauri-apps/plugin-updater');
      const result = await check();
      if (result) {
        // Update available -- the UpdateChecker dialog will handle it
        // Dispatch event so UpdateChecker can show its dialog
        window.dispatchEvent(new CustomEvent('show-update-dialog'));
      } else {
        setUpToDate(true);
      }
    } catch (err) {
      console.error('Update check failed:', err);
    } finally {
      setChecking(false);
    }
  };

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
          disabled={checking}
          onClick={handleCheckForUpdates}
        >
          {checking ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : upToDate ? (
            <CheckCircle2 className="w-3.5 h-3.5 text-text-success" />
          ) : (
            <RefreshCw className="w-3.5 h-3.5" />
          )}
          {checking ? 'Checking...' : upToDate ? 'Up to date' : 'Check for updates'}
        </Button>
      </div>

      {/* Links */}
      <div className="py-4 space-y-3">
        <a
          href="https://docs.chatml.dev"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-between py-2 text-sm hover:text-foreground text-muted-foreground transition-colors"
        >
          Documentation
          <ExternalLink className="w-3.5 h-3.5" />
        </a>
        <a
          href="https://chatml.dev/changelog"
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
