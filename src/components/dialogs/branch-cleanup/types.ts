import type { CleanupAnalysisResponse, CleanupBranchTarget, CleanupResult } from '@/lib/api';

export type CleanupStep = 'analysis' | 'review' | 'confirmation' | 'execution' | 'results';

export interface CleanupState {
  step: CleanupStep;
  analysis: CleanupAnalysisResponse | null;
  selectedBranches: Map<string, CleanupBranchTarget>;
  deleteRemoteToo: boolean;
  staleDaysThreshold: number;
  retryCount: number;
  results: CleanupResult | null;
  error: string | null;
  isLoading: boolean;
}

export type CleanupAction =
  | { type: 'SET_STEP'; step: CleanupStep }
  | { type: 'SET_ANALYSIS'; analysis: CleanupAnalysisResponse }
  | { type: 'TOGGLE_BRANCH'; name: string; isRemote: boolean; hasLocalAndRemote: boolean }
  | { type: 'SELECT_ALL_CATEGORY'; category: string }
  | { type: 'DESELECT_ALL_CATEGORY'; category: string }
  | { type: 'TOGGLE_REMOTE_DELETE' }
  | { type: 'SET_STALE_THRESHOLD'; days: number }
  | { type: 'RETRY' }
  | { type: 'SET_RESULTS'; results: CleanupResult }
  | { type: 'SET_ERROR'; error: string }
  | { type: 'SET_LOADING'; loading: boolean }
  | { type: 'RESET' };
