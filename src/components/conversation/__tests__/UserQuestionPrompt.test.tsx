import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { act } from 'react';
import userEvent from '@testing-library/user-event';
import { UserQuestionPrompt } from '../UserQuestionPrompt';
import { useAppStore } from '@/stores/appStore';
import type { PendingUserQuestion, UserQuestion } from '@/lib/types';

// Mock the API module
vi.mock('@/lib/api', () => ({
  answerConversationQuestion: vi.fn().mockResolvedValue(undefined),
}));

// Mock toast
vi.mock('@/components/ui/toast', () => ({
  useToast: () => ({
    error: vi.fn(),
    success: vi.fn(),
  }),
}));

import { answerConversationQuestion } from '@/lib/api';

const CONV_ID = 'conv-test-1';

function makeQuestion(overrides: Partial<UserQuestion> = {}): UserQuestion {
  return {
    question: 'Which framework do you prefer?',
    header: 'Framework',
    options: [
      { label: 'React', description: 'A JavaScript library for building UIs' },
      { label: 'Vue', description: 'The progressive framework' },
      { label: 'Svelte', description: 'Cybernetically enhanced web apps' },
      { label: 'Angular', description: 'Platform for building mobile and desktop apps' },
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

function setPending(pending: PendingUserQuestion | null) {
  useAppStore.setState({
    pendingUserQuestion: { [CONV_ID]: pending },
  });
}

describe('UserQuestionPrompt', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.setState({ pendingUserQuestion: {} });
  });

  // ==========================================================================
  // Rendering
  // ==========================================================================

  describe('rendering', () => {
    it('renders nothing when no pending question exists', () => {
      const { container } = render(<UserQuestionPrompt conversationId={CONV_ID} />);
      expect(container.innerHTML).toBe('');
    });

    it('renders nothing when pending is null', () => {
      setPending(null);
      const { container } = render(<UserQuestionPrompt conversationId={CONV_ID} />);
      expect(container.innerHTML).toBe('');
    });

    it('renders the question text', () => {
      setPending(makePending());
      render(<UserQuestionPrompt conversationId={CONV_ID} />);
      expect(screen.getByText('Which framework do you prefer?')).toBeInTheDocument();
    });

    it('renders all option labels', () => {
      setPending(makePending());
      render(<UserQuestionPrompt conversationId={CONV_ID} />);
      expect(screen.getByText('React')).toBeInTheDocument();
      expect(screen.getByText('Vue')).toBeInTheDocument();
      expect(screen.getByText('Svelte')).toBeInTheDocument();
      expect(screen.getByText('Angular')).toBeInTheDocument();
    });

    it('renders option descriptions', () => {
      setPending(makePending());
      render(<UserQuestionPrompt conversationId={CONV_ID} />);
      expect(screen.getByText('A JavaScript library for building UIs')).toBeInTheDocument();
      expect(screen.getByText('The progressive framework')).toBeInTheDocument();
    });

    it('renders options without descriptions cleanly', () => {
      setPending(makePending({
        questions: [makeQuestion({
          options: [
            { label: 'Yes', description: '' },
            { label: 'No', description: '' },
          ],
        })],
      }));
      render(<UserQuestionPrompt conversationId={CONV_ID} />);
      expect(screen.getByText('Yes')).toBeInTheDocument();
      expect(screen.getByText('No')).toBeInTheDocument();
    });

    it('renders option numbers (1-indexed)', () => {
      setPending(makePending());
      render(<UserQuestionPrompt conversationId={CONV_ID} />);
      expect(screen.getByText('1')).toBeInTheDocument();
      expect(screen.getByText('2')).toBeInTheDocument();
      expect(screen.getByText('3')).toBeInTheDocument();
      expect(screen.getByText('4')).toBeInTheDocument();
    });
  });

  // ==========================================================================
  // Single Select
  // ==========================================================================

  describe('single select', () => {
    it('selects an option on click', async () => {
      const user = userEvent.setup();
      setPending(makePending());
      render(<UserQuestionPrompt conversationId={CONV_ID} />);

      await user.click(screen.getByText('Vue'));

      const state = useAppStore.getState();
      const pending = state.pendingUserQuestion[CONV_ID];
      expect(pending?.answers['Framework']).toBe('Vue');
    });

    it('replaces selection on single-select (not appends)', async () => {
      const user = userEvent.setup();
      setPending(makePending());
      render(<UserQuestionPrompt conversationId={CONV_ID} />);

      await user.click(screen.getByText('React'));
      await user.click(screen.getByText('Vue'));

      const state = useAppStore.getState();
      const pending = state.pendingUserQuestion[CONV_ID];
      expect(pending?.answers['Framework']).toBe('Vue');
    });
  });

  // ==========================================================================
  // Multi Select
  // ==========================================================================

  describe('multi select', () => {
    it('allows selecting multiple options', async () => {
      const user = userEvent.setup();
      setPending(makePending({
        questions: [makeQuestion({ multiSelect: true })],
      }));
      render(<UserQuestionPrompt conversationId={CONV_ID} />);

      await user.click(screen.getByText('React'));
      await user.click(screen.getByText('Svelte'));

      const state = useAppStore.getState();
      const pending = state.pendingUserQuestion[CONV_ID];
      const answer = pending?.answers['Framework'] ?? '';
      // Comma-separated, both present
      expect(answer.split(',')).toContain('React');
      expect(answer.split(',')).toContain('Svelte');
    });

    it('toggles off a selected option on re-click', async () => {
      const user = userEvent.setup();
      setPending(makePending({
        questions: [makeQuestion({ multiSelect: true })],
      }));
      render(<UserQuestionPrompt conversationId={CONV_ID} />);

      await user.click(screen.getByText('React'));
      await user.click(screen.getByText('Svelte'));
      // Deselect React
      await user.click(screen.getByText('React'));

      const state = useAppStore.getState();
      const pending = state.pendingUserQuestion[CONV_ID];
      expect(pending?.answers['Framework']).toBe('Svelte');
    });
  });

  // ==========================================================================
  // Submit
  // ==========================================================================

  describe('submit', () => {
    it('submit button is disabled when no answer selected', () => {
      setPending(makePending());
      render(<UserQuestionPrompt conversationId={CONV_ID} />);

      expect(screen.getByTestId('submit-question')).toBeDisabled();
    });

    it('submit button becomes enabled after selecting an answer', async () => {
      const user = userEvent.setup();
      setPending(makePending());
      render(<UserQuestionPrompt conversationId={CONV_ID} />);

      await user.click(screen.getByText('React'));

      expect(screen.getByTestId('submit-question')).not.toBeDisabled();
    });

    it('calls answerConversationQuestion with correct args on submit', async () => {
      const user = userEvent.setup();
      setPending(makePending());
      render(<UserQuestionPrompt conversationId={CONV_ID} />);

      await user.click(screen.getByText('Vue'));

      await user.click(screen.getByTestId('submit-question'));

      expect(answerConversationQuestion).toHaveBeenCalledWith(
        CONV_ID,
        'req-1',
        { Framework: 'Vue' },
      );
    });

    it('clears pending question after successful submit', async () => {
      const user = userEvent.setup();
      setPending(makePending());
      render(<UserQuestionPrompt conversationId={CONV_ID} />);

      await user.click(screen.getByText('React'));

      await user.click(screen.getByTestId('submit-question'));

      const state = useAppStore.getState();
      expect(state.pendingUserQuestion[CONV_ID]).toBeNull();
    });
  });

  // ==========================================================================
  // Cancel / Dismiss
  // ==========================================================================

  describe('cancel', () => {
    it('sends __cancelled on dismiss click', async () => {
      const user = userEvent.setup();
      setPending(makePending());
      render(<UserQuestionPrompt conversationId={CONV_ID} />);

      await user.click(screen.getByTestId('dismiss-question'));

      expect(answerConversationQuestion).toHaveBeenCalledWith(
        CONV_ID,
        'req-1',
        { __cancelled: 'true' },
      );
    });

    it('clears pending question after dismiss', async () => {
      const user = userEvent.setup();
      setPending(makePending());
      render(<UserQuestionPrompt conversationId={CONV_ID} />);

      await user.click(screen.getByTestId('dismiss-question'));

      const state = useAppStore.getState();
      expect(state.pendingUserQuestion[CONV_ID]).toBeNull();
    });

    it('swallows API errors on dismiss gracefully', async () => {
      vi.mocked(answerConversationQuestion).mockRejectedValueOnce(new Error('Network error'));
      const user = userEvent.setup();
      setPending(makePending());
      render(<UserQuestionPrompt conversationId={CONV_ID} />);

      // Should not throw
      await user.click(screen.getByTestId('dismiss-question'));

      // Still clears UI despite API error
      const state = useAppStore.getState();
      expect(state.pendingUserQuestion[CONV_ID]).toBeNull();
    });
  });

  // ==========================================================================
  // Multi-Question Wizard Navigation
  // ==========================================================================

  describe('multi-question wizard', () => {
    const q1 = makeQuestion({ question: 'Pick a framework', header: 'Framework' });
    const q2 = makeQuestion({
      question: 'Pick a database',
      header: 'Database',
      options: [
        { label: 'PostgreSQL', description: 'Relational' },
        { label: 'MongoDB', description: 'Document' },
      ],
    });
    const q3 = makeQuestion({
      question: 'Pick a hosting provider',
      header: 'Hosting',
      options: [
        { label: 'Vercel', description: 'Frontend cloud' },
        { label: 'AWS', description: 'Amazon Web Services' },
      ],
    });

    function makeMultiPending() {
      return makePending({ questions: [q1, q2, q3] });
    }

    it('shows pagination dots for multi-question wizard', () => {
      setPending(makeMultiPending());
      render(<UserQuestionPrompt conversationId={CONV_ID} />);
      // "1 of 3" text
      expect(screen.getByText('1 of 3')).toBeInTheDocument();
    });

    it('shows first question initially', () => {
      setPending(makeMultiPending());
      render(<UserQuestionPrompt conversationId={CONV_ID} />);
      expect(screen.getByText('Pick a framework')).toBeInTheDocument();
    });

    it('does not show pagination for single question', () => {
      setPending(makePending());
      render(<UserQuestionPrompt conversationId={CONV_ID} />);
      expect(screen.queryByText(/of/)).not.toBeInTheDocument();
    });

    it('navigates to next question', async () => {
      const user = userEvent.setup();
      setPending(makeMultiPending());
      render(<UserQuestionPrompt conversationId={CONV_ID} />);

      // Answer Q1 first
      await user.click(screen.getByText('React'));

      // Navigate via store (simulates clicking next)
      act(() => {
        useAppStore.getState().nextUserQuestion(CONV_ID);
      });

      const state = useAppStore.getState();
      expect(state.pendingUserQuestion[CONV_ID]?.currentIndex).toBe(1);
    });

    it('preserves answers when navigating back', async () => {
      // Set up: Q1 answered, currently on Q2
      setPending(makeMultiPending());
      const store = useAppStore.getState();
      store.updateUserQuestionAnswer(CONV_ID, 'Framework', 'React');
      store.nextUserQuestion(CONV_ID);
      store.updateUserQuestionAnswer(CONV_ID, 'Database', 'PostgreSQL');
      store.prevUserQuestion(CONV_ID);

      const state = useAppStore.getState();
      const pending = state.pendingUserQuestion[CONV_ID];
      expect(pending?.currentIndex).toBe(0);
      expect(pending?.answers['Framework']).toBe('React');
      expect(pending?.answers['Database']).toBe('PostgreSQL');
    });

    it('submit is disabled until all questions are answered', () => {
      // Only answer Q1
      setPending(makeMultiPending());
      useAppStore.getState().updateUserQuestionAnswer(CONV_ID, 'Framework', 'React');

      render(<UserQuestionPrompt conversationId={CONV_ID} />);

      expect(screen.getByTestId('submit-question')).toBeDisabled();
    });

    it('submit is enabled when all questions are answered', () => {
      setPending(makeMultiPending());
      const store = useAppStore.getState();
      store.updateUserQuestionAnswer(CONV_ID, 'Framework', 'React');
      store.updateUserQuestionAnswer(CONV_ID, 'Database', 'PostgreSQL');
      store.updateUserQuestionAnswer(CONV_ID, 'Hosting', 'Vercel');

      render(<UserQuestionPrompt conversationId={CONV_ID} />);

      expect(screen.getByTestId('submit-question')).not.toBeDisabled();
    });

    it('sends all answers in a single submit call', async () => {
      const user = userEvent.setup();
      setPending(makeMultiPending());
      const store = useAppStore.getState();
      store.updateUserQuestionAnswer(CONV_ID, 'Framework', 'React');
      store.updateUserQuestionAnswer(CONV_ID, 'Database', 'PostgreSQL');
      store.updateUserQuestionAnswer(CONV_ID, 'Hosting', 'Vercel');

      render(<UserQuestionPrompt conversationId={CONV_ID} />);

      await user.click(screen.getByTestId('submit-question'));

      expect(answerConversationQuestion).toHaveBeenCalledWith(
        CONV_ID,
        'req-1',
        {
          Framework: 'React',
          Database: 'PostgreSQL',
          Hosting: 'Vercel',
        },
      );
    });
  });

  // ==========================================================================
  // Concurrent Question Handling
  // ==========================================================================

  describe('concurrent questions', () => {
    it('replacing pending question overwrites the previous one', () => {
      setPending(makePending({ requestId: 'req-1' }));
      useAppStore.getState().updateUserQuestionAnswer(CONV_ID, 'Framework', 'React');

      // Second question replaces first
      setPending(makePending({
        requestId: 'req-2',
        questions: [makeQuestion({ question: 'New question', header: 'New' })],
      }));

      const state = useAppStore.getState();
      const pending = state.pendingUserQuestion[CONV_ID];
      expect(pending?.requestId).toBe('req-2');
      expect(pending?.answers).toEqual({});
    });
  });
});
