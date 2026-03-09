import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
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

    it('renders the question text with base font size', () => {
      setPending(makePending());
      render(<UserQuestionPrompt conversationId={CONV_ID} />);
      const questionEl = screen.getByText('Which framework do you prefer?');
      expect(questionEl).toBeInTheDocument();
      expect(questionEl.className).toContain('text-base');
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

    it('renders number badges for each option in single-select (1-indexed)', () => {
      setPending(makePending());
      render(<UserQuestionPrompt conversationId={CONV_ID} />);
      expect(screen.getByText('1')).toBeInTheDocument();
      expect(screen.getByText('2')).toBeInTheDocument();
      expect(screen.getByText('3')).toBeInTheDocument();
      expect(screen.getByText('4')).toBeInTheDocument();
    });

    it('renders checkboxes instead of numbers for multi-select', () => {
      setPending(makePending({
        questions: [makeQuestion({ multiSelect: true })],
      }));
      render(<UserQuestionPrompt conversationId={CONV_ID} />);
      // Should NOT have number badges
      expect(screen.queryByText('1')).not.toBeInTheDocument();
      expect(screen.queryByText('2')).not.toBeInTheDocument();
    });

    it('renders the "Other" option as "Something else"', () => {
      setPending(makePending());
      render(<UserQuestionPrompt conversationId={CONV_ID} />);
      expect(screen.getByTestId('other-option')).toBeInTheDocument();
      expect(screen.getByText('Something else')).toBeInTheDocument();
    });

    it('does not render "Other" for free-text-only questions', () => {
      setPending(makePending({
        questions: [makeQuestion({ options: [] })],
      }));
      render(<UserQuestionPrompt conversationId={CONV_ID} />);
      expect(screen.queryByTestId('other-option')).not.toBeInTheDocument();
    });

    it('renders Skip button and X dismiss button', () => {
      setPending(makePending());
      render(<UserQuestionPrompt conversationId={CONV_ID} />);
      expect(screen.getByTestId('skip-question')).toBeInTheDocument();
      expect(screen.getByText('Skip')).toBeInTheDocument();
      expect(screen.getByTestId('dismiss-question')).toBeInTheDocument();
    });

    it('renders question counter in header for multi-question wizard', () => {
      const q1 = makeQuestion({ question: 'Q1', header: 'H1' });
      const q2 = makeQuestion({ question: 'Q2', header: 'H2', options: [{ label: 'A', description: '' }] });
      setPending(makePending({ questions: [q1, q2] }));
      render(<UserQuestionPrompt conversationId={CONV_ID} />);
      expect(screen.getByTestId('question-counter')).toHaveTextContent('1 of 2');
    });

    it('does not render question counter for single question', () => {
      setPending(makePending());
      render(<UserQuestionPrompt conversationId={CONV_ID} />);
      expect(screen.queryByTestId('question-counter')).not.toBeInTheDocument();
    });
  });

  // ==========================================================================
  // Single Select
  // ==========================================================================

  describe('single select', () => {
    it('auto-submits on single-select click after brief delay', async () => {
      const user = userEvent.setup();
      setPending(makePending());
      render(<UserQuestionPrompt conversationId={CONV_ID} />);

      await user.click(screen.getByText('Vue'));

      // Answer should be in store immediately
      expect(useAppStore.getState().pendingUserQuestion[CONV_ID]?.answers['Framework']).toBe('Vue');

      // Auto-submit fires after the 200ms delay
      await waitFor(() => {
        expect(answerConversationQuestion).toHaveBeenCalledWith(
          CONV_ID,
          'req-1',
          { Framework: 'Vue' },
        );
      });
      await waitFor(() => {
        expect(useAppStore.getState().pendingUserQuestion[CONV_ID]).toBeNull();
      });
    });

    it('auto-advances to next question in wizard on single-select click', async () => {
      const user = userEvent.setup();
      const q1 = makeQuestion({ question: 'Pick a framework', header: 'Framework' });
      const q2 = makeQuestion({
        question: 'Pick a database',
        header: 'Database',
        options: [
          { label: 'PostgreSQL', description: 'Relational' },
          { label: 'MongoDB', description: 'Document' },
        ],
      });
      setPending(makePending({ questions: [q1, q2] }));
      render(<UserQuestionPrompt conversationId={CONV_ID} />);

      await user.click(screen.getByText('React'));

      await waitFor(() => {
        expect(useAppStore.getState().pendingUserQuestion[CONV_ID]?.currentIndex).toBe(1);
      });
      expect(answerConversationQuestion).not.toHaveBeenCalled();
      expect(useAppStore.getState().pendingUserQuestion[CONV_ID]?.answers['Framework']).toBe('React');
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
    it('submit button is disabled when no answer selected (multi-select)', () => {
      setPending(makePending({ questions: [makeQuestion({ multiSelect: true })] }));
      render(<UserQuestionPrompt conversationId={CONV_ID} />);

      expect(screen.getByTestId('submit-question')).toBeDisabled();
    });

    it('submit button becomes enabled after selecting an answer (multi-select)', async () => {
      const user = userEvent.setup();
      setPending(makePending({ questions: [makeQuestion({ multiSelect: true })] }));
      render(<UserQuestionPrompt conversationId={CONV_ID} />);

      await user.click(screen.getByText('React'));

      expect(screen.getByTestId('submit-question')).not.toBeDisabled();
    });

    it('calls answerConversationQuestion with correct args on submit (multi-select)', async () => {
      const user = userEvent.setup();
      setPending(makePending({ questions: [makeQuestion({ multiSelect: true })] }));
      render(<UserQuestionPrompt conversationId={CONV_ID} />);

      await user.click(screen.getByText('Vue'));
      await user.click(screen.getByTestId('submit-question'));

      expect(answerConversationQuestion).toHaveBeenCalledWith(
        CONV_ID,
        'req-1',
        { Framework: 'Vue' },
      );
    });

    it('clears pending question after successful submit (multi-select)', async () => {
      const user = userEvent.setup();
      setPending(makePending({ questions: [makeQuestion({ multiSelect: true })] }));
      render(<UserQuestionPrompt conversationId={CONV_ID} />);

      await user.click(screen.getByText('React'));
      await user.click(screen.getByTestId('submit-question'));

      const state = useAppStore.getState();
      expect(state.pendingUserQuestion[CONV_ID]).toBeNull();
    });
  });

  // ==========================================================================
  // Cancel / Skip
  // ==========================================================================

  describe('skip', () => {
    it('sends __cancelled on Skip click', async () => {
      const user = userEvent.setup();
      setPending(makePending());
      render(<UserQuestionPrompt conversationId={CONV_ID} />);

      await user.click(screen.getByTestId('skip-question'));

      expect(answerConversationQuestion).toHaveBeenCalledWith(
        CONV_ID,
        'req-1',
        { __cancelled: 'true' },
      );
    });

    it('clears pending question after skip', async () => {
      const user = userEvent.setup();
      setPending(makePending());
      render(<UserQuestionPrompt conversationId={CONV_ID} />);

      await user.click(screen.getByTestId('skip-question'));

      const state = useAppStore.getState();
      expect(state.pendingUserQuestion[CONV_ID]).toBeNull();
    });

    it('swallows API errors on skip gracefully', async () => {
      vi.mocked(answerConversationQuestion).mockRejectedValueOnce(new Error('Network error'));
      const user = userEvent.setup();
      setPending(makePending());
      render(<UserQuestionPrompt conversationId={CONV_ID} />);

      await user.click(screen.getByTestId('skip-question'));

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
      expect(screen.getByTestId('question-counter')).toHaveTextContent('1 of 3');
    });

    it('shows first question initially', () => {
      setPending(makeMultiPending());
      render(<UserQuestionPrompt conversationId={CONV_ID} />);
      expect(screen.getByText('Pick a framework')).toBeInTheDocument();
    });

    it('does not show question counter for single question', () => {
      setPending(makePending());
      render(<UserQuestionPrompt conversationId={CONV_ID} />);
      expect(screen.queryByTestId('question-counter')).not.toBeInTheDocument();
    });

    it('auto-advances to next question on single-select click', async () => {
      const user = userEvent.setup();
      setPending(makeMultiPending());
      render(<UserQuestionPrompt conversationId={CONV_ID} />);

      await user.click(screen.getByText('React'));

      await waitFor(() => {
        expect(useAppStore.getState().pendingUserQuestion[CONV_ID]?.currentIndex).toBe(1);
      });
    });

    it('preserves answers when navigating back', async () => {
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

    it('footer button acts as next when current question answered but not all', () => {
      setPending(makeMultiPending());
      useAppStore.getState().updateUserQuestionAnswer(CONV_ID, 'Framework', 'React');

      render(<UserQuestionPrompt conversationId={CONV_ID} />);

      // Button should be enabled (acts as "Next", not "Submit")
      const button = screen.getByTestId('submit-question');
      expect(button).not.toBeDisabled();

      // Clicking it should advance to next question
      fireEvent.click(button);
      const pending = useAppStore.getState().pendingUserQuestion[CONV_ID];
      expect(pending?.currentIndex).toBe(1);
    });

    it('footer button is disabled when current question has no answer', () => {
      setPending(makeMultiPending());

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

    it('allows clicking options after auto-advancing to next question', async () => {
      const user = userEvent.setup();
      setPending(makeMultiPending());
      render(<UserQuestionPrompt conversationId={CONV_ID} />);

      await user.click(screen.getByText('React'));

      await waitFor(() => {
        expect(screen.getByText('Pick a database')).toBeInTheDocument();
      });

      await user.click(screen.getByText('PostgreSQL'));

      await waitFor(() => {
        const state = useAppStore.getState();
        const pending = state.pendingUserQuestion[CONV_ID];
        expect(pending?.answers['Database']).toBe('PostgreSQL');
        expect(pending?.answers['Framework']).toBe('React');
      });
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
  // "Other" (Custom Text) Option
  // ==========================================================================

  describe('Other option', () => {
    it('shows text input when "Other" is selected (single-select)', async () => {
      const user = userEvent.setup();
      setPending(makePending());
      render(<UserQuestionPrompt conversationId={CONV_ID} />);

      await user.click(screen.getByTestId('other-option'));

      expect(screen.getByTestId('other-text-input')).toBeInTheDocument();
    });

    it('does NOT auto-submit when "Other" is selected (single-select)', async () => {
      const user = userEvent.setup();
      setPending(makePending());
      render(<UserQuestionPrompt conversationId={CONV_ID} />);

      await user.click(screen.getByTestId('other-option'));

      // "Other" click never starts the auto-submit timer, so verify immediately
      expect(answerConversationQuestion).not.toHaveBeenCalled();
      expect(screen.getByTestId('other-text-input')).toBeInTheDocument();
    });

    it('submits typed text as the answer via submit button', async () => {
      const user = userEvent.setup();
      setPending(makePending());
      render(<UserQuestionPrompt conversationId={CONV_ID} />);

      await user.click(screen.getByTestId('other-option'));
      await user.type(screen.getByTestId('other-text-input'), 'Solid.js');
      await user.click(screen.getByTestId('submit-question'));

      expect(answerConversationQuestion).toHaveBeenCalledWith(
        CONV_ID,
        'req-1',
        { Framework: 'Solid.js' },
      );
    });

    it('submits typed text on Enter key', async () => {
      const user = userEvent.setup();
      setPending(makePending());
      render(<UserQuestionPrompt conversationId={CONV_ID} />);

      await user.click(screen.getByTestId('other-option'));
      await user.type(screen.getByTestId('other-text-input'), 'Solid.js{Enter}');

      expect(answerConversationQuestion).toHaveBeenCalledWith(
        CONV_ID,
        'req-1',
        { Framework: 'Solid.js' },
      );
    });

    it('clears "Other" when a regular option is clicked (single-select)', async () => {
      const user = userEvent.setup();
      setPending(makePending());
      render(<UserQuestionPrompt conversationId={CONV_ID} />);

      await user.click(screen.getByTestId('other-option'));
      expect(screen.getByTestId('other-text-input')).toBeInTheDocument();

      await user.click(screen.getByText('React'));

      expect(screen.queryByTestId('other-text-input')).not.toBeInTheDocument();
    });

    it('submit is disabled when "Other" is selected but no text typed', async () => {
      const user = userEvent.setup();
      setPending(makePending());
      render(<UserQuestionPrompt conversationId={CONV_ID} />);

      await user.click(screen.getByTestId('other-option'));

      expect(screen.getByTestId('submit-question')).toBeDisabled();
    });

    it('works alongside regular selections in multi-select', async () => {
      const user = userEvent.setup();
      setPending(makePending({
        questions: [makeQuestion({ multiSelect: true })],
      }));
      render(<UserQuestionPrompt conversationId={CONV_ID} />);

      await user.click(screen.getByText('React'));
      await user.click(screen.getByTestId('other-option'));
      await user.type(screen.getByTestId('other-text-input'), 'Solid.js');
      await user.click(screen.getByTestId('submit-question'));

      const calledWith = vi.mocked(answerConversationQuestion).mock.calls[0][2];
      const values = calledWith['Framework'].split(',');
      expect(values).toContain('React');
      expect(values).toContain('Solid.js');
    });

    it('toggles "Other" off in multi-select mode', async () => {
      const user = userEvent.setup();
      setPending(makePending({
        questions: [makeQuestion({ multiSelect: true })],
      }));
      render(<UserQuestionPrompt conversationId={CONV_ID} />);

      await user.click(screen.getByText('React'));
      await user.click(screen.getByTestId('other-option'));
      expect(screen.getByTestId('other-text-input')).toBeInTheDocument();

      await user.click(screen.getByTestId('other-option'));
      expect(screen.queryByTestId('other-text-input')).not.toBeInTheDocument();

      const state = useAppStore.getState();
      expect(state.pendingUserQuestion[CONV_ID]?.answers['Framework']).toBe('React');
    });

    it('cancels pending auto-submit when "Other" is clicked after a regular option', async () => {
      const user = userEvent.setup();
      setPending(makePending());
      render(<UserQuestionPrompt conversationId={CONV_ID} />);

      // Click a regular option (starts 200ms auto-submit timer)
      await user.click(screen.getByText('Vue'));
      // Immediately click "Other" before the timer fires
      await user.click(screen.getByTestId('other-option'));

      // Wait past the would-be auto-submit delay (200ms) to ensure it was cancelled
      await waitFor(() => {
        expect(screen.getByTestId('other-text-input')).toBeInTheDocument();
      });
      // Give extra time for the cancelled timer to have fired if it wasn't cancelled
      await new Promise(r => setTimeout(r, 250));

      // Auto-submit should NOT have fired because "Other" cancelled it
      expect(answerConversationQuestion).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // Keyboard Shortcuts
  // ==========================================================================

  describe('keyboard shortcuts', () => {
    it('pressing a number key selects the corresponding option', async () => {
      setPending(makePending());
      render(<UserQuestionPrompt conversationId={CONV_ID} />);

      fireEvent.keyDown(document, { key: '2' });

      // Should select "Vue" (option 2)
      expect(useAppStore.getState().pendingUserQuestion[CONV_ID]?.answers['Framework']).toBe('Vue');
    });

    it('pressing the "Other" number key activates Other mode', async () => {
      setPending(makePending()); // 4 options → Other is 5
      render(<UserQuestionPrompt conversationId={CONV_ID} />);

      fireEvent.keyDown(document, { key: '5' });

      expect(screen.getByTestId('other-text-input')).toBeInTheDocument();
    });

    it('does not intercept number keys when typing in an input', async () => {
      const user = userEvent.setup();
      setPending(makePending());
      render(<UserQuestionPrompt conversationId={CONV_ID} />);

      // Activate "Other" to get a text input
      await user.click(screen.getByTestId('other-option'));
      const input = screen.getByTestId('other-text-input');

      // Type "123" into the input — should not trigger option selection
      await user.type(input, '123');

      expect(input).toHaveValue('123');
      // Should NOT have selected options 1, 2, 3
      const store = useAppStore.getState();
      expect(store.pendingUserQuestion[CONV_ID]?.answers['Framework']).toBe('123');
    });

    it('ignores number keys out of range', () => {
      setPending(makePending()); // 4 options + Other = 5, so 6-9 are out of range
      render(<UserQuestionPrompt conversationId={CONV_ID} />);

      fireEvent.keyDown(document, { key: '9' });

      // No answer should be set
      expect(useAppStore.getState().pendingUserQuestion[CONV_ID]?.answers['Framework']).toBeUndefined();
    });

    it('selects option via number key in multi-select mode', () => {
      setPending(makePending({
        questions: [makeQuestion({ multiSelect: true })],
      }));
      render(<UserQuestionPrompt conversationId={CONV_ID} />);

      fireEvent.keyDown(document, { key: '1' });
      fireEvent.keyDown(document, { key: '3' });

      const answer = useAppStore.getState().pendingUserQuestion[CONV_ID]?.answers['Framework'] ?? '';
      expect(answer.split(',')).toContain('React');
      expect(answer.split(',')).toContain('Svelte');
    });
  });

  // ==========================================================================
  // Concurrent Question Handling
  // ==========================================================================

  describe('concurrent questions', () => {
    it('replacing pending question overwrites the previous one', () => {
      setPending(makePending({ requestId: 'req-1' }));
      useAppStore.getState().updateUserQuestionAnswer(CONV_ID, 'Framework', 'React');

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
