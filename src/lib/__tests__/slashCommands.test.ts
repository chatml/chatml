import { describe, it, expect } from 'vitest';
import { filterSlashCommands } from '../slashCommands';
import type { UnifiedSlashCommand } from '@/stores/slashCommandStore';
import { Terminal } from 'lucide-react';

function makeCommand(overrides: Partial<UnifiedSlashCommand> & { trigger: string }): UnifiedSlashCommand {
  return {
    id: overrides.trigger,
    label: overrides.trigger,
    description: '',
    icon: Terminal,
    source: 'builtin',
    executionType: 'inline',
    execute: () => {},
    ...overrides,
  };
}

const commands: UnifiedSlashCommand[] = [
  makeCommand({ trigger: 'commit', label: 'Commit changes', description: 'Create a git commit', keywords: ['git', 'save'] }),
  makeCommand({ trigger: 'review', label: 'Code review', description: 'Review code changes' }),
  makeCommand({ trigger: 'compact', label: 'Compact context', description: 'Summarize conversation' }),
  makeCommand({ trigger: 'help', label: 'Help', description: 'Show available commands' }),
  makeCommand({ trigger: 'clear', label: 'Clear chat', description: 'Reset the conversation' }),
];

describe('filterSlashCommands', () => {
  it('returns all commands when query is empty', () => {
    expect(filterSlashCommands(commands, '')).toEqual(commands);
  });

  it('returns empty array when nothing matches', () => {
    expect(filterSlashCommands(commands, 'zzzzz')).toEqual([]);
  });

  it('exact trigger match ranks highest', () => {
    const result = filterSlashCommands(commands, 'commit');
    expect(result[0].trigger).toBe('commit');
  });

  it('prefix match ranks above substring match', () => {
    // "com" is prefix of "commit" and "compact"; also matches "help" via description ("commands")
    const result = filterSlashCommands(commands, 'com');
    // commit and compact: prefix match (80), help: description match (10)
    expect(result[0].trigger).toBe('commit');
    expect(result[1].trigger).toBe('compact');
    expect(result.length).toBeGreaterThanOrEqual(2);
  });

  it('substring match in trigger ranks above label match', () => {
    // "view" is substring of "review" trigger
    const result = filterSlashCommands(commands, 'view');
    expect(result[0].trigger).toBe('review');
  });

  it('label match ranks above keyword match', () => {
    // "chat" matches label "Clear chat" and no trigger
    const result = filterSlashCommands(commands, 'chat');
    expect(result[0].trigger).toBe('clear');
  });

  it('keyword match ranks above description match', () => {
    // "git" is keyword for commit, also in description for commit — keyword should take priority path
    const cmds = [
      makeCommand({ trigger: 'deploy', label: 'Deploy', description: 'Push git changes to prod' }),
      makeCommand({ trigger: 'commit', label: 'Commit', description: 'Create a commit', keywords: ['git'] }),
    ];
    const result = filterSlashCommands(cmds, 'git');
    // commit matches via keywords (20), deploy matches via description (10)
    expect(result[0].trigger).toBe('commit');
    expect(result[1].trigger).toBe('deploy');
  });

  it('description match is lowest priority', () => {
    const result = filterSlashCommands(commands, 'summarize');
    expect(result).toHaveLength(1);
    expect(result[0].trigger).toBe('compact');
  });

  it('sorts alphabetically by trigger for same score', () => {
    const cmds = [
      makeCommand({ trigger: 'zebra', label: 'Zebra', description: 'Animal' }),
      makeCommand({ trigger: 'apple', label: 'Apple', description: 'Animal' }),
    ];
    // Both match "Animal" in description (score 10)
    const result = filterSlashCommands(cmds, 'animal');
    expect(result.map((c) => c.trigger)).toEqual(['apple', 'zebra']);
  });

  it('is case-insensitive', () => {
    const result = filterSlashCommands(commands, 'COMMIT');
    expect(result[0].trigger).toBe('commit');
  });
});
