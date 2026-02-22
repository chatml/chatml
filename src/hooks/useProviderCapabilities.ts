import { useState, useEffect } from 'react';
import { getApiBase } from '@/lib/api';

export interface ProviderCapabilities {
  name: string;
  supportsThinking: boolean;
  supportsPlanMode: boolean;
  supportsSubAgents: boolean;
  supportsEffort: boolean;
}

const DEFAULT_CAPABILITIES: ProviderCapabilities = {
  name: 'claude',
  supportsThinking: true,
  supportsPlanMode: true,
  supportsSubAgents: true,
  supportsEffort: true,
};

// TODO: Invalidate when multi-provider or runtime config changes are supported.
let cachedCapabilities: ProviderCapabilities | null = null;

export function useProviderCapabilities(): ProviderCapabilities {
  const [caps, setCaps] = useState<ProviderCapabilities>(
    cachedCapabilities ?? DEFAULT_CAPABILITIES
  );

  useEffect(() => {
    if (cachedCapabilities) return;

    fetch(`${getApiBase()}/api/provider/capabilities`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data: ProviderCapabilities) => {
        cachedCapabilities = data;
        setCaps(data);
      })
      .catch(() => {
        cachedCapabilities = DEFAULT_CAPABILITIES;
      });
  }, []);

  return caps;
}
