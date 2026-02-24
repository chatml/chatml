'use client';

import { navigate } from '@/lib/navigation';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import type { PRSummaryData } from './useLauncherPRSummary';

interface PRSummaryProps {
  summary: PRSummaryData | null;
  loading: boolean;
  error: string | null;
}

export function PRSummary({ summary, loading, error }: PRSummaryProps) {
  if (error) return null;

  const handleViewAll = () => {
    navigate({ contentView: { type: 'pr-dashboard' } });
  };

  return (
    <Card elevation="none" className="border-border/50 py-0">
      <div className="px-5 py-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Pull Requests
          </h2>
          {summary && summary.total > 0 && (
            <button
              onClick={handleViewAll}
              className="text-xs text-primary hover:text-primary/80 transition-colors"
            >
              View all &rarr;
            </button>
          )}
        </div>

        {/* Loading state */}
        {loading && (
          <div className="flex items-center gap-3">
            <Skeleton className="h-6 w-8" />
            <Skeleton className="h-5 w-48" />
          </div>
        )}

        {/* Empty state */}
        {!loading && summary && summary.total === 0 && (
          <p className="text-sm text-muted-foreground">No open pull requests</p>
        )}

        {/* PR stats with badges */}
        {!loading && summary && summary.total > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-lg font-semibold text-foreground">{summary.total}</span>
            <span className="text-sm text-muted-foreground mr-1">open</span>

            {summary.ready > 0 && (
              <Badge className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20">
                {summary.ready} ready
              </Badge>
            )}
            {summary.failing > 0 && (
              <Badge className="bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20">
                {summary.failing} failing
              </Badge>
            )}
            {summary.conflicts > 0 && (
              <Badge className="bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20">
                {summary.conflicts} conflicts
              </Badge>
            )}
            {summary.pending > 0 && (
              <Badge className="bg-muted text-muted-foreground border-border/50">
                {summary.pending} pending
              </Badge>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
