'use client';

import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { usePendingUserQuestion, useUserQuestionActions } from '@/stores/selectors';
import { useAppStore } from '@/stores/appStore';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { ChevronLeft, ChevronRight, ArrowRight, Loader2, X, Pencil, Check } from 'lucide-react';
import { answerConversationQuestion } from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import type { UserQuestion } from '@/lib/types';

const OTHER_OPTION_LABEL = '__other__';

interface UserQuestionPromptProps {
  conversationId: string;
}

export function UserQuestionPrompt({ conversationId }: UserQuestionPromptProps) {
  const pending = usePendingUserQuestion(conversationId);
  const { updateUserQuestionAnswer, nextUserQuestion, prevUserQuestion, clearPendingUserQuestion } = useUserQuestionActions();
  const { error: showError } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [freeTextValue, setFreeTextValue] = useState('');
  const [otherSelected, setOtherSelected] = useState(false);
  const [otherTextValue, setOtherTextValue] = useState('');
  const autoSubmitTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const otherSelectedRef = useRef(otherSelected);
  otherSelectedRef.current = otherSelected;

  // Clear auto-submit timeout on unmount
  useEffect(() => {
    return () => {
      if (autoSubmitTimeoutRef.current) {
        clearTimeout(autoSubmitTimeoutRef.current);
      }
    };
  }, []);

  const currentQuestion: UserQuestion | undefined = pending?.questions[pending.currentIndex];
  const totalQuestions = pending?.questions.length ?? 0;
  const currentIndex = pending?.currentIndex ?? 0;

  // Get selected values for current question
  const selectedValues = useMemo(() => {
    if (!pending || !currentQuestion) return new Set<string>();
    const answer = pending.answers[currentQuestion.header];
    if (!answer) return new Set<string>();
    // For multi-select, answers are comma-separated
    return new Set(answer.split(',').filter(Boolean));
  }, [pending, currentQuestion]);

  const handleOptionToggle = useCallback((label: string) => {
    if (!currentQuestion || isSubmitting) return;

    // Handle "Other" option selection
    if (label === OTHER_OPTION_LABEL) {
      if (currentQuestion.multiSelect) {
        if (otherSelectedRef.current) {
          // Toggle off: remove custom text from answer
          setOtherSelected(false);
          setOtherTextValue('');
          const currentAnswer = useAppStore.getState().pendingUserQuestion[conversationId]?.answers[currentQuestion.header] || '';
          const optionLabels = new Set(currentQuestion.options.map(o => o.label));
          const regularOnly = currentAnswer.split(',').filter(v => v && optionLabels.has(v));
          updateUserQuestionAnswer(conversationId, currentQuestion.header, regularOnly.join(','));
        } else {
          setOtherSelected(true);
        }
      } else {
        // Single-select: select "Other", clear any regular selection
        setOtherSelected(true);
        setOtherTextValue('');
        updateUserQuestionAnswer(conversationId, currentQuestion.header, '');
        // Cancel any pending auto-submit from a previous regular option click
        if (autoSubmitTimeoutRef.current) {
          clearTimeout(autoSubmitTimeoutRef.current);
          autoSubmitTimeoutRef.current = null;
        }
      }
      return;
    }

    // Regular option clicked — clear "Other" state for single-select
    if (!currentQuestion.multiSelect && otherSelectedRef.current) {
      setOtherSelected(false);
      setOtherTextValue('');
    }

    if (currentQuestion.multiSelect) {
      // Read current answer directly from store to avoid stale closure
      const currentAnswer = useAppStore.getState().pendingUserQuestion[conversationId]?.answers[currentQuestion.header] || '';
      const currentSet = new Set(currentAnswer.split(',').filter(Boolean));
      if (currentSet.has(label)) {
        currentSet.delete(label);
      } else {
        currentSet.add(label);
      }
      updateUserQuestionAnswer(conversationId, currentQuestion.header, [...currentSet].join(','));
    } else {
      // Single select - replace and show selection briefly before auto-submit/advance
      updateUserQuestionAnswer(conversationId, currentQuestion.header, label);

      // Brief delay so user sees the selection highlight before advancing
      if (autoSubmitTimeoutRef.current) {
        clearTimeout(autoSubmitTimeoutRef.current);
      }
      const clickedIndex = useAppStore.getState().pendingUserQuestion[conversationId]?.currentIndex;
      autoSubmitTimeoutRef.current = setTimeout(() => {
        autoSubmitTimeoutRef.current = null;

        // Read fresh state to avoid stale closures
        const pendingState = useAppStore.getState().pendingUserQuestion[conversationId];
        if (!pendingState) return;

        // Bail if the user navigated away from this question before the timer fired
        if (pendingState.currentIndex !== clickedIndex) return;

        const freshTotal = pendingState.questions.length;
        const freshIndex = pendingState.currentIndex;
        const freshQuestion = pendingState.questions[freshIndex];
        if (!freshQuestion) return;

        const allAnswered = pendingState.questions.every((q) => {
          if (q.header === freshQuestion.header) return true; // this one is now answered
          const answer = pendingState.answers[q.header];
          return answer && answer.length > 0;
        });

        if (allAnswered && freshTotal <= 1) {
          // Only question — auto-submit with the updated answers
          const answers = { ...pendingState.answers, [freshQuestion.header]: label };
          setIsSubmitting(true);
          answerConversationQuestion(conversationId, pendingState.requestId, answers)
            .then(() => clearPendingUserQuestion(conversationId))
            .catch((error) => showError(error instanceof Error ? error.message : 'Failed to submit answer'))
            .finally(() => setIsSubmitting(false));
        } else if (freshIndex < freshTotal - 1) {
          // More questions in wizard — advance to next
          nextUserQuestion(conversationId);
        }
      }, 200);
    }
  }, [conversationId, currentQuestion, isSubmitting, updateUserQuestionAnswer, nextUserQuestion, clearPendingUserQuestion, showError]);

  const handleDismiss = useCallback(async () => {
    if (!pending || isSubmitting) return;
    // Send cancellation to the agent so it doesn't wait for timeout
    try {
      await answerConversationQuestion(conversationId, pending.requestId, { __cancelled: 'true' });
    } catch {
      // Ignore errors - the question may have already timed out
    }
    clearPendingUserQuestion(conversationId);
  }, [conversationId, pending, isSubmitting, clearPendingUserQuestion]);

  const handlePrev = useCallback(() => {
    prevUserQuestion(conversationId);
  }, [conversationId, prevUserQuestion]);

  const handleNext = useCallback(() => {
    nextUserQuestion(conversationId);
  }, [conversationId, nextUserQuestion]);

  const handleSubmit = useCallback(async () => {
    if (!pending || isSubmitting) return;

    setIsSubmitting(true);
    try {
      await answerConversationQuestion(conversationId, pending.requestId, pending.answers);
      clearPendingUserQuestion(conversationId);
    } catch (error) {
      showError(error instanceof Error ? error.message : 'Failed to submit answer');
    } finally {
      setIsSubmitting(false);
    }
  }, [conversationId, pending, isSubmitting, clearPendingUserQuestion, showError]);

  // Check if all questions have answers
  const canSubmit = useMemo(() => {
    if (!pending) return false;
    return pending.questions.every((q) => {
      const answer = pending.answers[q.header];
      return answer && answer.length > 0;
    });
  }, [pending]);

  // Sync free-text state when the current question changes
  const currentHeader = currentQuestion?.header;
  const hasFreeText = currentQuestion && currentQuestion.options.length === 0;
  useEffect(() => {
    if (hasFreeText && currentHeader && pending) {
      setFreeTextValue(pending.answers[currentHeader] || '');
    }
  }, [currentHeader, hasFreeText, pending]);

  // Restore "Other" state when navigating to a different question.
  // Only fires on currentHeader change (not on answer updates for the current question).
  useEffect(() => {
    if (!currentQuestion || currentQuestion.options.length === 0 || !currentHeader) {
      setOtherSelected(false);
      setOtherTextValue('');
      return;
    }
    // Read answer directly from store snapshot (not from `pending` dep)
    const pendingState = useAppStore.getState().pendingUserQuestion[conversationId];
    const answer = pendingState?.answers[currentHeader];
    if (!answer) {
      setOtherSelected(false);
      setOtherTextValue('');
      return;
    }
    if (!currentQuestion.multiSelect) {
      const matchesOption = currentQuestion.options.some(o => o.label === answer);
      if (!matchesOption) {
        setOtherSelected(true);
        setOtherTextValue(answer);
      } else {
        setOtherSelected(false);
        setOtherTextValue('');
      }
    } else {
      const values = answer.split(',').filter(Boolean);
      const optionLabels = new Set(currentQuestion.options.map(o => o.label));
      const otherValues = values.filter(v => !optionLabels.has(v));
      if (otherValues.length > 0) {
        setOtherSelected(true);
        setOtherTextValue(otherValues[0]);
      } else {
        setOtherSelected(false);
        setOtherTextValue('');
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentHeader, conversationId]);

  // Total options count including "Other" (for keyboard shortcut numbering)
  const otherNumber = currentQuestion ? currentQuestion.options.length + 1 : 0;

  // Keyboard shortcuts: number keys select options
  useEffect(() => {
    if (!currentQuestion || isSubmitting || currentQuestion.options.length === 0) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Only handle if this instance's container is in the DOM
      if (!containerRef.current || !containerRef.current.isConnected) return;

      // Don't intercept when typing in an input/textarea
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      const num = parseInt(e.key, 10);
      if (isNaN(num) || num < 1) return;

      if (num <= currentQuestion.options.length) {
        e.preventDefault();
        handleOptionToggle(currentQuestion.options[num - 1].label);
      } else if (num === otherNumber) {
        e.preventDefault();
        handleOptionToggle(OTHER_OPTION_LABEL);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [currentQuestion, isSubmitting, otherNumber, handleOptionToggle]);

  // Whether user is actively typing custom "Other" text
  const isOtherTextActive = otherSelected && otherTextValue.length > 0;

  // Selected count for multi-select footer
  const selectedCount = useMemo(() => {
    if (!currentQuestion?.multiSelect) return 0;
    return selectedValues.size + (isOtherTextActive ? 1 : 0);
  }, [currentQuestion?.multiSelect, selectedValues.size, isOtherTextActive]);

  if (!pending || !currentQuestion) return null;

  return (
    <div ref={containerRef} className="pt-1 px-3 pb-3">
      <div className="relative rounded-xl border border-border bg-card dark:bg-input">
        {/* Question Header */}
        <div className="flex items-start justify-between gap-4 px-5 pt-4 pb-3">
          <p className="text-base font-semibold text-foreground leading-relaxed">{currentQuestion.question}</p>
          <div className="flex items-center gap-1 shrink-0 mt-0.5">
            {totalQuestions > 1 && (
              <>
                <button
                  type="button"
                  aria-label="Previous question"
                  className="p-0.5 text-muted-foreground/60 hover:text-muted-foreground disabled:opacity-30 transition-colors"
                  disabled={currentIndex === 0}
                  onClick={handlePrev}
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span className="text-sm text-muted-foreground/60 tabular-nums" data-testid="question-counter">
                  {currentIndex + 1} of {totalQuestions}
                </span>
                <button
                  type="button"
                  aria-label="Next question"
                  className="p-0.5 text-muted-foreground/60 hover:text-muted-foreground disabled:opacity-30 transition-colors"
                  disabled={currentIndex === totalQuestions - 1}
                  onClick={handleNext}
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </>
            )}
            <button
              type="button"
              aria-label="Dismiss question"
              className={cn(
                'p-1 text-muted-foreground/60 hover:text-muted-foreground transition-colors',
                totalQuestions > 1 && 'ml-1'
              )}
              onClick={handleDismiss}
              disabled={isSubmitting}
              data-testid="dismiss-question"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Options List or Free-text Input — key forces remount when question changes */}
        <div key={currentQuestion.header} className="px-2 pb-1">
          {currentQuestion.options.length > 0 ? (
            <>
              {/* Option rows with dividers */}
              {currentQuestion.options.map((option, index) => {
                const isSelected = selectedValues.has(option.label);
                const effectiveSelected = isSelected && (!otherSelected || currentQuestion.multiSelect);
                return (
                  <div key={option.label}>
                    <button
                      type="button"
                      onClick={() => handleOptionToggle(option.label)}
                      className={cn(
                        'w-full flex items-center gap-3 px-3 py-3 text-left rounded-lg transition-all duration-150',
                        effectiveSelected
                          ? 'bg-primary/10 text-foreground'
                          : 'text-foreground/80 hover:bg-muted/30 hover:text-foreground',
                        isOtherTextActive && !currentQuestion.multiSelect && 'opacity-50'
                      )}
                      data-testid={`option-${index}`}
                    >
                      {/* Left indicator: checkbox for multi-select, number circle for single-select */}
                      {currentQuestion.multiSelect ? (
                        <div className={cn(
                          'flex items-center justify-center h-5 w-5 rounded border-2 shrink-0 transition-colors',
                          effectiveSelected
                            ? 'border-primary bg-primary'
                            : 'border-muted-foreground/30'
                        )}>
                          {effectiveSelected && <Check className="h-3 w-3 text-primary-foreground" />}
                        </div>
                      ) : (
                        <span className="flex items-center justify-center h-7 w-7 rounded-full bg-muted/50 text-xs font-medium text-muted-foreground shrink-0">
                          {index + 1}
                        </span>
                      )}
                      <div className="flex-1 min-w-0">
                        <span className="text-sm font-medium block">{option.label}</span>
                        {option.description && (
                          <span className="text-xs text-muted-foreground block mt-0.5">{option.description}</span>
                        )}
                      </div>
                      {/* Right arrow for selected single-select option */}
                      {!currentQuestion.multiSelect && effectiveSelected && (
                        <ArrowRight className="h-4 w-4 text-foreground/60 shrink-0" />
                      )}
                    </button>
                    {/* Divider between options */}
                    {index < currentQuestion.options.length - 1 && (
                      <div className="h-px bg-border/40 mx-3" />
                    )}
                  </div>
                );
              })}

              {/* Divider before "Something else" */}
              <div className="h-px bg-border/40 mx-3" />

              {/* "Something else" row — renders as <button> when collapsed,
                  <div> when expanded to avoid invalid HTML (interactive <input>
                  nested inside <button>). */}
              {otherSelected ? (
                <div
                  className="w-full flex items-center gap-3 px-3 py-3 text-left rounded-lg transition-all duration-150 bg-primary/10 cursor-pointer"
                  data-testid="other-option"
                  onClick={(e) => {
                    // Toggle off when clicking anywhere except the text input
                    if ((e.target as HTMLElement).tagName !== 'INPUT') {
                      handleOptionToggle(OTHER_OPTION_LABEL);
                    }
                  }}
                >
                  {/* Left icon */}
                  {currentQuestion.multiSelect ? (
                    <div className="flex items-center justify-center h-5 w-5 rounded border-2 border-primary bg-primary shrink-0 transition-colors">
                      <Check className="h-3 w-3 text-primary-foreground" />
                    </div>
                  ) : (
                    <span className="flex items-center justify-center h-7 w-7 rounded-full bg-muted/50 shrink-0">
                      <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                    </span>
                  )}
                  <div className="flex-1 min-w-0">
                    <input
                      type="text"
                      className="w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none"
                      placeholder="Something else"
                      value={otherTextValue}
                      onChange={(e) => {
                        setOtherTextValue(e.target.value);
                        if (!currentQuestion.multiSelect) {
                          updateUserQuestionAnswer(conversationId, currentQuestion.header, e.target.value);
                        } else {
                          const currentAnswer = useAppStore.getState().pendingUserQuestion[conversationId]?.answers[currentQuestion.header] || '';
                          const optionLabels = new Set(currentQuestion.options.map(o => o.label));
                          const regularSelections = currentAnswer.split(',').filter(v => v && optionLabels.has(v));
                          if (e.target.value) {
                            regularSelections.push(e.target.value);
                          }
                          updateUserQuestionAnswer(conversationId, currentQuestion.header, regularSelections.join(','));
                        }
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && otherTextValue.trim() && !isSubmitting) {
                          e.preventDefault();
                          handleSubmit();
                        }
                      }}
                      autoFocus
                      data-testid="other-text-input"
                    />
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => handleOptionToggle(OTHER_OPTION_LABEL)}
                  className="w-full flex items-center gap-3 px-3 py-3 text-left rounded-lg transition-all duration-150 hover:bg-muted/30"
                  data-testid="other-option"
                >
                  {currentQuestion.multiSelect ? (
                    <div className="flex items-center justify-center h-5 w-5 rounded border-2 shrink-0 transition-colors border-muted-foreground/30" />
                  ) : (
                    <span className="flex items-center justify-center h-7 w-7 rounded-full bg-muted/50 shrink-0">
                      <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                    </span>
                  )}
                  <span className="text-sm text-muted-foreground/50">Something else</span>
                </button>
              )}
            </>
          ) : (
            <div className="px-3 py-1">
              <input
                type="text"
                className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                placeholder="Type your answer..."
                value={freeTextValue}
                onChange={(e) => {
                  setFreeTextValue(e.target.value);
                  updateUserQuestionAnswer(conversationId, currentQuestion.header, e.target.value);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && canSubmit && !isSubmitting) {
                    e.preventDefault();
                    handleSubmit();
                  }
                }}
                autoFocus
                data-testid="free-text-input"
              />
            </div>
          )}
        </div>

        {/* Footer with selected count, skip, and submit */}
        <div className="flex items-center justify-between px-5 pb-3 pt-1">
          {/* Left: selected count for multi-select */}
          <div className="text-sm text-muted-foreground">
            {currentQuestion.multiSelect && selectedCount > 0 && `${selectedCount} selected`}
          </div>

          {/* Right: Skip + Submit */}
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              className="h-8 px-4 text-sm"
              onClick={handleDismiss}
              disabled={isSubmitting}
              data-testid="skip-question"
            >
              Skip
            </Button>
            <Button
              size="icon"
              className={cn(
                'h-8 w-8 rounded-lg',
                isOtherTextActive
                  ? 'bg-primary hover:bg-primary/90 text-primary-foreground border-primary'
                  : 'bg-foreground hover:bg-foreground/90 text-background border-foreground'
              )}
              disabled={!canSubmit || isSubmitting}
              onClick={handleSubmit}
              data-testid="submit-question"
            >
              {isSubmitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ArrowRight className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
