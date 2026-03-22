'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/ui/toast';
import { RefreshCw, ExternalLink, Loader2 } from 'lucide-react';
import { SettingsGroup } from '../shared/SettingsGroup';
import { SettingsRow } from '../shared/SettingsRow';
import {
  getGstackStatus,
  enableGstack,
  disableGstack,
  syncGstack,
  type GstackStatus,
} from '@/lib/api';

export function GstackSettings({ workspaceId }: { workspaceId: string }) {
  const [status, setStatus] = useState<GstackStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const { success: showSuccess, error: showError } = useToast();

  const loadStatus = useCallback(async () => {
    try {
      setLoading(true);
      const data = await getGstackStatus(workspaceId);
      setStatus(data);
    } catch {
      setStatus({ enabled: false });
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  const handleToggle = useCallback(async (enabled: boolean) => {
    setToggling(true);
    try {
      if (enabled) {
        await enableGstack(workspaceId);
        showSuccess('gstack skills enabled');
      } else {
        await disableGstack(workspaceId);
        showSuccess('gstack skills disabled');
      }
      await loadStatus();
    } catch {
      showError(enabled ? 'Failed to enable gstack' : 'Failed to disable gstack');
    } finally {
      setToggling(false);
    }
  }, [workspaceId, loadStatus, showSuccess, showError]);

  const handleSync = useCallback(async () => {
    setSyncing(true);
    try {
      await syncGstack(workspaceId);
      await loadStatus();
      showSuccess('gstack skills synced to latest');
    } catch {
      showError('Failed to sync gstack');
    } finally {
      setSyncing(false);
    }
  }, [workspaceId, loadStatus, showSuccess, showError]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin mr-2" />
        Loading...
      </div>
    );
  }

  return (
    <SettingsGroup label="gstack Skills">
      <SettingsRow
        title="Enable gstack"
        description="Install gstack — a curated collection of 25 Claude Code skills for sprint workflows, reviews, QA, and shipping."
      >
        <Switch
          checked={status?.enabled ?? false}
          onCheckedChange={handleToggle}
          disabled={toggling}
        />
      </SettingsRow>

      {status?.enabled && (
        <>
          <SettingsRow
            title="Version"
            description={status.version ? `Commit ${status.version}` : 'Unknown'}
          >
            <div className="flex items-center gap-2">
              {status.lastSync && (
                <span className="text-xs text-muted-foreground">
                  Last synced {new Date(status.lastSync).toLocaleDateString()}
                </span>
              )}
              <Button
                variant="outline"
                size="sm"
                className="h-7 gap-1.5"
                onClick={handleSync}
                disabled={syncing}
              >
                <RefreshCw className={`h-3.5 w-3.5 ${syncing ? 'animate-spin' : ''}`} />
                Sync
              </Button>
            </div>
          </SettingsRow>

          <SettingsRow
            title="Learn more"
            description="View the gstack repository for documentation and available skills."
          >
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1.5"
              onClick={() => window.open('https://github.com/garrytan/gstack', '_blank')}
            >
              <ExternalLink className="h-3.5 w-3.5" />
              GitHub
            </Button>
          </SettingsRow>
        </>
      )}
    </SettingsGroup>
  );
}
