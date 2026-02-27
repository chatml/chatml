// TODO: When multi-provider support is added, generalize this to check the active provider's auth status.
import { useState, useEffect } from 'react';
import { getClaudeAuthStatus } from '@/lib/api';

export interface ClaudeAuthStatus {
  configured: boolean;
  hasStoredKey: boolean;
  hasEnvKey: boolean;
  hasCliCredentials: boolean;
  credentialSource: string;
}

export const DEFAULT_AUTH_STATUS: ClaudeAuthStatus = {
  configured: false,
  hasStoredKey: false,
  hasEnvKey: false,
  hasCliCredentials: false,
  credentialSource: '',
};

let cachedStatus: ClaudeAuthStatus | null = null;
const listeners = new Set<(v: ClaudeAuthStatus | null) => void>();

function notify(value: ClaudeAuthStatus | null) {
  cachedStatus = value;
  listeners.forEach((fn) => fn(value));
}

export function refreshClaudeAuthStatus() {
  getClaudeAuthStatus()
    .then((result) => notify(result))
    .catch(() => notify(DEFAULT_AUTH_STATUS));
}

export function useClaudeAuthStatus(): ClaudeAuthStatus | null {
  const [status, setStatus] = useState<ClaudeAuthStatus | null>(cachedStatus);

  useEffect(() => {
    listeners.add(setStatus);
    // Fetch on first subscriber
    if (cachedStatus === null) {
      refreshClaudeAuthStatus();
    }
    return () => { listeners.delete(setStatus); };
  }, []);

  return status;
}
