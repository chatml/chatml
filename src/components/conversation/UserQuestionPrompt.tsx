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
import { isUserQuestionAnswered, serializeUserQuestionAnswers } from '@/lib/userQuestion';

interface UserQuestionPromptProps {
  conversationId: string;
}

export function UserQuestionPrompt({ conversationId }: UserQuestionPromptProps) {
  const pending = usePendingUserQuestion(conversationId);
  const {
    toggleUserQuestionOption,
    selectUserQuestionOther,
    deselectUserQuestionOther,
    setUserQuestionOtherText,
    setUserQuestionFreeText,
    nextUserQuestion,
    prevUserQuestion,
    clearPendingUserQuestion,
  } = useUserQuestionActions();
  const { error: showError } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const autoSubmitTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  // Ref-mirror of isSubmitting so the auto-submit timer can bail when a manual
  // submit/dismiss is already in flight (closures captured `isSubmitting` would be stale).
  const isSubmittingRef = useRef(false);
  useEffect(() => {
    isSubmittingRef.current = isSubmitting;
  }, [isSubmitting]);

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
  const currentHeader = currentQuestion?.header;

  // Selected option indices for the current question (Set for fast lookup).
  const selectedIndexSet = useMemo(() => {
    if (!pending || !currentHeader) return new Set<number>();
    return new Set(pending.selectedIndices[currentHeader] ?? []);
  }, [pending, currentHeader]);

  // Other / free-text state — derived directly from store.
  const otherSelected = currentHeader ? !!pending?.otherSelected[currentHeader] : false;
  const otherText = currentHeader ? (pending?.otherText[currentHeader] ?? '') : '';
  const freeTextValue = currentHeader ? (pending?.freeTextAnswer[currentHeader] ?? '') : '';

  const handleOptionToggle = useCallback((optionIndex: number) => {
    if (!currentQuestion || isSubmitting) return;
    // Cancel any pending auto-submit (e.g. from a previous single-select click).
    if (autoSubmitTimeoutRef.current) {
      clearTimeout(autoSubmitTimeoutRef.current);
      autoSubmitTimeoutRef.current = null;
    }

    toggleUserQuestionOption(conversationId, currentQuestion.header, optionIndex, currentQuestion.multiSelect);

    // Single-select: brief delay so user sees the highlight, then advance/auto-submit.
    if (!currentQuestion.multiSelect) {
      const clickedIndex = useAppStore.getState().pendingUserQuestion[conversationId]?.currentIndex;
      autoSubmitTimeoutRef.current = setTimeout(() => {
        autoSubmitTimeoutRef.current = null;
        // Bail if a manual submit/dismiss is already in flight — without this we
        // could fire a duplicate `answerConversationQuestion` for the same requestId.
        if (isSubmittingRef.current) return;
        const pendingState = useAppStore.getState().pendingUserQuestion[conversationId];
        if (!pendingState) return;
        // Bail if user navigated away from this question before the timer fired.
        if (pendingState.currentIndex !== clickedIndex) return;

        const freshTotal = pendingState.questions.length;
        const freshIndex = pendingState.currentIndex;
        const allAnswered = pendingState.questions.every((q) => isUserQuestionAnswered(pendingState, q));

        if (allAnswered) {
          setIsSubmitting(true);
          answerConversationQuestion(conversationId, pendingState.requestId, serializeUserQuestionAnswers(pendingState))
            .then(() => clearPendingUserQuestion(conversationId))
            .catch((error) => showError(error instanceof Error ? error.message : 'Failed to submit answer'))
            .finally(() => setIsSubmitting(false));
        } else if (freshIndex < freshTotal - 1) {
          nextUserQuestion(conversationId);
        }
      }, 200);
    }
  }, [conversationId, currentQuestion, isSubmitting, toggleUserQuestionOption, nextUserQuestion, clearPendingUserQuestion, showError]);

  const handleOtherToggle = useCallback(() => {
    if (!currentQuestion || isSubmitting) return;
    if (autoSubmitTimeoutRef.current) {
      clearTimeout(autoSubmitTimeoutRef.current);
      autoSubmitTimeoutRef.current = null;
    }
    if (otherSelected) {
      deselectUserQuestionOther(conversationId, currentQuestion.header);
    } else {
      selectUserQuestionOther(conversationId, currentQuestion.header, currentQuestion.multiSelect);
    }
  }, [conversationId, currentQuestion, isSubmitting, otherSelected, selectUserQuestionOther, deselectUserQuestionOther]);

  const handleOtherTextChange = useCallback((text: string) => {
    if (!currentQuestion) return;
    setUserQuestionOtherText(conversationId, currentQuestion.header, text);
  }, [conversationId, currentQuestion, setUserQuestionOtherText]);

  const handleFreeTextChange = useCallback((text: string) => {
    if (!currentQuestion) return;
    setUserQuestionFreeText(conversationId, currentQuestion.header, text);
  }, [conversationId, currentQuestion, setUserQuestionFreeText]);

  const handleDismiss = useCallback(async () => {
    if (!pending || isSubmitting) return;
    if (autoSubmitTimeoutRef.current) {
      clearTimeout(autoSubmitTimeoutRef.current);
      autoSubmitTimeoutRef.current = null;
    }
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
    if (autoSubmitTimeoutRef.current) {
      clearTimeout(autoSubmitTimeoutRef.current);
      autoSubmitTimeoutRef.current = null;
    }

    setIsSubmitting(true);
    try {
      await answerConversationQuestion(conversationId, pending.requestId, serializeUserQuestionAnswers(pending));
      clearPendingUserQuestion(conversationId);
    } catch (error) {
      showError(error instanceof Error ? error.message : 'Failed to submit answer');
    } finally {
      setIsSubmitting(false);
    }
  }, [conversationId, pending, isSubmitting, clearPendingUserQuestion, showError]);

  // Check if all questions have answers (for final-submit gate)
  const canSubmit = useMemo(() => {
    if (!pending) return false;
    return pending.questions.every((q) => isUserQuestionAnswered(pending, q));
  }, [pending]);

  // Check if the current question has an answer (for advancing in multi-question flows)
  const currentQuestionAnswered = useMemo(() => {
    if (!pending || !currentQuestion) return false;
    return isUserQuestionAnswered(pending, currentQuestion);
  }, [pending, currentQuestion]);

  const isLastQuestion = currentIndex === totalQuestions - 1;
  const shouldAdvance = !isLastQuestion && currentQuestionAnswered && !canSubmit;

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
        handleOptionToggle(num - 1);
      } else if (num === otherNumber) {
        e.preventDefault();
        handleOtherToggle();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [currentQuestion, isSubmitting, otherNumber, handleOptionToggle, handleOtherToggle]);

  // Whether user is actively typing custom "Other" text (for the dim-non-other rows)
  const isOtherTextActive = otherSelected && otherText.length > 0;

  // Selected count for multi-select footer. Only counts Other once it has text —
  // empty Other isn't sent on submit (see serializeUserQuestionAnswers), so it shouldn't pad the count.
  const selectedCount = useMemo(() => {
    if (!currentQuestion?.multiSelect) return 0;
    return selectedIndexSet.size + (isOtherTextActive ? 1 : 0);
  }, [currentQuestion?.multiSelect, selectedIndexSet.size, isOtherTextActive]);

  if (!pending || !currentQuestion) return null;

  const isFreeText = currentQuestion.options.length === 0;
  // In single-select, regular options become non-interactive while Other is being typed.
  const optionsDimmed = isOtherTextActive && !currentQuestion.multiSelect;

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
          {!isFreeText ? (
            <>
              {/* Option rows with dividers.
                  Key combines index + label so duplicate labels remain distinct
                  rows; the outer wrapper at the top of this block keys on
                  `currentQuestion.header`, so the option list is remounted on
                  question change — index is stable for this list's lifetime. */}
              {currentQuestion.options.map((option, index) => {
                const isSelected = selectedIndexSet.has(index);
                return (
                  <div key={`${index}-${option.label}`}>
                    <button
                      type="button"
                      onClick={() => handleOptionToggle(index)}
                      className={cn(
                        'w-full flex items-center gap-3 px-3 py-3 text-left rounded-lg transition-all duration-150',
                        isSelected
                          ? 'bg-brand/10 text-foreground'
                          : 'text-foreground/80 hover:bg-muted/30 hover:text-foreground',
                        // While the user is typing in "Other" (single-select), regular options
                        // are de-emphasized but stay clickable — clicking one is the explicit
                        // signal to switch off Other (handled in the store action).
                        optionsDimmed && 'opacity-50'
                      )}
                      data-testid={`option-${index}`}
                    >
                      {/* Left indicator: checkbox for multi-select, number circle for single-select */}
                      {currentQuestion.multiSelect ? (
                        <div className={cn(
                          'flex items-center justify-center h-5 w-5 rounded border-2 shrink-0 transition-colors',
                          isSelected
                            ? 'border-brand bg-brand'
                            : 'border-muted-foreground/30'
                        )}>
                          {isSelected && <Check className="h-3 w-3 text-primary-foreground" />}
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
                      {!currentQuestion.multiSelect && isSelected && (
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
                  nested inside <button>).
                  The expanded row uses brand-tinted bg + filled checkbox only
                  once there's actual text, matching the footer count and
                  serialization gates (empty Other isn't counted/submitted). */}
              {otherSelected ? (
                <div
                  className={cn(
                    'w-full flex items-center gap-3 px-3 py-3 text-left rounded-lg transition-all duration-150 cursor-pointer',
                    // Subtle highlight while typing; full brand tint once there's content.
                    isOtherTextActive ? 'bg-brand/10' : 'bg-muted/30',
                    // Visible focus indicator on the wrapper so keyboard users see where focus lives.
                    'focus-within:ring-1 focus-within:ring-brand/60'
                  )}
                  data-testid="other-option"
                  onClick={(e) => {
                    // Toggle off when clicking anywhere except an interactive
                    // input (covers nested wrappers around the <input> too).
                    if (!(e.target as HTMLElement).closest('input, textarea, button')) {
                      handleOtherToggle();
                    }
                  }}
                >
                  {/* Left icon — single-select uses a number badge (matches
                      keyboard shortcut); multi-select uses a checkbox. The
                      checkbox is only filled once Other has text, mirroring
                      the count/submit gate. */}
                  {currentQuestion.multiSelect ? (
                    <div className={cn(
                      'flex items-center justify-center h-5 w-5 rounded border-2 shrink-0 transition-colors relative',
                      isOtherTextActive
                        ? 'border-brand bg-brand'
                        : 'border-muted-foreground/30'
                    )}>
                      {isOtherTextActive ? (
                        <Check className="h-3 w-3 text-primary-foreground" />
                      ) : (
                        <Pencil className="h-2.5 w-2.5 text-muted-foreground" />
                      )}
                    </div>
                  ) : (
                    <span
                      className="flex items-center justify-center h-7 w-7 rounded-full bg-muted/50 text-xs font-medium text-muted-foreground shrink-0"
                      aria-hidden="true"
                    >
                      {otherNumber}
                    </span>
                  )}
                  <div className="flex-1 min-w-0">
                    <input
                      type="text"
                      className="w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none"
                      placeholder="Something else"
                      value={otherText}
                      onChange={(e) => handleOtherTextChange(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && otherText.trim() && !isSubmitting) {
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
                  onClick={handleOtherToggle}
                  className="w-full flex items-center gap-3 px-3 py-3 text-left rounded-lg transition-all duration-150 hover:bg-muted/30"
                  data-testid="other-option"
                >
                  {currentQuestion.multiSelect ? (
                    // Empty checkbox + small Pencil glyph so multi-select carries
                    // the "free-text option" signal that single-select gets from
                    // its number-vs-pencil styling.
                    <div className="flex items-center justify-center h-5 w-5 rounded border-2 shrink-0 transition-colors border-muted-foreground/30">
                      <Pencil className="h-2.5 w-2.5 text-muted-foreground" />
                    </div>
                  ) : (
                    <span
                      className="flex items-center justify-center h-7 w-7 rounded-full bg-muted/50 text-xs font-medium text-muted-foreground shrink-0"
                      aria-hidden="true"
                    >
                      {otherNumber}
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
                className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-brand/60"
                placeholder="Type your answer..."
                value={freeTextValue}
                onChange={(e) => handleFreeTextChange(e.target.value)}
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
                  ? 'bg-brand hover:bg-brand/90 text-primary-foreground border-brand'
                  : 'bg-foreground hover:bg-foreground/90 text-background border-foreground'
              )}
              disabled={!(shouldAdvance || canSubmit) || isSubmitting}
              onClick={shouldAdvance ? handleNext : handleSubmit}
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
