import type { UnifiedSlashCommand } from '@/stores/slashCommandStore';

// Re-export types from store for backward compatibility
export type { UnifiedSlashCommand as SlashCommand } from '@/stores/slashCommandStore';
export type { SlashCommandAvailability, SlashCommandContext, SlashCommandSource } from '@/stores/slashCommandStore';

// ============================================================================
// Filtering
// ============================================================================

export function filterSlashCommands(commands: UnifiedSlashCommand[], query: string): UnifiedSlashCommand[] {
  if (!query) return commands;

  const lowerQuery = query.toLowerCase();

  return commands.filter((cmd) => {
    if (cmd.trigger.toLowerCase().includes(lowerQuery)) return true;
    if (cmd.label.toLowerCase().includes(lowerQuery)) return true;
    if (cmd.description.toLowerCase().includes(lowerQuery)) return true;
    if (cmd.keywords?.some((kw) => kw.toLowerCase().includes(lowerQuery))) return true;
    return false;
  });
}
