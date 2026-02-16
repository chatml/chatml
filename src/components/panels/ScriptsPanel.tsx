'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAppStore, getScriptOutputLines } from '@/stores/appStore';
import { useSelectedIds } from '@/stores/selectors';
import { ScrollArea } from '@/components/ui/scroll-area';
import { EmptyState } from '@/components/ui/empty-state';
import { ScriptLogViewer } from './ScriptLogViewer';
import {
  getWorkspaceConfig,
  detectWorkspaceConfig,
  updateWorkspaceConfig,
  runScript,
  rerunSetupScripts,
  stopScript,
} from '@/lib/api';
import type { ChatMLConfig, ScriptRun, SetupProgress, ScriptRunStatus } from '@/lib/types';
import { cn } from '@/lib/utils';
import {
  Play,
  Square,
  RotateCcw,
  CheckCircle2,
  XCircle,
  Loader2,
  Terminal,
  ChevronDown,
  ChevronRight,
  Wand2,
} from 'lucide-react';

export function ScriptsPanel() {
  const { selectedSessionId, selectedWorkspaceId } = useSelectedIds();
  const scriptRuns = useAppStore((s) => s.scriptRuns);
  const setupProgress = useAppStore((s) => s.setupProgress);
  const [config, setConfig] = useState<ChatMLConfig | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingDetected, setPendingDetected] = useState<ChatMLConfig | null>(null);

  const sessionRuns = selectedSessionId ? scriptRuns[selectedSessionId] || [] : [];
  const sessionSetupProgress = selectedSessionId ? setupProgress[selectedSessionId] : undefined;

  // Load config when workspace changes
  useEffect(() => {
    if (!selectedWorkspaceId) return;
    setLoading(true);
    setError(null);
    getWorkspaceConfig(selectedWorkspaceId)
      .then(setConfig)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [selectedWorkspaceId]);

  const handleDetect = useCallback(async () => {
    if (!selectedWorkspaceId) return;
    setLoading(true);
    try {
      const detected = await detectWorkspaceConfig(selectedWorkspaceId);
      setPendingDetected(detected);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Detection failed');
    } finally {
      setLoading(false);
    }
  }, [selectedWorkspaceId]);

  const handleConfirmDetected = useCallback(async () => {
    if (!selectedWorkspaceId || !pendingDetected) return;
    setLoading(true);
    try {
      await updateWorkspaceConfig(selectedWorkspaceId, pendingDetected);
      setConfig(pendingDetected);
      setPendingDetected(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save config');
    } finally {
      setLoading(false);
    }
  }, [selectedWorkspaceId, pendingDetected]);

  const handleDismissDetected = useCallback(() => {
    setPendingDetected(null);
  }, []);

  const handleRunScript = useCallback(async (scriptKey: string) => {
    if (!selectedWorkspaceId || !selectedSessionId) return;
    try {
      await runScript(selectedWorkspaceId, selectedSessionId, scriptKey);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to run script');
    }
  }, [selectedWorkspaceId, selectedSessionId]);

  const handleRunSetup = useCallback(async () => {
    if (!selectedWorkspaceId || !selectedSessionId) return;
    try {
      await rerunSetupScripts(selectedWorkspaceId, selectedSessionId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to run setup');
    }
  }, [selectedWorkspaceId, selectedSessionId]);

  const handleStopScript = useCallback(async (runId: string) => {
    if (!selectedWorkspaceId || !selectedSessionId) return;
    try {
      await stopScript(selectedWorkspaceId, selectedSessionId, runId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to stop script');
    }
  }, [selectedWorkspaceId, selectedSessionId]);

  if (loading && !config) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Show detected config preview for user confirmation
  if (pendingDetected) {
    const setupCount = pendingDetected.setupScripts.length;
    const runCount = Object.keys(pendingDetected.runScripts).length;
    return (
      <ScrollArea className="h-full">
        <div className="py-2 px-2 space-y-3">
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Detected Scripts
          </div>
          {setupCount > 0 && (
            <div>
              <span className="text-xs text-muted-foreground">Setup ({setupCount})</span>
              <div className="space-y-0.5 mt-1">
                {pendingDetected.setupScripts.map((s, i) => (
                  <div key={i} className="text-xs px-2 py-1 rounded-sm bg-muted/30">
                    <span className="font-medium">{s.name}</span>
                    <span className="text-muted-foreground ml-2 font-mono">{s.command}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {runCount > 0 && (
            <div>
              <span className="text-xs text-muted-foreground">Scripts ({runCount})</span>
              <div className="space-y-0.5 mt-1">
                {Object.entries(pendingDetected.runScripts).map(([key, s]) => (
                  <div key={key} className="text-xs px-2 py-1 rounded-sm bg-muted/30">
                    <span className="font-medium">{s.name}</span>
                    <span className="text-muted-foreground ml-2 font-mono">{s.command}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="flex gap-2 mt-2">
            <button
              onClick={handleConfirmDetected}
              disabled={loading}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              <CheckCircle2 className="h-3 w-3" />
              Save
            </button>
            <button
              onClick={handleDismissDetected}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md border border-border hover:bg-muted"
            >
              Dismiss
            </button>
          </div>
        </div>
      </ScrollArea>
    );
  }

  // Empty state: no config
  const hasConfig = config && ((config.setupScripts?.length ?? 0) > 0 || Object.keys(config.runScripts ?? {}).length > 0);
  if (!hasConfig) {
    return (
      <div className="h-full flex items-center justify-center">
        <EmptyState
          icon={Terminal}
          title="No scripts configured"
          description="Detect project scripts or ask the agent to set them up"
          action={
            <div className="flex gap-2 mt-2">
              <button
                onClick={handleDetect}
                disabled={loading || !selectedWorkspaceId}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                <Wand2 className="h-3 w-3" />
                Detect
              </button>
            </div>
          }
        />
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="py-2 px-2 space-y-3">
        {error && (
          <div className="text-xs text-text-error bg-background-error/10 px-2 py-1 rounded-sm">
            {error}
          </div>
        )}

        {/* Setup Scripts Section */}
        {config.setupScripts.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Setup
              </span>
              {sessionSetupProgress && (
                <SetupProgressBadge progress={sessionSetupProgress} />
              )}
            </div>
            <div className="space-y-1">
              {config.setupScripts.map((script, i) => {
                const run = sessionRuns.find(
                  (r) => r.scriptKey === `setup_${i}`
                );
                return (
                  <ScriptRunItem
                    key={`setup_${i}`}
                    name={script.name}
                    command={script.command}
                    run={run}
                    onStop={run ? () => handleStopScript(run.id) : undefined}
                  />
                );
              })}
            </div>
            {(!sessionSetupProgress || sessionSetupProgress.status !== 'running') && (
              <button
                onClick={handleRunSetup}
                className="mt-1.5 inline-flex items-center gap-1.5 px-2 py-0.5 text-xs font-medium rounded-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                <RotateCcw className="h-3 w-3" />
                {sessionSetupProgress?.status === 'failed' ? 'Retry Setup' : 'Run Setup'}
              </button>
            )}
          </div>
        )}

        {/* Run Scripts Section */}
        {Object.keys(config.runScripts).length > 0 && (
          <div>
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide block mb-1.5">
              Scripts
            </span>
            <div className="space-y-1">
              {Object.entries(config.runScripts).map(([key, script]) => {
                const run = sessionRuns.find(
                  (r) => r.scriptKey === key && r.status === 'running'
                ) || sessionRuns.filter((r) => r.scriptKey === key).pop();
                return (
                  <ScriptRunItem
                    key={key}
                    name={script.name}
                    command={script.command}
                    run={run}
                    onRun={() => handleRunScript(key)}
                    onStop={run?.status === 'running' ? () => handleStopScript(run.id) : undefined}
                  />
                );
              })}
            </div>
          </div>
        )}
      </div>
    </ScrollArea>
  );
}

function StatusIcon({ status }: { status?: ScriptRunStatus }) {
  switch (status) {
    case 'running':
      return <Loader2 className="h-3.5 w-3.5 text-text-info animate-spin shrink-0" />;
    case 'success':
      return <CheckCircle2 className="h-3.5 w-3.5 text-text-success shrink-0" />;
    case 'failed':
      return <XCircle className="h-3.5 w-3.5 text-text-error shrink-0" />;
    case 'cancelled':
      return <Square className="h-3.5 w-3.5 text-muted-foreground shrink-0" />;
    default:
      return <div className="h-3.5 w-3.5 rounded-full border border-border shrink-0" />;
  }
}

function formatDuration(startedAt?: string, finishedAt?: string): string | null {
  if (!startedAt) return null;
  const start = new Date(startedAt).getTime();
  const end = finishedAt ? new Date(finishedAt).getTime() : Date.now();
  const ms = end - start;
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
}

function ScriptRunItem({
  name,
  command,
  run,
  onRun,
  onStop,
}: {
  name: string;
  command: string;
  run?: ScriptRun;
  onRun?: () => void;
  onStop?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  // Subscribe to output version counter to re-render when new lines arrive
  const outputVersion = useAppStore((s) => s.scriptOutputVersion);
  const outputLines = useMemo(
    () => run ? getScriptOutputLines(run.sessionId, run.id) : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [run?.sessionId, run?.id, outputVersion]
  );
  const hasOutput = outputLines.length > 0;
  const duration = run ? formatDuration(run.startedAt, run.finishedAt) : null;

  // Auto-expand on failure
  useEffect(() => {
    if (run?.status === 'failed') {
      setExpanded(true);
    }
  }, [run?.status]);

  return (
    <div className="rounded-sm border border-border/50 overflow-hidden">
      <div
        className={cn(
          'flex items-center gap-2 px-2 py-1.5 cursor-pointer hover:bg-muted/30 transition-colors',
          run?.status === 'failed' && 'bg-background-error/5'
        )}
        onClick={() => hasOutput && setExpanded(!expanded)}
      >
        <StatusIcon status={run?.status} />
        <span className="text-xs font-medium flex-1 truncate" title={command}>
          {name}
        </span>
        {duration && (
          <span className="text-2xs text-muted-foreground tabular-nums">{duration}</span>
        )}
        {run?.status === 'running' && onStop && (
          <button
            onClick={(e) => { e.stopPropagation(); onStop(); }}
            className="p-0.5 rounded-sm hover:bg-muted text-muted-foreground hover:text-text-error transition-colors"
            title="Stop"
          >
            <Square className="h-3 w-3" />
          </button>
        )}
        {(!run || run.status !== 'running') && onRun && (
          <button
            onClick={(e) => { e.stopPropagation(); onRun(); }}
            className="p-0.5 rounded-sm hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            title="Run"
          >
            <Play className="h-3 w-3" />
          </button>
        )}
        {hasOutput && (
          expanded
            ? <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" />
            : <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />
        )}
      </div>
      {expanded && hasOutput && (
        <ScriptLogViewer
          lines={outputLines}
          streaming={run?.status === 'running'}
        />
      )}
    </div>
  );
}

function SetupProgressBadge({ progress }: { progress: SetupProgress }) {
  if (progress.status === 'running') {
    return (
      <span className="inline-flex items-center gap-1 text-2xs text-text-info">
        <Loader2 className="h-2.5 w-2.5 animate-spin" />
        {progress.current}/{progress.total}
      </span>
    );
  }
  if (progress.status === 'completed') {
    return (
      <span className="inline-flex items-center gap-1 text-2xs text-text-success">
        <CheckCircle2 className="h-2.5 w-2.5" />
        Done
      </span>
    );
  }
  if (progress.status === 'failed') {
    return (
      <span className="inline-flex items-center gap-1 text-2xs text-text-error">
        <XCircle className="h-2.5 w-2.5" />
        Failed
      </span>
    );
  }
  return null;
}
