'use client';

import { useState, useEffect } from 'react';
import { getSessionSnapshot, getPRStatus, getGlobalActionTemplates, getWorkspaceActionTemplates } from '@/lib/api';
import { getSessionData } from '@/lib/sessionDataCache';
import { fetchMergedActionTemplates, ACTION_TEMPLATES } from '@/lib/action-templates';
import type { GitStatusDTO, PRDetails } from '@/lib/api';
import type { ActionTemplateKey } from '@/lib/action-templates';

interface UseHoverActionDataResult {
  gitStatus: GitStatusDTO | null;
  prDetails: PRDetails | null;
  templates: Record<ActionTemplateKey, string> | null;
  loading: boolean;
}

/**
 * One-shot data fetcher for the session hover card primary action.
 *
 * Fires when `enabled` becomes true (hover card opens). No polling.
 * Uses sessionDataCache for instant stale display while fresh data loads.
 *
 * Note: HoverCardContent unmounts when closed (no forceMount), so this hook
 * remounts on every hover. Cross-hover caching comes from sessionDataCache.
 */
export function useHoverActionData(
  workspaceId: string,
  sessionId: string,
  prStatus: string | undefined,
  enabled: boolean,
): UseHoverActionDataResult {
  const [gitStatus, setGitStatus] = useState<GitStatusDTO | null>(null);
  const [prDetails, setPRDetails] = useState<PRDetails | null>(null);
  const [templates, setTemplates] = useState<Record<ActionTemplateKey, string> | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetched, setFetched] = useState(false);

  // Reset all state when session identity changes — React's recommended
  // "adjust state during render" pattern (no refs, no effects).
  const [prevKey, setPrevKey] = useState(`${workspaceId}:${sessionId}`);
  const sessionKey = `${workspaceId}:${sessionId}`;
  if (prevKey !== sessionKey) {
    setPrevKey(sessionKey);
    setFetched(false);
    setGitStatus(null);
    setPRDetails(null);
    setTemplates(null);
    setLoading(false);
  }

  // Seed with cached data and set loading during render so the first paint
  // shows stale-while-revalidate content without a flash.
  const willFetch = enabled && !fetched && !!workspaceId && !!sessionId;
  if (willFetch && !gitStatus) {
    const cached = getSessionData(workspaceId, sessionId);
    if (cached?.gitStatus) {
      setGitStatus(cached.gitStatus);
    }
  }
  if (willFetch && !loading) {
    setLoading(true);
  }

  useEffect(() => {
    if (!enabled || !workspaceId || !sessionId || fetched) return;

    let cancelled = false;

    // Fetch git status, PR details, and action templates in parallel
    const snapshotPromise = getSessionSnapshot(workspaceId, sessionId)
      .then((snapshot) => {
        if (!cancelled) {
          setGitStatus(snapshot.gitStatus);
        }
      })
      .catch(() => { /* keep cached/null */ });

    const prPromise = (prStatus && prStatus !== 'none')
      ? getPRStatus(workspaceId, sessionId)
          .then((details) => {
            if (!cancelled) setPRDetails(details);
          })
          .catch(() => { /* keep null */ })
      : Promise.resolve();

    const templatesPromise = fetchMergedActionTemplates(
      workspaceId, getGlobalActionTemplates, getWorkspaceActionTemplates,
    )
      .then((merged) => {
        if (!cancelled) setTemplates(merged);
      })
      .catch(() => {
        // Fall back to built-in defaults
        if (!cancelled) setTemplates({ ...ACTION_TEMPLATES });
      });

    Promise.all([snapshotPromise, prPromise, templatesPromise]).then(() => {
      if (!cancelled) {
        setLoading(false);
        setFetched(true);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [enabled, workspaceId, sessionId, prStatus, fetched]);

  return { gitStatus, prDetails, templates, loading };
}
