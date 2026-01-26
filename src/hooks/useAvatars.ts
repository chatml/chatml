'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { getAvatars } from '@/lib/api';

// Client-side avatar cache (persists across component remounts within the session)
const avatarCache = new Map<string, string>();

/**
 * Hook to fetch and cache avatar URLs for email addresses.
 * Uses both client-side caching and batches requests to reduce API calls.
 */
export function useAvatars(emails: string[]): Record<string, string> {
  const [fetchedAvatars, setFetchedAvatars] = useState<Record<string, string>>({});
  const fetchedRef = useRef(new Set<string>());

  // Normalize and deduplicate emails
  const normalizedEmails = useMemo(() => {
    return [...new Set(emails)]
      .filter(email => email && email.trim())
      .map(email => email.toLowerCase());
  }, [emails]);

  // Build initial result from cache (computed synchronously, not in effect)
  const cachedAvatars = useMemo(() => {
    const result: Record<string, string> = {};
    for (const email of normalizedEmails) {
      if (avatarCache.has(email)) {
        result[email] = avatarCache.get(email)!;
      }
    }
    return result;
  }, [normalizedEmails]);

  const fetchAvatars = useCallback(async (emailsToFetch: string[]) => {
    if (emailsToFetch.length === 0) return;

    try {
      const result = await getAvatars(emailsToFetch);

      // Update cache and state
      for (const [email, url] of Object.entries(result)) {
        avatarCache.set(email.toLowerCase(), url);
      }

      setFetchedAvatars(prev => ({ ...prev, ...result }));
    } catch (error) {
      console.error('Failed to fetch avatars:', error);
      // Mark as fetched even on error to avoid repeated failed requests
      for (const email of emailsToFetch) {
        avatarCache.set(email.toLowerCase(), '');
      }
    }
  }, []);

  useEffect(() => {
    if (normalizedEmails.length === 0) return;

    // Collect emails that need fetching
    const needFetch: string[] = [];

    for (const email of normalizedEmails) {
      if (!avatarCache.has(email) && !fetchedRef.current.has(email)) {
        needFetch.push(email);
        fetchedRef.current.add(email);
      }
    }

    // Fetch missing avatars with debounce
    if (needFetch.length > 0) {
      const timeoutId = setTimeout(() => {
        fetchAvatars(needFetch);
      }, 50);

      return () => clearTimeout(timeoutId);
    }
  }, [normalizedEmails, fetchAvatars]);

  // Merge cached and fetched avatars
  return useMemo(() => {
    return { ...cachedAvatars, ...fetchedAvatars };
  }, [cachedAvatars, fetchedAvatars]);
}

/**
 * Get a single avatar from the cache synchronously.
 * Returns undefined if not cached.
 */
export function getCachedAvatar(email: string): string | undefined {
  return avatarCache.get(email.toLowerCase());
}

/**
 * Clear the avatar cache (useful for testing or cache invalidation).
 */
export function clearAvatarCache(): void {
  avatarCache.clear();
}
