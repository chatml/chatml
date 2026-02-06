import { create } from 'zustand';
import * as api from '@/lib/api';
import type { SkillDTO, SkillCategory, SkillListParams } from '@/lib/api';

interface SkillsState {
  // State
  skills: SkillDTO[];
  isLoading: boolean;
  error: string | null;
  selectedCategory: SkillCategory | null;
  searchQuery: string;

  // Actions
  fetchSkills: (params?: SkillListParams) => Promise<void>;
  installSkill: (skillId: string) => Promise<void>;
  uninstallSkill: (skillId: string) => Promise<void>;
  setSelectedCategory: (category: SkillCategory | null) => void;
  setSearchQuery: (query: string) => void;
}

export const useSkillsStore = create<SkillsState>((set) => ({
  skills: [],
  isLoading: false,
  error: null,
  selectedCategory: null,
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
    } catch (err) {
      const message = err instanceof api.ApiError ? err.message : 'Failed to uninstall skill';
      set({ error: message });
      throw err;
    }
  },

  setSelectedCategory: (category) => set({ selectedCategory: category }),
  setSearchQuery: (query) => set({ searchQuery: query }),
}));
