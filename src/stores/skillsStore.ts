import { create } from 'zustand';
import * as api from '@/lib/api';
import type { SkillDTO, SkillListParams } from '@/lib/api';
import { useSlashCommandStore } from './slashCommandStore';

interface SkillsState {
  // State
  skills: SkillDTO[];
  isLoading: boolean;
  error: string | null;
  searchQuery: string;

  // Actions
  fetchSkills: (params?: SkillListParams) => Promise<void>;
  installSkill: (skillId: string) => Promise<void>;
  uninstallSkill: (skillId: string) => Promise<void>;
  setSearchQuery: (query: string) => void;
}

// Sync installed skills to the slash command store so the / menu stays current
function syncToSlashCommands(skills: SkillDTO[]) {
  useSlashCommandStore.getState().setInstalledSkills(skills.filter((s) => s.installed));
}

export const useSkillsStore = create<SkillsState>((set, get) => ({
  skills: [],
  isLoading: false,
  error: null,
  searchQuery: '',

  fetchSkills: async (params) => {
    set({ isLoading: true, error: null });
    try {
      const skills = await api.listSkills(params);
      set({ skills, isLoading: false });
    } catch (err) {
      const message = err instanceof api.ApiError ? err.message : 'Failed to fetch skills';
      set({ error: message, isLoading: false });
    }
  },

  installSkill: async (skillId) => {
    try {
      await api.installSkill(skillId);
      // Update local state
      set((state) => ({
        skills: state.skills.map((s) =>
          s.id === skillId ? { ...s, installed: true, installedAt: new Date().toISOString() } : s
        ),
      }));
      syncToSlashCommands(get().skills);
    } catch (err) {
      const message = err instanceof api.ApiError ? err.message : 'Failed to install skill';
      set({ error: message });
      throw err;
    }
  },

  uninstallSkill: async (skillId) => {
    try {
      await api.uninstallSkill(skillId);
      // Update local state
      set((state) => ({
        skills: state.skills.map((s) =>
          s.id === skillId ? { ...s, installed: false, installedAt: undefined } : s
        ),
      }));
      syncToSlashCommands(get().skills);
    } catch (err) {
      const message = err instanceof api.ApiError ? err.message : 'Failed to uninstall skill';
      set({ error: message });
      throw err;
    }
  },

  setSearchQuery: (query) => set({ searchQuery: query }),
}));
