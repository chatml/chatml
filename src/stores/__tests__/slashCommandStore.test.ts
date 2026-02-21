import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useSlashCommandStore } from '../slashCommandStore';
import type { SkillDTO } from '@/lib/api';
import type { UserCommandFile, SdkCommandInfo, SlashCommandAvailability } from '../slashCommandStore';

vi.mock('@/lib/api', () => ({
  listUserCommands: vi.fn(),
}));

function makeSkill(overrides: Partial<SkillDTO> = {}): SkillDTO {
  return {
    id: 'test-skill',
    name: 'Test Skill',
    description: 'A test skill',
    category: 'productivity' as SkillDTO['category'],
    author: 'test',
    version: '1.0.0',
    preview: '',
    skillPath: '/path',
    createdAt: '2025-01-01',
    updatedAt: '2025-01-01',
    ...overrides,
  };
}

function makeUserCommand(overrides: Partial<UserCommandFile> = {}): UserCommandFile {
  return {
    name: 'my-command',
    description: 'A user command',
    filePath: '/commands/my-command.md',
    content: 'Do something',
    ...overrides,
  };
}

const withSession: SlashCommandAvailability = { hasSession: true };
const noSession: SlashCommandAvailability = { hasSession: false };

beforeEach(() => {
  useSlashCommandStore.setState({
    installedSkills: [],
    userCommands: [],
    sdkCommands: [],
    sdkCommandMeta: {},
  });
});

// ============================================================================
// getAllCommands
// ============================================================================

describe('getAllCommands', () => {
  it('returns built-in commands when no session and no extras', () => {
    const commands = useSlashCommandStore.getState().getAllCommands(noSession);
    // Built-in commands without requiresSession: help, refactor, explain, plan, think
    const triggers = commands.map((c) => c.trigger);
    expect(triggers).toContain('help');
    expect(triggers).toContain('plan');
    expect(triggers).toContain('think');
    // Session-required commands should be filtered out
    expect(triggers).not.toContain('sync');
    expect(triggers).not.toContain('deep-review');
    expect(triggers).not.toContain('security');
  });

  it('returns all built-in commands when session is active', () => {
    const commands = useSlashCommandStore.getState().getAllCommands(withSession);
    const triggers = commands.map((c) => c.trigger);
    expect(triggers).toContain('help');
    expect(triggers).toContain('sync');
    expect(triggers).toContain('deep-review');
    expect(triggers).toContain('security');
    expect(triggers).toContain('plan');
    expect(triggers).toContain('think');
  });

  it('includes installed skills', () => {
    useSlashCommandStore.getState().setInstalledSkills([
      makeSkill({ id: 'commit', name: 'Auto Commit' }),
    ]);

    const commands = useSlashCommandStore.getState().getAllCommands(withSession);
    const skill = commands.find((c) => c.trigger === 'commit');
    expect(skill).toBeDefined();
    expect(skill!.source).toBe('skill');
    expect(skill!.label).toBe('Auto Commit');
  });

  it('includes user commands', () => {
    useSlashCommandStore.getState().setUserCommands([
      makeUserCommand({ name: 'deploy', description: 'Deploy to prod' }),
    ]);

    const commands = useSlashCommandStore.getState().getAllCommands(withSession);
    const cmd = commands.find((c) => c.trigger === 'deploy');
    expect(cmd).toBeDefined();
    expect(cmd!.source).toBe('user');
  });

  it('includes SDK commands', () => {
    useSlashCommandStore.getState().setSdkCommands(['lint', 'format']);

    const commands = useSlashCommandStore.getState().getAllCommands(withSession);
    expect(commands.find((c) => c.trigger === 'lint')).toBeDefined();
    expect(commands.find((c) => c.trigger === 'format')).toBeDefined();
  });

  it('deduplicates: built-in wins over skill with same trigger', () => {
    useSlashCommandStore.getState().setInstalledSkills([
      makeSkill({ id: 'help', name: 'Custom Help' }),
    ]);

    const commands = useSlashCommandStore.getState().getAllCommands(withSession);
    const helpCmds = commands.filter((c) => c.trigger === 'help');
    expect(helpCmds).toHaveLength(1);
    expect(helpCmds[0].source).toBe('builtin');
  });

  it('deduplicates: skill wins over SDK with same trigger', () => {
    useSlashCommandStore.getState().setInstalledSkills([
      makeSkill({ id: 'lint', name: 'Lint Skill' }),
    ]);
    useSlashCommandStore.getState().setSdkCommands(['lint']);

    const commands = useSlashCommandStore.getState().getAllCommands(withSession);
    const lintCmds = commands.filter((c) => c.trigger === 'lint');
    expect(lintCmds).toHaveLength(1);
    expect(lintCmds[0].source).toBe('skill');
  });

  it('sorts commands alphabetically by trigger', () => {
    useSlashCommandStore.getState().setSdkCommands(['zoo', 'alpha', 'mid']);

    const commands = useSlashCommandStore.getState().getAllCommands(withSession);
    const triggers = commands.map((c) => c.trigger);
    const sorted = [...triggers].sort();
    expect(triggers).toEqual(sorted);
  });

  it('filters skills/user/sdk by requiresSession', () => {
    useSlashCommandStore.getState().setInstalledSkills([
      makeSkill({ id: 'my-skill', name: 'My Skill' }),
    ]);
    useSlashCommandStore.getState().setUserCommands([
      makeUserCommand({ name: 'my-cmd' }),
    ]);
    useSlashCommandStore.getState().setSdkCommands(['sdk-cmd']);

    const commands = useSlashCommandStore.getState().getAllCommands(noSession);
    expect(commands.find((c) => c.trigger === 'my-skill')).toBeUndefined();
    expect(commands.find((c) => c.trigger === 'my-cmd')).toBeUndefined();
    expect(commands.find((c) => c.trigger === 'sdk-cmd')).toBeUndefined();
  });

  it('uses rich SDK metadata description when available', () => {
    const richMeta: SdkCommandInfo[] = [
      { name: 'deploy', description: 'Deploy to production server' },
    ];
    useSlashCommandStore.getState().setSdkCommandsRich(richMeta);

    const commands = useSlashCommandStore.getState().getAllCommands(withSession);
    const deploy = commands.find((c) => c.trigger === 'deploy');
    expect(deploy).toBeDefined();
    expect(deploy!.description).toBe('Deploy to production server');
  });

  it('falls back to generic description for SDK commands without metadata', () => {
    useSlashCommandStore.getState().setSdkCommands(['unknown-cmd']);

    const commands = useSlashCommandStore.getState().getAllCommands(withSession);
    const cmd = commands.find((c) => c.trigger === 'unknown-cmd');
    expect(cmd!.description).toBe('Plugin command: unknown-cmd');
  });
});

