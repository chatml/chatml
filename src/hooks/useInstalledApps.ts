import { useEffect, useCallback, useState } from 'react';
import { APP_REGISTRY, getDetectionPairs } from '@/lib/openApps';
import { detectInstalledApps } from '@/lib/tauri';
import type { AppDefinition } from '@/lib/openApps';

// Module-level cache
let cachedIds: string[] | null = null;
let cacheTimestamp = 0;
const CACHE_TTL = 60_000; // 60 seconds

function isCacheValid(): boolean {
  return cachedIds !== null && Date.now() - cacheTimestamp < CACHE_TTL;
}

export function useInstalledApps() {
  const [installedApps, setInstalledApps] = useState<AppDefinition[]>(() => {
    if (isCacheValid()) {
      return APP_REGISTRY.filter((app) => cachedIds!.includes(app.id));
    }
    return [];
  });
  const [loading, setLoading] = useState(!isCacheValid());

  const detect = useCallback(async () => {
    setLoading(true);
    try {
      const pairs = getDetectionPairs();
      const ids = await detectInstalledApps(pairs);
      cachedIds = ids;
      cacheTimestamp = Date.now();
      setInstalledApps(APP_REGISTRY.filter((app) => ids.includes(app.id)));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isCacheValid()) {
      detect();
    }
  }, [detect]);

  const refresh = useCallback(() => {
    // Invalidate cache and re-detect
    cachedIds = null;
    cacheTimestamp = 0;
    detect();
  }, [detect]);

  return { installedApps, loading, refresh };
}
