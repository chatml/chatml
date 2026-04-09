'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { getSpendStats } from '@/lib/api';
import { useAppEventListener } from '@/lib/custom-events';
import type { SpendStats } from '@/lib/types';
import { DollarSign } from 'lucide-react';

function formatCost(amount: number): string {
  if (amount < 0.01) return '$0.00';
  return `$${amount.toFixed(2)}`;
}

function Sparkline({ data, className }: { data: number[]; className?: string }) {
  if (data.length === 0) return null;
  const max = Math.max(...data, 0.01); // Avoid division by zero
  const barWidth = 100 / data.length;

  return (
    <svg viewBox="0 0 100 24" className={className} preserveAspectRatio="none">
      {data.map((val, i) => {
        const height = (val / max) * 20;
        return (
          <rect
            key={i}
            x={i * barWidth + barWidth * 0.1}
            y={24 - height}
            width={barWidth * 0.8}
            height={Math.max(height, 0.5)}
            rx={1}
            className="fill-brand/60"
          />
        );
      })}
    </svg>
  );
}

function HorizontalBar({ label, value, max, className }: { label: string; value: number; max: number; className?: string }) {
  const pct = max > 0 ? Math.max((value / max) * 100, 2) : 0;
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-muted-foreground w-20 truncate">{label}</span>
      <div className="flex-1 h-2 bg-surface-2 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${className ?? 'bg-brand/60'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs text-muted-foreground w-14 text-right">{formatCost(value)}</span>
    </div>
  );
}

export function SpendTracker() {
  const [stats, setStats] = useState<SpendStats | null>(null);
  const [loading, setLoading] = useState(true);

  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const fetchStats = useCallback(async () => {
    try {
      const data = await getSpendStats(14);
      setStats(data);
    } catch {
      // Silently fail — spend data is non-critical
    } finally {
      setLoading(false);
    }
  }, []);

  const debouncedFetchStats = useCallback(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(fetchStats, 500);
  }, [fetchStats]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  // Re-fetch when cost events arrive (debounced to coalesce rapid events)
  useAppEventListener('dashboard-spend-invalidate', debouncedFetchStats);

  if (loading) {
    return (
      <div className="rounded-lg border border-border/50 bg-surface-1/50 p-6">
        <div className="flex items-center gap-2 text-muted-foreground">
          <DollarSign className="w-4 h-4" />
          <span className="text-sm">Loading spend data...</span>
        </div>
      </div>
    );
  }

  if (!stats || (stats.todayTotal === 0 && stats.weekTotal === 0)) {
    return (
      <div className="rounded-lg border border-border/50 bg-surface-1/50 p-6">
        <div className="flex items-center gap-2 text-muted-foreground">
          <DollarSign className="w-4 h-4" />
          <span className="text-sm">No usage data yet</span>
        </div>
      </div>
    );
  }

  const modelEntries = Object.entries(stats.byModel).sort(([, a], [, b]) => b - a);
  const workspaceEntries = Object.entries(stats.byWorkspace).sort(([, a], [, b]) => b - a);
  const maxModel = modelEntries[0]?.[1] ?? 0;
  const maxWorkspace = workspaceEntries[0]?.[1] ?? 0;

  // Simplify model names for display
  const simplifyModelName = (name: string) => {
    if (name.includes('opus')) return 'Opus';
    if (name.includes('sonnet')) return 'Sonnet';
    if (name.includes('haiku')) return 'Haiku';
    return name.length > 15 ? name.slice(0, 12) + '...' : name;
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <DollarSign className="w-4 h-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold text-foreground">Spend</h2>
      </div>

      <div className="rounded-lg border border-border/50 bg-surface-1/50 p-4 space-y-4">
        {/* Totals + Sparkline */}
        <div className="flex items-start gap-6">
          <div>
            <p className="text-xs text-muted-foreground">Today</p>
            <p className="text-xl font-semibold text-foreground">{formatCost(stats.todayTotal)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">This Week</p>
            <p className="text-xl font-semibold text-foreground">{formatCost(stats.weekTotal)}</p>
          </div>
          <div className="flex-1 pt-3">
            <Sparkline
              data={stats.dailyBreakdown.map((d) => d.total)}
              className="w-full h-8"
            />
          </div>
        </div>

        {/* Breakdowns */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* By Model */}
          {modelEntries.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs text-muted-foreground font-medium">By Model</p>
              {modelEntries.slice(0, 4).map(([model, value]) => (
                <HorizontalBar
                  key={model}
                  label={simplifyModelName(model)}
                  value={value}
                  max={maxModel}
                />
              ))}
            </div>
          )}

          {/* By Workspace */}
          {workspaceEntries.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs text-muted-foreground font-medium">By Workspace</p>
              {workspaceEntries.slice(0, 4).map(([ws, value]) => (
                <HorizontalBar
                  key={ws}
                  label={ws}
                  value={value}
                  max={maxWorkspace}
                  className="bg-purple-500/60"
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
