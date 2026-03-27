import type { SprintPhase, SessionTaskStatus } from './types';
import { SPRINT_PHASES } from './types';

// ---------------------------------------------------------------------------
// Sprint Artifact Types
// ---------------------------------------------------------------------------

export type SprintArtifactType =
  | 'thinking-notes'
  | 'design-doc'
  | 'implementation'
  | 'review-comments'
  | 'test-results'
  | 'pull-request'
  | 'retrospective';

export interface SprintArtifact {
  id: string;
  type: SprintArtifactType;
  phase: SprintPhase;
  label: string;
  createdAt: string;
  /** Optional reference: PR URL, file path, conversation message ID */
  ref?: string;
}

// ---------------------------------------------------------------------------
// Phase-to-Command Mapping (from gstack)
// ---------------------------------------------------------------------------

export interface PhaseCommand {
  trigger: string;
  label: string;
  description: string;
}

export const PHASE_COMMANDS: Record<SprintPhase, PhaseCommand[]> = {
  think: [
    { trigger: 'office-hours', label: 'Office Hours', description: 'Challenge assumptions and sharpen the problem' },
  ],
  plan: [
    { trigger: 'plan-ceo-review', label: 'CEO Review', description: 'Product-level scope and direction review' },
    { trigger: 'plan-eng-review', label: 'Eng Review', description: 'Architecture, data flow, and test planning' },
    { trigger: 'plan-design-review', label: 'Design Review', description: 'UX consistency and design quality' },
  ],
  build: [],
  review: [
    { trigger: 'review', label: 'Code Review', description: 'Inspect changes for regressions and hidden risk' },
  ],
  test: [
    { trigger: 'qa', label: 'QA', description: 'Walk the app like a user, fix issues, add coverage' },
  ],
  ship: [
    { trigger: 'ship', label: 'Ship', description: 'Run tests, create PR, prepare for merge' },
  ],
  reflect: [
    { trigger: 'retro', label: 'Retrospective', description: 'Summarize lessons learned and follow-ups' },
  ],
};

// ---------------------------------------------------------------------------
// Artifact Definitions Per Phase
// ---------------------------------------------------------------------------

export interface PhaseArtifactDef {
  type: SprintArtifactType;
  label: string;
}

export const PHASE_ARTIFACTS: Record<SprintPhase, PhaseArtifactDef[]> = {
  think:   [{ type: 'thinking-notes', label: 'Thinking Notes' }],
  plan:    [{ type: 'design-doc', label: 'Design Doc' }],
  build:   [{ type: 'implementation', label: 'Implementation' }],
  review:  [{ type: 'review-comments', label: 'Review Comments' }],
  test:    [{ type: 'test-results', label: 'Test Results' }],
  ship:    [{ type: 'pull-request', label: 'Pull Request' }],
  reflect: [{ type: 'retrospective', label: 'Retrospective' }],
};

// ---------------------------------------------------------------------------
// Prerequisites: which artifact types from prior phases are needed
// ---------------------------------------------------------------------------

export const PHASE_PREREQUISITES: Record<SprintPhase, SprintArtifactType[]> = {
  think:   [],
  plan:    ['thinking-notes'],
  build:   ['design-doc'],
  review:  ['implementation'],
  test:    ['review-comments'],
  ship:    ['test-results'],
  reflect: ['pull-request'],
};

// ---------------------------------------------------------------------------
// Phase → TaskStatus auto-sync mapping
// Moved from SessionToolbarContent.tsx for centralization.
// ---------------------------------------------------------------------------

export const PHASE_TO_STATUS: Record<SprintPhase, SessionTaskStatus> = {
  think:   'in_progress',
  plan:    'in_progress',
  build:   'in_progress',
  review:  'in_review',
  test:    'in_review',
  ship:    'in_progress',
  reflect: 'done',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export type PhaseStatus = 'completed' | 'current' | 'next' | 'future' | 'inactive';

export function getPhaseStatus(
  phase: SprintPhase,
  currentPhase: SprintPhase | null | undefined,
): PhaseStatus {
  if (!currentPhase) return 'inactive';
  const phaseIdx = SPRINT_PHASES.indexOf(phase);
  const currentIdx = SPRINT_PHASES.indexOf(currentPhase);
  if (phaseIdx < currentIdx) return 'completed';
  if (phaseIdx === currentIdx) return 'current';
  if (phaseIdx === currentIdx + 1) return 'next';
  return 'future';
}

/**
 * Check if all prerequisites for a phase are met based on existing artifacts.
 */
export function arePrerequisitesMet(
  phase: SprintPhase,
  artifacts: SprintArtifact[],
): boolean {
  const required = PHASE_PREREQUISITES[phase];
  if (required.length === 0) return true;
  const existing = new Set(artifacts.map((a) => a.type));
  return required.every((t) => existing.has(t));
}

/**
 * Get artifacts for a specific phase from the full artifact list.
 */
export function getArtifactsForPhase(
  phase: SprintPhase,
  artifacts: SprintArtifact[],
): SprintArtifact[] {
  return artifacts.filter((a) => a.phase === phase);
}
