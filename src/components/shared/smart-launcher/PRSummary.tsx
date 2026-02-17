'use client';

import { navigate } from '@/lib/navigation';
import type { PRSummaryData } from './useLauncherPRSummary';

interface PRSummaryProps {
  summary: PRSummaryData | null;
  loading: boolean;
  error: string | null;
}

export function PRSummary({ summary, loading, error }: PRSummaryProps) {
  // Hide entirely on error
  if (error) return null;

  const handleViewAll = () => {
    navigate({ contentView: { type: 'pr-dashboard' } });
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Pull Requests
        </h2>
        {summary && summary.total > 0 && (
          <button
            onClick={handleViewAll}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            View all
          </button>
        )}
      </div>

      {loading && (
        <div className="animate-pulse bg-muted-foreground/10 rounded h-5 w-64" />
      )}

      {!loading && summary && summary.total === 0 && (
        <p className="text-sm text-muted-foreground">No open pull requests</p>
      )}

      {!loading && summary && summary.total > 0 && (
        <p className="text-sm">
          <span className="text-foreground font-medium">{summary.total} open</span>
          {summary.ready > 0 && (
            <>
              <span className="text-muted-foreground"> · </span>
              <span className="text-emerald-500">{summary.ready} ready to merge</span>
            </>
          )}
          {summary.failing > 0 && (
            <>
              <span className="text-muted-foreground"> · </span>
              <span className="text-red-500">{summary.failing} failing</span>
            </>
          )}
          {summary.conflicts > 0 && (
            <>
              <span className="text-muted-foreground"> · </span>
              <span className="text-amber-500">{summary.conflicts} conflicts</span>
            </>
          )}
          {summary.pending > 0 && (
            <>
              <span className="text-muted-foreground"> · </span>
              <span className="text-muted-foreground">{summary.pending} pending</span>
            </>
          )}
        </p>
      )}
    </div>
  );
}
