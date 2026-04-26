import { describe, it, expect } from 'vitest';
import type { PendingUserQuestion, UserQuestion } from '@/lib/types';
import { isUserQuestionAnswered, serializeUserQuestionAnswers } from '@/lib/userQuestion';

function makeQuestion(overrides: Partial<UserQuestion> = {}): UserQuestion {
  return {
    question: 'Pick one',
    header: 'H',
    options: [
      { label: 'A', description: '' },
      { label: 'B', description: '' },
      { label: 'C', description: '' },
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

describe('serializeUserQuestionAnswers', () => {
  it('emits the picked label for a single-select option', () => {
    const out = serializeUserQuestionAnswers(makePending({
      selectedIndices: { H: [1] },
    }));
    expect(out).toEqual({ H: 'B' });
  });

  it('joins multi-select labels with plain "," (no space)', () => {
    const out = serializeUserQuestionAnswers(makePending({
      questions: [makeQuestion({ multiSelect: true })],
      selectedIndices: { H: [0, 2] },
    }));
    expect(out).toEqual({ H: 'A,C' });
  });

  it('appends Other text when selected and non-empty', () => {
    const out = serializeUserQuestionAnswers(makePending({
      questions: [makeQuestion({ multiSelect: true })],
      selectedIndices: { H: [0] },
      otherSelected: { H: true },
      otherText: { H: 'custom' },
    }));
    expect(out).toEqual({ H: 'A,custom' });
  });

  it('skips Other when selected but empty', () => {
    const out = serializeUserQuestionAnswers(makePending({
      selectedIndices: { H: [0] },
      otherSelected: { H: true },
      otherText: { H: '' },
    }));
    expect(out).toEqual({ H: 'A' });
  });

  it('skips Other when text is present but otherSelected is false', () => {
    const out = serializeUserQuestionAnswers(makePending({
      selectedIndices: { H: [0] },
      otherSelected: {},
      otherText: { H: 'leftover' },
    }));
    expect(out).toEqual({ H: 'A' });
  });

  it('emits free-text answer for free-text questions', () => {
    const out = serializeUserQuestionAnswers(makePending({
      questions: [makeQuestion({ options: [], header: 'Why' })],
      freeTextAnswer: { Why: 'because' },
    }));
    expect(out).toEqual({ Why: 'because' });
  });

  it('omits unanswered questions from the wire payload', () => {
    const out = serializeUserQuestionAnswers(makePending({
      questions: [makeQuestion({ header: 'H1' }), makeQuestion({ header: 'H2' })],
      selectedIndices: { H1: [0] },
    }));
    expect(out).toEqual({ H1: 'A' });
  });

  it('preserves comma-containing labels (with the documented wire-format caveat)', () => {
    // The internal state cleanly handles a comma-containing label;
    // the wire format is intentionally a display string, not round-trippable.
    const out = serializeUserQuestionAnswers(makePending({
      questions: [makeQuestion({
        multiSelect: true,
        options: [
          { label: 'Hello, world', description: '' },
          { label: 'B', description: '' },
        ],
      })],
      selectedIndices: { H: [0] },
    }));
    expect(out).toEqual({ H: 'Hello, world' });
  });
});

describe('isUserQuestionAnswered', () => {
  it('returns true when an option is picked', () => {
    const q = makeQuestion();
    expect(isUserQuestionAnswered(makePending({ selectedIndices: { H: [0] } }), q)).toBe(true);
  });

  it('returns true when Other is selected with non-empty text', () => {
    const q = makeQuestion();
    expect(isUserQuestionAnswered(makePending({
      otherSelected: { H: true },
      otherText: { H: 'x' },
    }), q)).toBe(true);
  });

  it('returns false when Other is selected but text is empty', () => {
    const q = makeQuestion();
    expect(isUserQuestionAnswered(makePending({
      otherSelected: { H: true },
      otherText: { H: '' },
    }), q)).toBe(false);
  });

  it('returns false when otherText is present but otherSelected is false', () => {
    const q = makeQuestion();
    expect(isUserQuestionAnswered(makePending({
      otherSelected: {},
      otherText: { H: 'leftover' },
    }), q)).toBe(false);
  });

  it('returns true for free-text question with non-empty answer', () => {
    const q = makeQuestion({ options: [], header: 'F' });
    expect(isUserQuestionAnswered(makePending({
      questions: [q],
      freeTextAnswer: { F: 'hi' },
    }), q)).toBe(true);
  });

  it('returns false for free-text question with empty answer', () => {
    const q = makeQuestion({ options: [], header: 'F' });
    expect(isUserQuestionAnswered(makePending({
      questions: [q],
      freeTextAnswer: { F: '' },
    }), q)).toBe(false);
  });
});
