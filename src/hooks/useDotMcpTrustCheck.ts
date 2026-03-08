'use client';

import { useEffect, useRef } from 'react';
import { getDotMcpInfo, getDotMcpTrust } from '@/lib/api';
import { useSettingsStore } from '@/stores/settingsStore';
import type { DialogManagerHandles } from '@/components/layout/DialogManager';
import type { Workspace } from '@/lib/types';

/**
 * Checks .mcp.json trust status when the selected workspace changes.
 * Shows the trust dialog if an untrusted .mcp.json is detected.
 */
export function useDotMcpTrustCheck(
  workspaces: Workspace[],
  selectedWorkspaceId: string | null,
  dialogRef: React.RefObject<DialogManagerHandles | null>
) {
  const checkedWorkspaces = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!selectedWorkspaceId) return;
    if (checkedWorkspaces.current.has(selectedWorkspaceId)) return;

    const neverLoad = useSettingsStore.getState().neverLoadDotMcp;
    if (neverLoad) return;

    checkedWorkspaces.current.add(selectedWorkspaceId);

    (async () => {
      try {
        const info = await getDotMcpInfo(selectedWorkspaceId);
        if (!info.exists || info.servers.length === 0) return;

        const trust = await getDotMcpTrust(selectedWorkspaceId);
        if (trust.status !== 'unknown') return;

        const workspace = workspaces.find((w) => w.id === selectedWorkspaceId);
        dialogRef.current?.showDotMcpTrust(
          selectedWorkspaceId,
          workspace?.name ?? 'Unknown workspace',
          info.servers
        );
      } catch {
        // Allow re-check on next workspace select
        checkedWorkspaces.current.delete(selectedWorkspaceId);
      }
    })();
  }, [selectedWorkspaceId, workspaces, dialogRef]);
}
