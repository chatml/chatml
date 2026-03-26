'use client';

import { useState, useEffect, useRef } from 'react';
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

  // Track whether we've already fetched for this mount.
  // Note: this ref resets on every mount because HoverCardContent unmounts
  // when the hover card closes (no forceMount). The cross-hover cache is
  // provided by sessionDataCache (getSessionData below), not this ref.
  const fetchedRef = useRef(false);

  // Reset when session identity changes — uses the React "adjust state during
  // render" pattern to avoid synchronous setState inside an effect.
  const sessionKey = `${workspaceId}:${sessionId}`;
  const prevKeyRef = useRef(sessionKey);
  if (prevKeyRef.current !== sessionKey) {
    prevKeyRef.current = sessionKey;
    fetchedRef.current = false;
    setGitStatus(null);
    setPRDetails(null);
    setTemplates(null);
  }

  // Seed with cached data and set loading during render (not inside an effect)
  // to avoid the react-hooks/set-state-in-effect lint rule and to show
  // stale-while-revalidate content on the first paint without a flash.
  const willFetch = enabled && !fetchedRef.current && !!workspaceId && !!sessionId;
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
    if (!enabled || !workspaceId || !sessionId) return;
    if (fetchedRef.current) return;

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
        fetchedRef.current = true;
      }
    });

    return () => {
      cancelled = true;
      setLoading(false);
    };
  }, [enabled, workspaceId, sessionId, prStatus]);

  return { gitStatus, prDetails, templates, loading };
}
