'use client';

import { useState, useCallback, useMemo, useEffect } from 'react';
import { usePendingUserQuestion, useUserQuestionActions } from '@/stores/selectors';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { X, ChevronLeft, ChevronRight, ArrowUp, Check, Loader2 } from 'lucide-react';
import { answerConversationQuestion } from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import type { UserQuestion } from '@/lib/types';

interface UserQuestionPromptProps {
  conversationId: string;
}

export function UserQuestionPrompt({ conversationId }: UserQuestionPromptProps) {
  const pending = usePendingUserQuestion(conversationId);
  const { updateUserQuestionAnswer, nextUserQuestion, prevUserQuestion, clearPendingUserQuestion } = useUserQuestionActions();
  const { error: showError } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [freeTextValue, setFreeTextValue] = useState('');

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
    if (!currentQuestion) return;

    if (currentQuestion.multiSelect) {
      // Toggle in set
      const newSet = new Set(selectedValues);
      if (newSet.has(label)) {
        newSet.delete(label);
      } else {
        newSet.add(label);
      }
      updateUserQuestionAnswer(conversationId, currentQuestion.header, [...newSet].join(','));
    } else {
      // Single select - replace
      updateUserQuestionAnswer(conversationId, currentQuestion.header, label);
    }
  }, [conversationId, currentQuestion, selectedValues, updateUserQuestionAnswer]);

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

  if (!pending || !currentQuestion) return null;

  return (
    <div className="pt-1 px-3 pb-3">
      <div className="relative rounded-lg border border-border bg-card dark:bg-input">
        {/* Question Header */}
        <div className="flex items-start justify-between px-4 pt-4 pb-2">
          <p className="text-sm text-foreground leading-relaxed pr-8">{currentQuestion.question}</p>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 -mt-1 -mr-1 text-muted-foreground hover:text-foreground"
            onClick={handleDismiss}
            disabled={isSubmitting}
            data-testid="dismiss-question"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Options List or Free-text Input */}
        <div className="px-2 pb-2">
          {currentQuestion.options.length > 0 ? (
            currentQuestion.options.map((option, index) => {
              const isSelected = selectedValues.has(option.label);
              return (
                <button
                  key={option.label}
                  type="button"
                  onClick={() => handleOptionToggle(option.label)}
                  className={cn(
                    'w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-left transition-colors',
                    isSelected
                      ? 'bg-primary/10 text-foreground'
                      : 'text-muted-foreground hover:bg-surface-1/60 hover:text-foreground'
                  )}
                >
                  <span className="text-xs font-mono text-muted-foreground/70 w-4">{index + 1}</span>
                  <div className="flex-1 min-w-0">
                    <span className="text-sm block">{option.label}</span>
                    {option.description && (
                      <span className="text-xs text-muted-foreground/70 block truncate">{option.description}</span>
                    )}
                  </div>
                  <div className={cn(
                    'w-5 h-5 rounded border-2 flex items-center justify-center transition-colors flex-shrink-0',
                    isSelected
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-muted-foreground/40'
                  )}>
                    {isSelected && <Check className="h-3 w-3" />}
                  </div>
                </button>
              );
            })
          ) : (
            <div className="px-2 py-1">
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

        {/* Footer with pagination and submit */}
        <div className="flex items-center justify-between px-4 pb-3 pt-1">
          {/* Pagination */}
          <div className="flex items-center gap-2">
            {totalQuestions > 1 && (
              <>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  disabled={currentIndex === 0}
                  onClick={handlePrev}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <div className="flex items-center gap-1.5">
                  {Array.from({ length: totalQuestions }).map((_, i) => (
                    <div
                      key={i}
                      className={cn(
                        'w-2 h-2 rounded-full transition-colors',
                        i === currentIndex ? 'bg-foreground' : 'bg-muted-foreground/40'
                      )}
                    />
                  ))}
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  disabled={currentIndex === totalQuestions - 1}
                  onClick={handleNext}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </>
            )}
          </div>

          {/* Question progress indicator */}
          {totalQuestions > 1 && (
            <span className="text-xs text-muted-foreground">
              {currentIndex + 1} of {totalQuestions}
            </span>
          )}

          {/* Spacer when no pagination */}
          {totalQuestions <= 1 && <div />}

          {/* Submit Button */}
          <Button
            size="icon"
            className="h-8 w-8 rounded-md"
            disabled={!canSubmit || isSubmitting}
            onClick={handleSubmit}
            data-testid="submit-question"
          >
            {isSubmitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ArrowUp className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
