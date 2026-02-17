'use client';

import { useState, useEffect } from 'react';
import { getPRs } from '@/lib/api';
import { computePRStatus } from '@/lib/pr-utils';

export interface PRSummaryData {
  total: number;
  ready: number;
  failing: number;
  pending: number;
  draft: number;
  conflicts: number;
}

export function useLauncherPRSummary(): {
  summary: PRSummaryData | null;
  loading: boolean;
  error: string | null;
} {
  const [summary, setSummary] = useState<PRSummaryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    getPRs()
      .then((prs) => {
        if (controller.signal.aborted) return;

        const categorized = prs.map(computePRStatus);
        const data: PRSummaryData = {
          total: categorized.length,
          ready: 0,
          failing: 0,
          pending: 0,
          draft: 0,
          conflicts: 0,
        };

        for (const pr of categorized) {
          switch (pr.statusCategory) {
            case 'ready': data.ready++; break;
            case 'failures': data.failing++; break;
            case 'pending': data.pending++; break;
            case 'draft': data.draft++; break;
            case 'conflicts': data.conflicts++; break;
          }
        }

        setSummary(data);
        setLoading(false);
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : 'Failed to fetch PRs');
        setLoading(false);
      });

    return () => controller.abort();
  }, []);

  return { summary, loading, error };
}
