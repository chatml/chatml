import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useSkillsStore } from '../skillsStore';
import { useSlashCommandStore } from '../slashCommandStore';
import type { SkillDTO } from '@/lib/api';

vi.mock('@/lib/api', () => ({
  listSkills: vi.fn(),
  installSkill: vi.fn(),
  uninstallSkill: vi.fn(),
  ApiError: class ApiError extends Error {},
}));

function makeSkill(overrides: Partial<SkillDTO> = {}): SkillDTO {
  return {
    id: 'skill-1',
    name: 'Test Skill',
    description: 'A test skill',
    installed: false,
    ...overrides,
  } as SkillDTO;
}

let mockApi: {
  listSkills: ReturnType<typeof vi.fn>;
  installSkill: ReturnType<typeof vi.fn>;
  uninstallSkill: ReturnType<typeof vi.fn>;
  ApiError: typeof Error;
};

beforeEach(async () => {
  mockApi = (await import('@/lib/api')) as unknown as typeof mockApi;
  vi.mocked(mockApi.listSkills).mockReset();
  vi.mocked(mockApi.installSkill).mockReset();
  vi.mocked(mockApi.uninstallSkill).mockReset();

  useSkillsStore.setState({
    skills: [],
    isLoading: false,
    error: null,
    searchQuery: '',
  });
});

// ============================================================================
// fetchSkills
// ============================================================================

describe('fetchSkills', () => {
  it('fetches skills and stores them', async () => {
    const skills = [makeSkill({ id: 's1' }), makeSkill({ id: 's2' })];
    vi.mocked(mockApi.listSkills).mockResolvedValue(skills);

    await useSkillsStore.getState().fetchSkills();
    const state = useSkillsStore.getState();
    expect(state.skills).toEqual(skills);
    expect(state.isLoading).toBe(false);
    expect(state.error).toBeNull();
  });

  it('sets loading state during fetch', async () => {
    let resolvePromise: (value: SkillDTO[]) => void;
    vi.mocked(mockApi.listSkills).mockReturnValue(
      new Promise((resolve) => { resolvePromise = resolve; }),
    );

    const fetchPromise = useSkillsStore.getState().fetchSkills();
    expect(useSkillsStore.getState().isLoading).toBe(true);

    resolvePromise!([]);
    await fetchPromise;
    expect(useSkillsStore.getState().isLoading).toBe(false);
  });

  it('handles API errors', async () => {
    const { ApiError } = mockApi;
    vi.mocked(mockApi.listSkills).mockRejectedValue(new ApiError('Not found'));

    await useSkillsStore.getState().fetchSkills();
    const state = useSkillsStore.getState();
    expect(state.error).toBe('Not found');
    expect(state.isLoading).toBe(false);
  });

  it('handles non-API errors with generic message', async () => {
    vi.mocked(mockApi.listSkills).mockRejectedValue(new Error('network'));

    await useSkillsStore.getState().fetchSkills();
    expect(useSkillsStore.getState().error).toBe('Failed to fetch skills');
  });

  it('passes params to API', async () => {
    vi.mocked(mockApi.listSkills).mockResolvedValue([]);
    const params = { search: 'test' };
    await useSkillsStore.getState().fetchSkills(params);
    expect(mockApi.listSkills).toHaveBeenCalledWith(params);
  });
});

// ============================================================================
// installSkill
// ============================================================================

describe('installSkill', () => {
  it('calls API and updates local state', async () => {
    vi.mocked(mockApi.installSkill).mockResolvedValue(undefined);
    useSkillsStore.setState({
      skills: [makeSkill({ id: 's1', installed: false })],
    });

    await useSkillsStore.getState().installSkill('s1');
    const skill = useSkillsStore.getState().skills.find((s) => s.id === 's1');
    expect(skill?.installed).toBe(true);
    expect(skill?.installedAt).toBeDefined();
  });

  it('syncs installed skills to slash command store', async () => {
    const setInstalledSkills = vi.fn();
    // @ts-expect-error -- partial state stub for test
    useSlashCommandStore.setState({ setInstalledSkills });
    vi.mocked(mockApi.installSkill).mockResolvedValue(undefined);
    useSkillsStore.setState({
      skills: [makeSkill({ id: 's1', installed: false })],
    });

    await useSkillsStore.getState().installSkill('s1');
    expect(setInstalledSkills).toHaveBeenCalled();
  });

  it('sets error and re-throws on failure', async () => {
    const { ApiError } = mockApi;
    vi.mocked(mockApi.installSkill).mockRejectedValue(new ApiError('Install failed'));
    useSkillsStore.setState({ skills: [makeSkill({ id: 's1' })] });

    await expect(useSkillsStore.getState().installSkill('s1')).rejects.toThrow();
    expect(useSkillsStore.getState().error).toBe('Install failed');
  });
});

// ============================================================================
// uninstallSkill
// ============================================================================

describe('uninstallSkill', () => {
  it('calls API and updates local state', async () => {
    vi.mocked(mockApi.uninstallSkill).mockResolvedValue(undefined);
    useSkillsStore.setState({
      skills: [makeSkill({ id: 's1', installed: true, installedAt: '2025-01-01' } as Partial<SkillDTO>)],
    });

    await useSkillsStore.getState().uninstallSkill('s1');
    const skill = useSkillsStore.getState().skills.find((s) => s.id === 's1');
    expect(skill?.installed).toBe(false);
    expect(skill?.installedAt).toBeUndefined();
  });

  it('sets error and re-throws on failure', async () => {
    vi.mocked(mockApi.uninstallSkill).mockRejectedValue(new Error('network'));
    useSkillsStore.setState({ skills: [makeSkill({ id: 's1', installed: true })] });

    await expect(useSkillsStore.getState().uninstallSkill('s1')).rejects.toThrow();
    expect(useSkillsStore.getState().error).toBe('Failed to uninstall skill');
  });
});

// ============================================================================
// setSearchQuery
// ============================================================================

describe('setSearchQuery', () => {
  it('updates the search query', () => {
    useSkillsStore.getState().setSearchQuery('hello');
    expect(useSkillsStore.getState().searchQuery).toBe('hello');
  });
});
