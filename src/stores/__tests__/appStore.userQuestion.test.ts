import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '../appStore';
import type { PendingUserQuestion, UserQuestion } from '@/lib/types';

const CONV_ID = 'conv-1';
const CONV_ID_2 = 'conv-2';

function makeQuestion(overrides: Partial<UserQuestion> = {}): UserQuestion {
  return {
    question: 'Pick a language',
    header: 'Language',
    options: [
      { label: 'TypeScript', description: 'Typed JS' },
      { label: 'Python', description: 'General purpose' },
      { label: 'Go', description: 'Fast compiled' },
    ],
    multiSelect: false,
    ...overrides,
  };
}

function makePending(overrides: Partial<PendingUserQuestion> = {}): PendingUserQuestion {
  return {
    requestId: 'req-1',
    questions: [makeQuestion()],
    currentIndex: 0,
    selectedIndices: {},
    otherSelected: {},
    otherText: {},
    freeTextAnswer: {},
    ...overrides,
  };
}

describe('appStore — user question actions', () => {
  beforeEach(() => {
    useAppStore.setState({ pendingUserQuestion: {} });
  });

  // ==========================================================================
  // setPendingUserQuestion
  // ==========================================================================

  describe('setPendingUserQuestion', () => {
    it('sets a pending question for a conversation', () => {
      const pending = makePending();
      useAppStore.getState().setPendingUserQuestion(CONV_ID, pending);

      const state = useAppStore.getState();
      expect(state.pendingUserQuestion[CONV_ID]).toEqual(pending);
    });

    it('sets null to clear a pending question', () => {
      useAppStore.getState().setPendingUserQuestion(CONV_ID, makePending());
      useAppStore.getState().setPendingUserQuestion(CONV_ID, null);

      const state = useAppStore.getState();
      expect(state.pendingUserQuestion[CONV_ID]).toBeNull();
    });

    it('replaces an existing pending question', () => {
      useAppStore.getState().setPendingUserQuestion(CONV_ID, makePending({ requestId: 'req-1' }));
      const newPending = makePending({ requestId: 'req-2' });
      useAppStore.getState().setPendingUserQuestion(CONV_ID, newPending);

      const state = useAppStore.getState();
      expect(state.pendingUserQuestion[CONV_ID]?.requestId).toBe('req-2');
    });

    it('does not affect other conversations', () => {
      const pending1 = makePending({ requestId: 'req-1' });
      const pending2 = makePending({ requestId: 'req-2' });
      useAppStore.getState().setPendingUserQuestion(CONV_ID, pending1);
      useAppStore.getState().setPendingUserQuestion(CONV_ID_2, pending2);

      const state = useAppStore.getState();
      expect(state.pendingUserQuestion[CONV_ID]?.requestId).toBe('req-1');
      expect(state.pendingUserQuestion[CONV_ID_2]?.requestId).toBe('req-2');
    });
  });

  // ==========================================================================
  // toggleUserQuestionOption
  // ==========================================================================

  describe('toggleUserQuestionOption', () => {
    it('selects an option index in single-select mode', () => {
      useAppStore.getState().setPendingUserQuestion(CONV_ID, makePending());
      useAppStore.getState().toggleUserQuestionOption(CONV_ID, 'Language', 0, false);

      const state = useAppStore.getState();
      expect(state.pendingUserQuestion[CONV_ID]?.selectedIndices['Language']).toEqual([0]);
    });

    it('replaces selection in single-select mode (not toggling off)', () => {
      useAppStore.getState().setPendingUserQuestion(CONV_ID, makePending());
      useAppStore.getState().toggleUserQuestionOption(CONV_ID, 'Language', 0, false);
      useAppStore.getState().toggleUserQuestionOption(CONV_ID, 'Language', 2, false);

      const state = useAppStore.getState();
      expect(state.pendingUserQuestion[CONV_ID]?.selectedIndices['Language']).toEqual([2]);
    });

    it('toggles indices on/off in multi-select mode', () => {
      useAppStore.getState().setPendingUserQuestion(CONV_ID, makePending({
        questions: [makeQuestion({ multiSelect: true })],
      }));
      useAppStore.getState().toggleUserQuestionOption(CONV_ID, 'Language', 0, true);
      useAppStore.getState().toggleUserQuestionOption(CONV_ID, 'Language', 2, true);
      useAppStore.getState().toggleUserQuestionOption(CONV_ID, 'Language', 0, true);

      const state = useAppStore.getState();
      expect(state.pendingUserQuestion[CONV_ID]?.selectedIndices['Language']).toEqual([2]);
    });

    it('preserves indices for other questions when toggling one', () => {
      useAppStore.getState().setPendingUserQuestion(CONV_ID, makePending({
        questions: [
          makeQuestion({ header: 'Language' }),
          makeQuestion({ header: 'Database', question: 'Pick a DB' }),
        ],
      }));
      useAppStore.getState().toggleUserQuestionOption(CONV_ID, 'Language', 1, false);
      useAppStore.getState().toggleUserQuestionOption(CONV_ID, 'Database', 0, false);

      const state = useAppStore.getState();
      const indices = state.pendingUserQuestion[CONV_ID]?.selectedIndices;
      expect(indices?.['Language']).toEqual([1]);
      expect(indices?.['Database']).toEqual([0]);
    });

    it('clears Other selection AND text in single-select when a regular option is picked', () => {
      const store = useAppStore.getState();
      store.setPendingUserQuestion(CONV_ID, makePending());
      store.selectUserQuestionOther(CONV_ID, 'Language', false);
      store.setUserQuestionOtherText(CONV_ID, 'Language', 'Rust');
      store.toggleUserQuestionOption(CONV_ID, 'Language', 0, false);

      const state = useAppStore.getState();
      expect(state.pendingUserQuestion[CONV_ID]?.otherSelected['Language']).toBeUndefined();
      expect(state.pendingUserQuestion[CONV_ID]?.otherText['Language']).toBeUndefined();
      expect(state.pendingUserQuestion[CONV_ID]?.selectedIndices['Language']).toEqual([0]);
    });

    it('keeps Other selection AND text in multi-select when a regular option is picked', () => {
      const store = useAppStore.getState();
      store.setPendingUserQuestion(CONV_ID, makePending({
        questions: [makeQuestion({ multiSelect: true })],
      }));
      store.selectUserQuestionOther(CONV_ID, 'Language', true);
      store.setUserQuestionOtherText(CONV_ID, 'Language', 'Rust');
      store.toggleUserQuestionOption(CONV_ID, 'Language', 0, true);

      const state = useAppStore.getState();
      expect(state.pendingUserQuestion[CONV_ID]?.otherSelected['Language']).toBe(true);
      expect(state.pendingUserQuestion[CONV_ID]?.otherText['Language']).toBe('Rust');
      expect(state.pendingUserQuestion[CONV_ID]?.selectedIndices['Language']).toEqual([0]);
    });

    it('is a no-op when no pending question exists', () => {
      useAppStore.getState().toggleUserQuestionOption(CONV_ID, 'Language', 0, false);

      const state = useAppStore.getState();
      expect(state.pendingUserQuestion[CONV_ID]).toBeUndefined();
    });
  });

  // ==========================================================================
  // selectUserQuestionOther / deselectUserQuestionOther
  // ==========================================================================

  describe('selectUserQuestionOther', () => {
    it('marks Other as selected without touching otherText', () => {
      useAppStore.getState().setPendingUserQuestion(CONV_ID, makePending());
      useAppStore.getState().selectUserQuestionOther(CONV_ID, 'Language', false);

      const state = useAppStore.getState();
      expect(state.pendingUserQuestion[CONV_ID]?.otherSelected['Language']).toBe(true);
      expect(state.pendingUserQuestion[CONV_ID]?.otherText['Language']).toBeUndefined();
    });

    it('does not touch existing otherText (callers reset via deselect first)', () => {
      const store = useAppStore.getState();
      store.setPendingUserQuestion(CONV_ID, makePending({
        questions: [makeQuestion({ multiSelect: true })],
      }));
      store.selectUserQuestionOther(CONV_ID, 'Language', true);
      store.setUserQuestionOtherText(CONV_ID, 'Language', 'Rust');
      // Toggle off (deselect clears text) then re-select — text stays cleared.
      store.deselectUserQuestionOther(CONV_ID, 'Language');
      store.selectUserQuestionOther(CONV_ID, 'Language', true);

      const state = useAppStore.getState();
      expect(state.pendingUserQuestion[CONV_ID]?.otherSelected['Language']).toBe(true);
      expect(state.pendingUserQuestion[CONV_ID]?.otherText['Language']).toBeUndefined();
    });

    it('clears selected indices in single-select mode', () => {
      const store = useAppStore.getState();
      store.setPendingUserQuestion(CONV_ID, makePending());
      store.toggleUserQuestionOption(CONV_ID, 'Language', 1, false);
      store.selectUserQuestionOther(CONV_ID, 'Language', false);

      const state = useAppStore.getState();
      expect(state.pendingUserQuestion[CONV_ID]?.otherSelected['Language']).toBe(true);
      expect(state.pendingUserQuestion[CONV_ID]?.selectedIndices['Language']).toBeUndefined();
    });

    it('keeps selected indices in multi-select mode', () => {
      const store = useAppStore.getState();
      store.setPendingUserQuestion(CONV_ID, makePending({
        questions: [makeQuestion({ multiSelect: true })],
      }));
      store.toggleUserQuestionOption(CONV_ID, 'Language', 1, true);
      store.selectUserQuestionOther(CONV_ID, 'Language', true);

      const state = useAppStore.getState();
      expect(state.pendingUserQuestion[CONV_ID]?.otherSelected['Language']).toBe(true);
      expect(state.pendingUserQuestion[CONV_ID]?.selectedIndices['Language']).toEqual([1]);
    });

    it('is idempotent when Other is already selected', () => {
      const store = useAppStore.getState();
      store.setPendingUserQuestion(CONV_ID, makePending());
      store.selectUserQuestionOther(CONV_ID, 'Language', false);
      const before = useAppStore.getState().pendingUserQuestion[CONV_ID];
      store.selectUserQuestionOther(CONV_ID, 'Language', false);
      const after = useAppStore.getState().pendingUserQuestion[CONV_ID];
      expect(after).toBe(before); // same reference, no re-render
    });
  });

  describe('deselectUserQuestionOther', () => {
    it('removes Other selection AND its text', () => {
      const store = useAppStore.getState();
      store.setPendingUserQuestion(CONV_ID, makePending());
      store.selectUserQuestionOther(CONV_ID, 'Language', false);
      store.setUserQuestionOtherText(CONV_ID, 'Language', 'Rust');
      store.deselectUserQuestionOther(CONV_ID, 'Language');

      const state = useAppStore.getState();
      expect(state.pendingUserQuestion[CONV_ID]?.otherSelected['Language']).toBeUndefined();
      expect(state.pendingUserQuestion[CONV_ID]?.otherText['Language']).toBeUndefined();
    });
  });

  // ==========================================================================
  // setUserQuestionOtherText
  // ==========================================================================

  describe('setUserQuestionOtherText', () => {
    it('stores text without changing selection state', () => {
      const store = useAppStore.getState();
      store.setPendingUserQuestion(CONV_ID, makePending());
      store.setUserQuestionOtherText(CONV_ID, 'Language', 'Rust');

      const state = useAppStore.getState();
      expect(state.pendingUserQuestion[CONV_ID]?.otherText['Language']).toBe('Rust');
      // Note: text is independent of selection — caller must select Other separately.
      expect(state.pendingUserQuestion[CONV_ID]?.otherSelected['Language']).toBeUndefined();
    });

    it('updates the existing text', () => {
      const store = useAppStore.getState();
      store.setPendingUserQuestion(CONV_ID, makePending());
      store.setUserQuestionOtherText(CONV_ID, 'Language', 'Rust');
      store.setUserQuestionOtherText(CONV_ID, 'Language', 'Zig');

      const state = useAppStore.getState();
      expect(state.pendingUserQuestion[CONV_ID]?.otherText['Language']).toBe('Zig');
    });
  });

  // ==========================================================================
  // setUserQuestionFreeText
  // ==========================================================================

  describe('setUserQuestionFreeText', () => {
    it('stores free-text answer separately from otherText', () => {
      const store = useAppStore.getState();
      store.setPendingUserQuestion(CONV_ID, makePending({
        questions: [makeQuestion({ options: [], header: 'Why' })],
      }));
      store.setUserQuestionFreeText(CONV_ID, 'Why', 'because');

      const state = useAppStore.getState();
      expect(state.pendingUserQuestion[CONV_ID]?.freeTextAnswer['Why']).toBe('because');
      expect(state.pendingUserQuestion[CONV_ID]?.otherText['Why']).toBeUndefined();
    });
  });

  // ==========================================================================
  // nextUserQuestion
  // ==========================================================================

  describe('nextUserQuestion', () => {
    it('increments currentIndex', () => {
      useAppStore.getState().setPendingUserQuestion(CONV_ID, makePending({
        questions: [makeQuestion(), makeQuestion({ header: 'Q2' }), makeQuestion({ header: 'Q3' })],
        currentIndex: 0,
      }));
      useAppStore.getState().nextUserQuestion(CONV_ID);

      const state = useAppStore.getState();
      expect(state.pendingUserQuestion[CONV_ID]?.currentIndex).toBe(1);
    });

    it('does not exceed last question index', () => {
      useAppStore.getState().setPendingUserQuestion(CONV_ID, makePending({
        questions: [makeQuestion(), makeQuestion({ header: 'Q2' })],
        currentIndex: 1, // Already at last
      }));
      useAppStore.getState().nextUserQuestion(CONV_ID);

      const state = useAppStore.getState();
      expect(state.pendingUserQuestion[CONV_ID]?.currentIndex).toBe(1);
    });

    it('is a no-op when no pending question exists', () => {
      useAppStore.getState().nextUserQuestion(CONV_ID);
      const state = useAppStore.getState();
      expect(state.pendingUserQuestion[CONV_ID]).toBeUndefined();
    });
  });

  // ==========================================================================
  // prevUserQuestion
  // ==========================================================================

  describe('prevUserQuestion', () => {
    it('decrements currentIndex', () => {
      useAppStore.getState().setPendingUserQuestion(CONV_ID, makePending({
        questions: [makeQuestion(), makeQuestion({ header: 'Q2' })],
        currentIndex: 1,
      }));
      useAppStore.getState().prevUserQuestion(CONV_ID);

      const state = useAppStore.getState();
      expect(state.pendingUserQuestion[CONV_ID]?.currentIndex).toBe(0);
    });

    it('does not go below 0', () => {
      useAppStore.getState().setPendingUserQuestion(CONV_ID, makePending({
        currentIndex: 0,
      }));
      useAppStore.getState().prevUserQuestion(CONV_ID);

      const state = useAppStore.getState();
      expect(state.pendingUserQuestion[CONV_ID]?.currentIndex).toBe(0);
    });

    it('is a no-op when no pending question exists', () => {
      useAppStore.getState().prevUserQuestion(CONV_ID);
      const state = useAppStore.getState();
      expect(state.pendingUserQuestion[CONV_ID]).toBeUndefined();
    });
  });

  // ==========================================================================
  // clearPendingUserQuestion
  // ==========================================================================

  describe('clearPendingUserQuestion', () => {
    it('sets pending question to null', () => {
      useAppStore.getState().setPendingUserQuestion(CONV_ID, makePending());
      useAppStore.getState().clearPendingUserQuestion(CONV_ID);

      const state = useAppStore.getState();
      expect(state.pendingUserQuestion[CONV_ID]).toBeNull();
    });

    it('does not affect other conversations', () => {
      useAppStore.getState().setPendingUserQuestion(CONV_ID, makePending({ requestId: 'req-1' }));
      useAppStore.getState().setPendingUserQuestion(CONV_ID_2, makePending({ requestId: 'req-2' }));
      useAppStore.getState().clearPendingUserQuestion(CONV_ID);

      const state = useAppStore.getState();
      expect(state.pendingUserQuestion[CONV_ID]).toBeNull();
      expect(state.pendingUserQuestion[CONV_ID_2]?.requestId).toBe('req-2');
    });
  });

  // ==========================================================================
  // Full wizard flow integration
  // ==========================================================================

  describe('full wizard flow', () => {
    it('supports complete 3-question wizard: answer, navigate, submit', () => {
      const q1 = makeQuestion({ header: 'Language', question: 'Pick language' });
      const q2 = makeQuestion({ header: 'Framework', question: 'Pick framework' });
      const q3 = makeQuestion({ header: 'Database', question: 'Pick database' });

      const store = useAppStore.getState();

      // Set up 3-question wizard
      store.setPendingUserQuestion(CONV_ID, makePending({
        questions: [q1, q2, q3],
      }));

      // Answer Q1, navigate to Q2
      store.toggleUserQuestionOption(CONV_ID, 'Language', 0, false);
      store.nextUserQuestion(CONV_ID);
      expect(useAppStore.getState().pendingUserQuestion[CONV_ID]?.currentIndex).toBe(1);

      // Answer Q2, navigate to Q3
      store.toggleUserQuestionOption(CONV_ID, 'Framework', 1, false);
      store.nextUserQuestion(CONV_ID);
      expect(useAppStore.getState().pendingUserQuestion[CONV_ID]?.currentIndex).toBe(2);

      // Answer Q3
      store.toggleUserQuestionOption(CONV_ID, 'Database', 2, false);

      // Verify all selections preserved
      const pending = useAppStore.getState().pendingUserQuestion[CONV_ID];
      expect(pending?.selectedIndices).toEqual({
        Language: [0],
        Framework: [1],
        Database: [2],
      });

      // Navigate back — selections still preserved
      store.prevUserQuestion(CONV_ID);
      store.prevUserQuestion(CONV_ID);
      expect(useAppStore.getState().pendingUserQuestion[CONV_ID]?.currentIndex).toBe(0);
      expect(useAppStore.getState().pendingUserQuestion[CONV_ID]?.selectedIndices).toEqual({
        Language: [0],
        Framework: [1],
        Database: [2],
      });

      // Clear
      store.clearPendingUserQuestion(CONV_ID);
      expect(useAppStore.getState().pendingUserQuestion[CONV_ID]).toBeNull();
    });
  });
});
