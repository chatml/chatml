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
    answers: {},
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
  // updateUserQuestionAnswer
  // ==========================================================================

  describe('updateUserQuestionAnswer', () => {
    it('sets an answer for a question header', () => {
      useAppStore.getState().setPendingUserQuestion(CONV_ID, makePending());
      useAppStore.getState().updateUserQuestionAnswer(CONV_ID, 'Language', 'TypeScript');

      const state = useAppStore.getState();
      expect(state.pendingUserQuestion[CONV_ID]?.answers['Language']).toBe('TypeScript');
    });

    it('overwrites an existing answer', () => {
      useAppStore.getState().setPendingUserQuestion(CONV_ID, makePending());
      useAppStore.getState().updateUserQuestionAnswer(CONV_ID, 'Language', 'TypeScript');
      useAppStore.getState().updateUserQuestionAnswer(CONV_ID, 'Language', 'Python');

      const state = useAppStore.getState();
      expect(state.pendingUserQuestion[CONV_ID]?.answers['Language']).toBe('Python');
    });

    it('preserves other answers when updating one', () => {
      useAppStore.getState().setPendingUserQuestion(CONV_ID, makePending({
        questions: [
          makeQuestion({ header: 'Language' }),
          makeQuestion({ header: 'Database', question: 'Pick a DB' }),
        ],
      }));
      useAppStore.getState().updateUserQuestionAnswer(CONV_ID, 'Language', 'Go');
      useAppStore.getState().updateUserQuestionAnswer(CONV_ID, 'Database', 'Postgres');

      const state = useAppStore.getState();
      const answers = state.pendingUserQuestion[CONV_ID]?.answers;
      expect(answers?.['Language']).toBe('Go');
      expect(answers?.['Database']).toBe('Postgres');
    });

    it('is a no-op when no pending question exists', () => {
      useAppStore.getState().updateUserQuestionAnswer(CONV_ID, 'Language', 'Go');

      const state = useAppStore.getState();
      expect(state.pendingUserQuestion[CONV_ID]).toBeUndefined();
    });

    it('stores comma-separated values for multi-select', () => {
      useAppStore.getState().setPendingUserQuestion(CONV_ID, makePending({
        questions: [makeQuestion({ multiSelect: true })],
      }));
      useAppStore.getState().updateUserQuestionAnswer(CONV_ID, 'Language', 'TypeScript,Go');

      const state = useAppStore.getState();
      expect(state.pendingUserQuestion[CONV_ID]?.answers['Language']).toBe('TypeScript,Go');
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
      store.updateUserQuestionAnswer(CONV_ID, 'Language', 'TypeScript');
      store.nextUserQuestion(CONV_ID);
      expect(useAppStore.getState().pendingUserQuestion[CONV_ID]?.currentIndex).toBe(1);

      // Answer Q2, navigate to Q3
      store.updateUserQuestionAnswer(CONV_ID, 'Framework', 'React');
      store.nextUserQuestion(CONV_ID);
      expect(useAppStore.getState().pendingUserQuestion[CONV_ID]?.currentIndex).toBe(2);

      // Answer Q3
      store.updateUserQuestionAnswer(CONV_ID, 'Database', 'PostgreSQL');

      // Verify all answers preserved
      const pending = useAppStore.getState().pendingUserQuestion[CONV_ID];
      expect(pending?.answers).toEqual({
        Language: 'TypeScript',
        Framework: 'React',
        Database: 'PostgreSQL',
      });

      // Navigate back — answers still preserved
      store.prevUserQuestion(CONV_ID);
      store.prevUserQuestion(CONV_ID);
      expect(useAppStore.getState().pendingUserQuestion[CONV_ID]?.currentIndex).toBe(0);
      expect(useAppStore.getState().pendingUserQuestion[CONV_ID]?.answers).toEqual({
        Language: 'TypeScript',
        Framework: 'React',
        Database: 'PostgreSQL',
      });

      // Clear
      store.clearPendingUserQuestion(CONV_ID);
      expect(useAppStore.getState().pendingUserQuestion[CONV_ID]).toBeNull();
    });
  });
});
