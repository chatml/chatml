// Workspace color palette used for workspace dot indicators across the app
export const WORKSPACE_COLORS = [
  '#6366f1', '#8b5cf6', '#ec4899', '#f43f5e', '#f97316',
  '#eab308', '#22c55e', '#14b8a6', '#06b6d4', '#3b82f6',
];

export function resolveWorkspaceColor(
  workspaceId: string,
  workspaceColors: Record<string, string>
): string {
  return workspaceColors[workspaceId] || getWorkspaceColor(workspaceId);
}

export function getWorkspaceColor(workspaceId: string): string {
  let hash = 0;
  for (let i = 0; i < workspaceId.length; i++) {
    hash = ((hash << 5) - hash) + workspaceId.charCodeAt(i);
    hash |= 0;
  }
  return WORKSPACE_COLORS[Math.abs(hash) % WORKSPACE_COLORS.length];
}
