'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { FolderOpen } from 'lucide-react';
import { openFolderDialog } from '@/lib/tauri';
import { getWorkspacesBasePath, setWorkspacesBasePath, getEnvSettings, setEnvSettings } from '@/lib/api';
import { ExternalLink } from 'lucide-react';
import { useToast } from '@/components/ui/toast';
import { SettingsRow } from '../shared/SettingsRow';

export function AdvancedSettings() {
  const toasts = useToast();

  const handleClearCache = () => {
    try {
      // Clear all localStorage except auth token and settings
      const authToken = localStorage.getItem('github_token');
      const settings = localStorage.getItem('chatml-settings');
      localStorage.clear();
      if (authToken) localStorage.setItem('github_token', authToken);
      if (settings) localStorage.setItem('chatml-settings', settings);
      toasts.success('Cache cleared. Restart for full effect.');
    } catch {
      toasts.error('Failed to clear cache');
    }
  };

  return (
    <div>
      <h2 className="text-xl font-semibold mb-5">Advanced</h2>

      {/* ChatML root directory */}
      <RootDirectorySection />

      {/* Environment variables */}
      <EnvSection />

      <SettingsRow
        title="Clear cache"
        description="Clear cached data and temporary files"
      >
        <Button variant="outline" size="sm" onClick={handleClearCache}>
          Clear
        </Button>
      </SettingsRow>
    </div>
  );
}

function RootDirectorySection() {
  const [rootDirectory, setRootDirectory] = useState('');
  const [savedDirectory, setSavedDirectory] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    getWorkspacesBasePath().then((path) => {
      setRootDirectory(path);
      setSavedDirectory(path);
    }).catch((err) => {
      console.error('Failed to fetch workspaces base path:', err);
    });
  }, []);

  const hasUnsavedChanges = rootDirectory !== savedDirectory;

  const handleSaveDirectory = useCallback(async () => {
    if (!hasUnsavedChanges) return;
    setSaving(true);
    setSaveError(null);
    try {
      const newPath = await setWorkspacesBasePath(rootDirectory);
      setSavedDirectory(newPath);
      setRootDirectory(newPath);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }, [rootDirectory, hasUnsavedChanges]);

  return (
    <div className="py-4 border-b border-border/50">
      <h4 className="text-sm font-medium">ChatML root directory</h4>
      <p className="text-sm text-muted-foreground mt-0.5">
        Where ChatML stores repositories and sessions. Changing this requires restarting the app.
      </p>
      <div className="flex items-center gap-2 mt-3">
        <input
          type="text"
          value={rootDirectory}
          onChange={(e) => setRootDirectory(e.target.value)}
          className="flex-1 px-3 py-2 text-sm bg-background border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary"
        />
        <Button
          variant="outline"
          size="sm"
          className="gap-2 h-9"
          onClick={async () => {
            const selectedPath = await openFolderDialog('Select ChatML Root Directory');
            if (selectedPath) {
              setRootDirectory(selectedPath);
            }
          }}
        >
          <FolderOpen className="w-4 h-4" />
          Browse
        </Button>
        {hasUnsavedChanges && (
          <Button
            variant="default"
            size="sm"
            className="h-9"
            disabled={saving}
            onClick={handleSaveDirectory}
          >
            {saving ? 'Saving...' : 'Save'}
          </Button>
        )}
      </div>
      {saveError && (
        <p className="text-sm text-destructive mt-2">{saveError}</p>
      )}
    </div>
  );
}

function EnvSection() {
  const [envVars, setEnvVarsLocal] = useState('');
  const [savedEnvVars, setSavedEnvVars] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getEnvSettings()
      .then((vars) => {
        setEnvVarsLocal(vars);
        setSavedEnvVars(vars);
      })
      .catch((err) => {
        console.error('Failed to load env settings:', err);
      })
      .finally(() => setLoading(false));
  }, []);

  const hasUnsavedChanges = envVars !== savedEnvVars;

  const handleSave = useCallback(async () => {
    if (!hasUnsavedChanges) return;
    setSaving(true);
    setSaveError(null);
    try {
      await setEnvSettings(envVars);
      setSavedEnvVars(envVars);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }, [envVars, hasUnsavedChanges]);

  return (
    <div className="py-4 border-b border-border/50">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h4 className="text-sm font-medium">Environment variables</h4>
          <p className="text-xs text-muted-foreground mt-0.5">
            Useful for using third-party providers like Bedrock or Vertex.
            Changes take effect for new agent sessions.
          </p>
        </div>
        <a
          href="https://docs.anthropic.com/en/docs/claude-code"
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1"
        >
          View docs
          <ExternalLink className="w-3 h-3" />
        </a>
      </div>

      <textarea
        value={envVars}
        onChange={(e) => setEnvVarsLocal(e.target.value)}
        disabled={loading}
        className="w-full h-40 px-4 py-3 font-mono text-sm bg-muted/50 border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary resize-none disabled:opacity-50"
        placeholder="VAR_NAME=value"
      />

      <div className="flex items-center justify-between mt-3">
        <div>
          <p className="text-xs text-muted-foreground">
            One per line:{' '}
            <code className="px-1 py-0.5 bg-muted rounded text-xs font-mono">VAR_NAME=value</code>
          </p>
          {saveError && (
            <p className="text-sm text-destructive mt-1">{saveError}</p>
          )}
        </div>
        <Button
          variant="secondary"
          size="sm"
          disabled={!hasUnsavedChanges || saving}
          onClick={handleSave}
        >
          {saving ? 'Saving...' : 'Save'}
        </Button>
      </div>
    </div>
  );
}
