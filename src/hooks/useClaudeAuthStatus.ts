// TODO: When multi-provider support is added, generalize this to check the active provider's auth status.
import { useState, useEffect } from 'react';
import { getClaudeAuthStatus } from '@/lib/api';

let cachedStatus: boolean | null = null;
const listeners = new Set<(v: boolean) => void>();

function notify(value: boolean) {
  cachedStatus = value;
  listeners.forEach((fn) => fn(value));
}

export function refreshClaudeAuthStatus() {
  getClaudeAuthStatus()
    .then((result) => notify(result.configured))
    .catch(() => notify(false));
}

export function useClaudeAuthStatus() {
  const [configured, setConfigured] = useState<boolean | null>(cachedStatus);

  useEffect(() => {
    listeners.add(setConfigured);
    // Fetch on first subscriber
    if (cachedStatus === null) {
      refreshClaudeAuthStatus();
    }
    return () => { listeners.delete(setConfigured); };
  }, []);

  return configured;
}
