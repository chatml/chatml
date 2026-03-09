'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, XCircle, AlertTriangle, Loader2, RefreshCw, Cpu, ExternalLink } from 'lucide-react';
import { OnboardingWizardStep } from '../OnboardingWizardStep';
import { checkPrerequisites, openUrlInBrowser, type PrerequisitesResult, type PrerequisiteStatus } from '@/lib/tauri';
import { cn } from '@/lib/utils';

interface PrerequisitesStepProps {
  onAllCriticalMet: (met: boolean) => void;
}

function ToolRow({ tool }: { tool: PrerequisiteStatus }) {
  const isOk = tool.found && tool.versionOk;
  const isMissing = !tool.found;
  const isWrongVersion = tool.found && !tool.versionOk;

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-3">
        {isOk && <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />}
        {(isMissing || isWrongVersion) && tool.required && (
          <XCircle className="w-5 h-5 text-red-400 shrink-0" />
        )}
        {(isMissing || isWrongVersion) && !tool.required && (
          <AlertTriangle className="w-5 h-5 text-yellow-400 shrink-0" />
        )}

        <div className="flex items-baseline gap-2 text-left">
          <span className={cn('font-medium', isOk ? 'text-foreground' : 'text-foreground/80')}>
            {tool.name}
          </span>
          {isOk && tool.version && (
            <span className="text-sm text-muted-foreground">v{tool.version}</span>
          )}
          {isMissing && (
            <span className="text-sm text-muted-foreground">
              Not found{!tool.required && ' (optional)'}
            </span>
          )}
          {isWrongVersion && tool.version && (
            <span className="text-sm text-red-400/80">
              v{tool.version} (requires {tool.minVersion}+)
            </span>
          )}
        </div>
      </div>

      {/* Install hint for missing/wrong-version tools */}
      {(!isOk) && (
        <div className="ml-8 mt-1 text-left">
          <pre className="text-xs text-muted-foreground/70 bg-foreground/5 rounded-lg px-3 py-2 whitespace-pre-wrap font-mono">
            {tool.installHint}
          </pre>
          {tool.installUrl && (
            <button
              onClick={() => openUrlInBrowser(tool.installUrl!)}
              className="inline-flex items-center gap-1 text-xs text-brand hover:text-brand/80 transition-colors mt-1"
            >
              Learn more
              <ExternalLink className="w-3 h-3" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function PrerequisitesStep({ onAllCriticalMet }: PrerequisitesStepProps) {
  const [result, setResult] = useState<PrerequisitesResult | null>(null);
  const [loading, setLoading] = useState(true);

  // Fetch prerequisites on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await checkPrerequisites();
      if (cancelled) return;
      setResult(res);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  // Sync parent state when result changes
  useEffect(() => {
    // In browser dev mode, result is null — treat as all met
    onAllCriticalMet(result?.allCriticalMet ?? true);
  }, [result, onAllCriticalMet]);

  async function runChecks() {
    setLoading(true);
    const res = await checkPrerequisites();
    setResult(res);
    setLoading(false);
  }

  if (loading) {
    return (
      <OnboardingWizardStep
        icon={<Cpu className="w-8 h-8 text-brand" />}
        title="Checking system"
      >
        <div className="flex items-center justify-center gap-2 text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span>Detecting installed tools...</span>
        </div>
      </OnboardingWizardStep>
    );
  }

  // Browser dev mode — no Tauri, skip gracefully
  if (!result) {
    return (
      <OnboardingWizardStep
        icon={<Cpu className="w-8 h-8 text-brand" />}
        title="System requirements"
      >
        <p className="text-muted-foreground">
          Prerequisites check is only available in the desktop app.
        </p>
      </OnboardingWizardStep>
    );
  }

  const allOk = result.allCriticalMet &&
    result.tools.every((t) => t.found && t.versionOk);

  return (
    <OnboardingWizardStep
      icon={<Cpu className="w-8 h-8 text-brand" />}
      title={allOk ? 'System ready' : 'System requirements'}
    >
      <div className="space-y-3 w-full">
        {result.tools.map((tool) => (
          <ToolRow key={tool.name} tool={tool} />
        ))}
      </div>

      {!allOk && (
        <button
          onClick={runChecks}
          className="inline-flex items-center gap-1.5 text-sm text-brand hover:text-brand/80 transition-colors mt-2"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Re-check
        </button>
      )}

      {allOk && (
        <p className="text-sm text-muted-foreground/70 mt-1">
          All tools detected. You&apos;re good to go.
        </p>
      )}
    </OnboardingWizardStep>
  );
}