// ============================================================================
// Cache behavior
// ============================================================================

describe('command cache', () => {
  it('returns same reference on repeated calls with unchanged sources', () => {
    const first = useSlashCommandStore.getState().getAllCommands(withSession);
    const second = useSlashCommandStore.getState().getAllCommands(withSession);
    expect(first).toBe(second);
  });

  it('invalidates cache when skills change', () => {
    const first = useSlashCommandStore.getState().getAllCommands(withSession);
    useSlashCommandStore.getState().setInstalledSkills([makeSkill()]);
    const second = useSlashCommandStore.getState().getAllCommands(withSession);
    expect(first).not.toBe(second);
  });

  it('invalidates cache when user commands change', () => {
    const first = useSlashCommandStore.getState().getAllCommands(withSession);
    useSlashCommandStore.getState().setUserCommands([makeUserCommand()]);
    const second = useSlashCommandStore.getState().getAllCommands(withSession);
    expect(first).not.toBe(second);
  });

  it('invalidates cache when SDK commands change', () => {
    const first = useSlashCommandStore.getState().getAllCommands(withSession);
    useSlashCommandStore.getState().setSdkCommands(['new-cmd']);
    const second = useSlashCommandStore.getState().getAllCommands(withSession);
    expect(first).not.toBe(second);
  });

  it('invalidates cache when availability changes', () => {
    const first = useSlashCommandStore.getState().getAllCommands(noSession);
    const second = useSlashCommandStore.getState().getAllCommands(withSession);
    expect(first).not.toBe(second);
  });
});

// ============================================================================
// User command execution types
// ============================================================================

describe('user command execution', () => {
  it('sets execution type to prompt when content has $ARGUMENTS', () => {
    useSlashCommandStore.getState().setUserCommands([
      makeUserCommand({ name: 'search', content: 'Search for $ARGUMENTS' }),
    ]);

    const commands = useSlashCommandStore.getState().getAllCommands(withSession);
    const cmd = commands.find((c) => c.trigger === 'search');
    expect(cmd!.executionType).toBe('prompt');
  });

  it('sets execution type to skill when content has no $ARGUMENTS', () => {
    useSlashCommandStore.getState().setUserCommands([
      makeUserCommand({ name: 'run-tests', content: 'Run all tests' }),
    ]);

    const commands = useSlashCommandStore.getState().getAllCommands(withSession);
    const cmd = commands.find((c) => c.trigger === 'run-tests');
    expect(cmd!.executionType).toBe('skill');
  });
});

// ============================================================================
// setSdkCommandsRich
// ============================================================================

describe('setSdkCommandsRich', () => {
  it('populates both sdkCommands and sdkCommandMeta', () => {
    const commands: SdkCommandInfo[] = [
      { name: 'build', description: 'Build project' },
      { name: 'test', description: 'Run tests', argumentHint: '<pattern>' },
    ];

    useSlashCommandStore.getState().setSdkCommandsRich(commands);
    const state = useSlashCommandStore.getState();

    expect(state.sdkCommands).toEqual(['build', 'test']);
    expect(state.sdkCommandMeta['build']).toEqual({ name: 'build', description: 'Build project' });
    expect(state.sdkCommandMeta['test']).toEqual({
      name: 'test',
      description: 'Run tests',
      argumentHint: '<pattern>',
    });
  });
});

// ============================================================================
// fetchUserCommands
// ============================================================================

describe('fetchUserCommands', () => {
  it('fetches and stores user commands from API', async () => {
    const { listUserCommands } = await import('@/lib/api');
    vi.mocked(listUserCommands).mockResolvedValue([
      { name: 'deploy', description: 'Deploy', filePath: '/deploy.md', content: 'deploy it' },
    ]);

    await useSlashCommandStore.getState().fetchUserCommands('ws-1', 'session-1');

    const state = useSlashCommandStore.getState();
    expect(state.userCommands).toHaveLength(1);
    expect(state.userCommands[0].name).toBe('deploy');
  });

  it('silently fails on API error', async () => {
    const { listUserCommands } = await import('@/lib/api');
    vi.mocked(listUserCommands).mockRejectedValue(new Error('network'));

    // Should not throw
    await useSlashCommandStore.getState().fetchUserCommands('ws-1', 'session-1');
    expect(useSlashCommandStore.getState().userCommands).toEqual([]);
  });
});
