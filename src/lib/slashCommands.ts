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

  // Score each command: higher = better match. 0 = no match.
  const scored: { cmd: UnifiedSlashCommand; score: number }[] = [];

  for (const cmd of commands) {
    const trigger = cmd.trigger.toLowerCase();
    let score = 0;

    // Trigger matches (highest priority)
    if (trigger === lowerQuery) {
      score = 100; // exact match
    } else if (trigger.startsWith(lowerQuery)) {
      score = 80; // prefix match
    } else if (trigger.includes(lowerQuery)) {
      score = 60; // substring match
    }

    // Label match
    if (!score && cmd.label.toLowerCase().includes(lowerQuery)) {
      score = 40;
    }

    // Keywords match
    if (!score && cmd.keywords?.some((kw) => kw.toLowerCase().includes(lowerQuery))) {
      score = 20;
    }

    // Description match (lowest priority)
    if (!score && cmd.description.toLowerCase().includes(lowerQuery)) {
      score = 10;
    }

    if (score > 0) {
      scored.push({ cmd, score });
    }
  }

  // Sort by score descending, then alphabetically by trigger for ties
  scored.sort((a, b) => b.score - a.score || a.cmd.trigger.localeCompare(b.cmd.trigger));

  return scored.map((s) => s.cmd);
}
