import { useReducer } from 'react';
import type { CleanupBranchTarget } from '@/lib/api';
import type { CleanupState, CleanupAction } from './types';

const initialState: CleanupState = {
  step: 'analysis',
  analysis: null,
  selectedBranches: new Map(),
  deleteRemoteToo: false,
  staleDaysThreshold: 90,
  retryCount: 0,
  results: null,
  error: null,
  isLoading: false,
};

function cleanupReducer(state: CleanupState, action: CleanupAction): CleanupState {
  switch (action.type) {
    case 'SET_STEP':
      return { ...state, step: action.step, error: null };

    case 'SET_ANALYSIS': {
      // Auto-select all deletable branches
      const selected = new Map<string, CleanupBranchTarget>();
      for (const candidate of action.analysis.candidates) {
        if (candidate.deletable) {
          selected.set(candidate.name, {
            name: candidate.name,
            deleteLocal: !candidate.isRemote,
            deleteRemote: false, // Remote is opt-in
          });
        }
      }
      return {
        ...state,
        analysis: action.analysis,
        selectedBranches: selected,
        step: 'review',
        isLoading: false,
        error: null,
      };
    }

    case 'TOGGLE_BRANCH': {
      const selected = new Map(state.selectedBranches);
      if (selected.has(action.name)) {
        selected.delete(action.name);
      } else {
        selected.set(action.name, {
          name: action.name,
          deleteLocal: !action.isRemote,
          deleteRemote: action.isRemote || (action.hasLocalAndRemote && state.deleteRemoteToo),
        });
      }
      return { ...state, selectedBranches: selected };
    }

    case 'SELECT_ALL_CATEGORY': {
      if (!state.analysis) return state;
      const selected = new Map(state.selectedBranches);
      for (const candidate of state.analysis.candidates) {
        if (candidate.deletable && candidate.category === action.category) {
          selected.set(candidate.name, {
            name: candidate.name,
            deleteLocal: !candidate.isRemote,
            deleteRemote: candidate.isRemote || (candidate.hasLocalAndRemote && state.deleteRemoteToo),
          });
        }
      }
      return { ...state, selectedBranches: selected };
    }

    case 'DESELECT_ALL_CATEGORY': {
      if (!state.analysis) return state;
      const selected = new Map(state.selectedBranches);
      for (const candidate of state.analysis.candidates) {
        if (candidate.category === action.category) {
          selected.delete(candidate.name);
        }
      }
      return { ...state, selectedBranches: selected };
    }

    case 'TOGGLE_REMOTE_DELETE': {
      const deleteRemoteToo = !state.deleteRemoteToo;
      // Build lookup for O(1) candidate access
      const candidateMap = new Map<string, { isRemote: boolean; hasLocalAndRemote: boolean }>();
      if (state.analysis) {
        for (const c of state.analysis.candidates) {
          candidateMap.set(c.name, { isRemote: c.isRemote, hasLocalAndRemote: c.hasLocalAndRemote });
        }
      }
      // Update all selected branches' remote flag
      const selected = new Map<string, CleanupBranchTarget>();
      for (const [name, target] of state.selectedBranches) {
        const candidate = candidateMap.get(name);
        selected.set(name, {
          ...target,
          deleteRemote: candidate?.isRemote
            ? true
            : (candidate?.hasLocalAndRemote && deleteRemoteToo) || false,
        });
      }
      return { ...state, deleteRemoteToo, selectedBranches: selected };
    }

    case 'SET_STALE_THRESHOLD':
      return { ...state, staleDaysThreshold: action.days };

    case 'RETRY':
      return { ...state, retryCount: state.retryCount + 1, error: null, isLoading: true };

    case 'SET_RESULTS':
      return { ...state, results: action.results, step: 'results', isLoading: false };

    case 'SET_ERROR':
      return { ...state, error: action.error, isLoading: false };

    case 'SET_LOADING':
      return { ...state, isLoading: action.loading };

    case 'RESET':
      return { ...initialState, selectedBranches: new Map() };

    default:
      return state;
  }
}

export function useCleanupReducer() {
  return useReducer(cleanupReducer, initialState);
}
