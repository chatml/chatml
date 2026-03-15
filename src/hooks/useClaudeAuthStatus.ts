// TODO: When multi-provider support is added, generalize this to check the active provider's auth status.
import { useState, useEffect } from 'react';
import { getClaudeAuthStatus, getAWSSSOTokenStatus } from '@/lib/api';

export interface ClaudeAuthStatus {
  configured: boolean;
  hasStoredKey: boolean;
  hasEnvKey: boolean;
  hasCliCredentials: boolean;
  hasBedrock: boolean;
  credentialSource: string;
  // AWS SSO token status (only present when Bedrock is configured)
  ssoTokenValid?: boolean | null;
  ssoTokenExpiresInMinutes?: number;
}

export const DEFAULT_AUTH_STATUS: ClaudeAuthStatus = {
  configured: false,
  hasStoredKey: false,
  hasEnvKey: false,
  hasCliCredentials: false,
  hasBedrock: false,
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
    .then(async (result) => {
      // If Bedrock is configured, also check SSO token status.
      if (result.hasBedrock) {
        try {
          const ssoStatus = await getAWSSSOTokenStatus();
          if (ssoStatus.applicable) {
            notify({ ...result, ssoTokenValid: ssoStatus.valid, ssoTokenExpiresInMinutes: ssoStatus.expiresInMinutes });
            return;
          }
        } catch {
          // Best-effort — don't block auth status on SSO check failure.
        }
      }
      notify(result);
    })
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
