'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Smartphone, Loader2, Unplug, Copy, Check } from 'lucide-react';
import {
  startRelayPairing,
  cancelRelayPairing,
  getRelayStatus,
  disconnectRelay,
} from '@/lib/api/settings';
import { useToast } from '@/components/ui/toast';
import { SettingsRow } from '../shared/SettingsRow';
import { SettingsGroup } from '../shared/SettingsGroup';

type PairingState = 'idle' | 'connecting' | 'waiting' | 'connected' | 'error' | 'unavailable';

const DEFAULT_RELAY_URL = 'ws://localhost:8787';
const POLL_INTERVAL_MS = 2000;

export function PairMobileSettings() {
  const [state, setState] = useState<PairingState>('idle');
  const [qrData, setQrData] = useState<string>('');
  const [relayUrl, setRelayUrl] = useState(DEFAULT_RELAY_URL);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const { toast } = useToast();
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Check initial status — also detects if relay endpoints are available
  useEffect(() => {
    getRelayStatus()
      .then((status) => {
        if (status.connected) {
          setState('connected');
          if (status.qrData) setQrData(status.qrData);
          if (status.relayUrl) setRelayUrl(status.relayUrl);
        }
      })
      .catch(() => {
        // Relay endpoints not available in this backend version
        setState('unavailable');
      });
  }, []);

  // Poll for pairing completion while in 'waiting' state
  useEffect(() => {
    if (state !== 'waiting') {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      return;
    }

    let mounted = true;
    pollRef.current = setInterval(async () => {
      try {
        const status = await getRelayStatus();
        if (mounted && status.connected) {
          setState('connected');
          toast({ description: 'Mobile device connected' });
        }
      } catch {
        // Ignore polling errors
      }
    }, POLL_INTERVAL_MS);

    return () => {
      mounted = false;
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [state, toast]);

  const handleStartPairing = useCallback(async () => {
    setState('connecting');
    setError('');
    try {
      const result = await startRelayPairing(relayUrl);
      setQrData(result.qrData);
      setState('waiting');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start pairing');
      setState('error');
    }
  }, [relayUrl]);

  const handleCancel = useCallback(async () => {
    try {
      await cancelRelayPairing();
    } catch {
      // Best effort
    }
    setState('idle');
    setQrData('');
  }, []);

  const handleDisconnect = useCallback(async () => {
    try {
      await disconnectRelay();
      toast({ description: 'Mobile device disconnected' });
    } catch {
      // Best effort
    }
    setState('idle');
    setQrData('');
  }, [toast]);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(qrData);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard may not be available
    }
  }, [qrData]);

  // Don't render if relay feature isn't available
  if (state === 'unavailable') {
    return null;
  }

  return (
    <SettingsGroup label="Mobile Remote Control">
      <SettingsRow
        title="Pair Mobile Device"
        description="Connect a mobile app to remotely control and monitor your ChatML sessions."
        icon={<Smartphone className="w-4 h-4" />}
      >
        {state === 'idle' && (
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={relayUrl}
              onChange={(e) => setRelayUrl(e.target.value)}
              placeholder="Relay URL"
              className="h-7 px-2 text-xs rounded border border-border bg-background text-foreground w-48"
            />
            <Button variant="outline" size="sm" onClick={handleStartPairing}>
              Start Pairing
            </Button>
          </div>
        )}

        {state === 'connecting' && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            Connecting to relay...
          </div>
        )}

        {state === 'waiting' && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                <span className="text-xs text-muted-foreground">
                  Waiting for mobile to connect...
                </span>
              </div>
              <Button variant="ghost" size="sm" onClick={handleCancel} className="h-6 px-2 text-xs">
                Cancel
              </Button>
            </div>
            <div className="flex items-center gap-1.5 p-2 rounded bg-muted/50 border border-border">
              <code className="text-[10px] text-muted-foreground break-all flex-1 select-all">
                {qrData}
              </code>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleCopy}
                className="h-6 w-6 p-0 shrink-0"
              >
                {copied ? (
                  <Check className="w-3 h-3 text-green-500" />
                ) : (
                  <Copy className="w-3 h-3" />
                )}
              </Button>
            </div>
            <p className="text-[10px] text-muted-foreground">
              Scan this with the ChatML mobile app, or copy the pairing URL.
            </p>
          </div>
        )}

        {state === 'connected' && (
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-green-500" />
              <span className="text-xs text-green-600 dark:text-green-400">
                Mobile connected
              </span>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleDisconnect}
              className="h-6 px-2 text-xs text-destructive"
            >
              <Unplug className="w-3 h-3 mr-1" />
              Disconnect
            </Button>
          </div>
        )}

        {state === 'error' && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-destructive">{error}</span>
            <Button variant="outline" size="sm" onClick={handleStartPairing}>
              Retry
            </Button>
          </div>
        )}
      </SettingsRow>
    </SettingsGroup>
  );
}
