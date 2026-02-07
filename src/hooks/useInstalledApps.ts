import { useEffect, useCallback, useState } from 'react';
import { APP_REGISTRY, getDetectionPairs } from '@/lib/openApps';
import { detectInstalledApps } from '@/lib/tauri';
import type { AppDefinition } from '@/lib/openApps';

export type InstalledApp = AppDefinition & { iconBase64?: string };

// Module-level cache
let cachedApps: InstalledApp[] | null = null;
let cacheTimestamp = 0;
const CACHE_TTL = Infinity; // detect once per session

function isCacheValid(): boolean {
  return cachedApps !== null && Date.now() - cacheTimestamp < CACHE_TTL;
}

export function useInstalledApps() {
  const [installedApps, setInstalledApps] = useState<InstalledApp[]>(() => {
    if (isCacheValid()) {
      return cachedApps!;
    }
    return [];
  });
  const [loading, setLoading] = useState(!isCacheValid());

  const detect = useCallback(async () => {
    setLoading(true);
    try {
      const pairs = getDetectionPairs();
      const detected = await detectInstalledApps(pairs);
      const iconMap = new Map(detected.map((d) => [d.id, d.iconBase64]));
      const apps: InstalledApp[] = APP_REGISTRY
        .filter((app) => iconMap.has(app.id))
        .map((app) => ({ ...app, iconBase64: iconMap.get(app.id) || undefined }));
      cachedApps = apps;
      cacheTimestamp = Date.now();
      setInstalledApps(apps);
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
    cachedApps = null;
    cacheTimestamp = 0;
    detect();
  }, [detect]);

  return { installedApps, loading, refresh };
}
