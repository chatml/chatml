'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { FolderOpen, ExternalLink, Download, Upload } from 'lucide-react';
import { openFolderDialog } from '@/lib/tauri';
import { getWorkspacesBasePath, setWorkspacesBasePath, getEnvSettings, setEnvSettings, getClaudeEnv } from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import { useSettingsStore, SETTINGS_DEFAULTS } from '@/stores/settingsStore';
import { useTheme } from 'next-themes';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { SettingsRow } from '../shared/SettingsRow';
import { SettingsGroup } from '../shared/SettingsGroup';

interface SettingsExportFile {
  version: 1;
  theme: string;
  settings: Partial<typeof SETTINGS_DEFAULTS>;
}

export function AdvancedSettings() {
  const toasts = useToast();
  const { theme, setTheme } = useTheme();
  const [showResetDialog, setShowResetDialog] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);

  const handleExportSettings = useCallback(() => {
    try {
      const storeState = useSettingsStore.getState();
      const exportedSettings: Record<string, unknown> = {};
      for (const key of Object.keys(SETTINGS_DEFAULTS)) {
        exportedSettings[key] = storeState[key as keyof typeof SETTINGS_DEFAULTS];
      }

      const payload: SettingsExportFile = {
        version: 1,
        theme: theme ?? 'system',
        settings: exportedSettings as Partial<typeof SETTINGS_DEFAULTS>,
      };

      const json = JSON.stringify(payload, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);

      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `chatml-settings-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);

      toasts.success('Settings exported successfully.');
    } catch (err) {
      console.error('Export failed', err);
      toasts.error('Failed to export settings.');
    }
  }, [theme, toasts]);

  const handleImportSettings = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const raw = event.target?.result as string;
        const parsed = JSON.parse(raw) as unknown;

        if (
          typeof parsed !== 'object' ||
          parsed === null ||
          (parsed as Record<string, unknown>).version !== 1
        ) {
          toasts.error('Invalid settings file: unrecognized format.');
          return;
        }

        const data = parsed as SettingsExportFile;

        if (typeof data.theme === 'string' && ['light', 'dark', 'system'].includes(data.theme)) {
          setTheme(data.theme);
        }

        if (typeof data.settings === 'object' && data.settings !== null) {
          const defaults = SETTINGS_DEFAULTS as Record<string, unknown>;
          const importedSettings: Record<string, unknown> = {};
          for (const [key, value] of Object.entries(data.settings)) {
            if (key in defaults && typeof value === typeof defaults[key]) {
              importedSettings[key] = value;
            }
          }
          if (Object.keys(importedSettings).length > 0) {
            useSettingsStore.setState(importedSettings);
          }
        }

        toasts.success('Settings imported successfully.');
      } catch {
        toasts.error('Failed to import settings: invalid JSON.');
      } finally {
        if (importInputRef.current) {
          importInputRef.current.value = '';
        }
      }
    };
    reader.readAsText(file);
  }, [setTheme, toasts]);

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

  const handleResetAll = () => {
    useSettingsStore.getState().resetAllSettings();
    setTheme('system');
    setShowResetDialog(false);
    toasts.success('All settings have been reset to defaults.');
  };

  return (
    <div>
      <h2 className="text-xl font-semibold mb-5">Advanced</h2>

      <SettingsGroup label="Storage">
        <RootDirectorySection />
      </SettingsGroup>

      <SettingsGroup label="Environment">
        <EnvSection />
      </SettingsGroup>

      <SettingsGroup label="Configuration">
        <SettingsRow
          settingId="exportSettings"
          title="Export settings"
          description="Download your preferences as a JSON file"
        >
          <Button variant="outline" size="sm" className="gap-1.5" onClick={handleExportSettings}>
            <Download className="w-3.5 h-3.5" />
            Export
          </Button>
        </SettingsRow>

        <SettingsRow
          settingId="importSettings"
          title="Import settings"
          description="Restore preferences from a previously exported JSON file"
        >
          <input
            ref={importInputRef}
            type="file"
            accept=".json,application/json"
            className="sr-only"
            onChange={handleImportSettings}
            aria-label="Import settings file"
          />
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => importInputRef.current?.click()}
          >
            <Upload className="w-3.5 h-3.5" />
            Import
          </Button>
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup label="Maintenance">
        <SettingsRow
          settingId="clearCache"
          title="Clear cache"
          description="Clear cached data and temporary files"
        >
          <Button variant="outline" size="sm" onClick={handleClearCache}>
            Clear
          </Button>
        </SettingsRow>

        <SettingsRow
          settingId="resetAllSettings"
          title="Reset all settings"
          description="Restore all preferences to their default values"
        >
          <Button variant="outline" size="sm" onClick={() => setShowResetDialog(true)}>
            Reset
          </Button>
        </SettingsRow>
      </SettingsGroup>

      <Dialog open={showResetDialog} onOpenChange={setShowResetDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset all settings?</DialogTitle>
            <DialogDescription>
              This will reset all preferences to their default values. Your account, API keys, custom instructions, and workspace data will not be affected.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowResetDialog(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleResetAll}>
              Reset all settings
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
    <SettingsRow
      settingId="workspacesBasePath"
      variant="stacked"
      title="ChatML root directory"
      description="Where ChatML stores repositories and sessions. Changing this requires restarting the app."
    >
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={rootDirectory}
          onChange={(e) => setRootDirectory(e.target.value)}
          aria-label="ChatML root directory"
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
    </SettingsRow>
  );
}

function EnvSection() {
  const [envVars, setEnvVarsLocal] = useState('');
  const [savedEnvVars, setSavedEnvVars] = useState('');
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const toasts = useToast();

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

  const handleImportFromClaude = useCallback(async () => {
    setImporting(true);
    setSaveError(null);
    try {
      const claudeEnv = await getClaudeEnv();
      const claudeKeys = Object.keys(claudeEnv);

      if (claudeKeys.length === 0) {
        toasts.info('No environment variables found in ~/.claude/settings.json');
        return;
      }

      // Parse existing vars into a map so we can detect overwrites
      const existingMap: Record<string, string> = {};
      for (const line of envVars.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx > 0) {
          existingMap[trimmed.substring(0, eqIdx).trim()] = trimmed.substring(eqIdx + 1);
        }
      }

      // Track what actually changes
      let added = 0;
      let overwritten = 0;
      const remaining = new Set(claudeKeys);

      // Rebuild lines: update existing var lines in-place, preserve comments/blanks
      const lines = envVars.split('\n');
      const updatedLines = lines.map((line) => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) return line; // preserve comments and blanks
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx <= 0) return line;
        const key = trimmed.substring(0, eqIdx).trim();
        if (remaining.has(key)) {
          remaining.delete(key);
          if (existingMap[key] !== claudeEnv[key]) {
            overwritten++;
          }
          return `${key}=${claudeEnv[key]}`;
        }
        return line;
      });

      // Append new vars that didn't exist yet
      for (const key of remaining) {
        added++;
        updatedLines.push(`${key}=${claudeEnv[key]}`);
      }

      setEnvVarsLocal(updatedLines.join('\n'));

      // Build a descriptive toast
      const parts: string[] = [];
      if (added > 0) parts.push(`${added} added`);
      if (overwritten > 0) parts.push(`${overwritten} updated`);
      if (parts.length === 0) {
        toasts.info('All Claude env vars already match — no changes made');
      } else {
        toasts.success(`Imported from Claude settings: ${parts.join(', ')}`);
      }
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to import Claude env vars');
    } finally {
      setImporting(false);
    }
  }, [envVars, toasts]);

  return (
    <SettingsRow
      settingId="envVars"
      variant="stacked"
      title="Environment variables"
      description={
        <>
          Useful for using third-party providers like Bedrock or Vertex. Changes take effect for new agent sessions.{' '}
          <a
            href="https://docs.anthropic.com/en/docs/claude-code"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline inline-flex items-center gap-0.5"
          >
            View docs
            <ExternalLink className="w-3 h-3" />
          </a>
        </>
      }
    >
      <textarea
        value={envVars}
        onChange={(e) => setEnvVarsLocal(e.target.value)}
        disabled={loading}
        aria-label="Environment variables"
        className="w-full h-40 px-4 py-3 font-mono text-sm bg-muted/50 border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary resize-none disabled:opacity-50"
        placeholder="VAR_NAME=value"
      />

      <div className="flex items-center justify-between mt-3">
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            disabled={importing || loading}
            onClick={handleImportFromClaude}
          >
            <Download className="w-3.5 h-3.5" />
            {importing ? 'Importing...' : 'Import from Claude'}
          </Button>
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
    </SettingsRow>
  );
}
