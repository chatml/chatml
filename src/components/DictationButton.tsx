'use client';

import { Button } from '@/components/ui/button';
import { Mic, MicOff } from 'lucide-react';
import { cn } from '@/lib/utils';

interface DictationButtonProps {
  isListening: boolean;
  isAvailable: boolean;
  disabled?: boolean;
  onClick: () => void;
}

export function DictationButton({
  isListening,
  isAvailable,
  disabled = false,
  onClick,
}: DictationButtonProps) {
  const isDisabled = disabled || !isAvailable;

  return (
    <Button
      variant="ghost"
      size="icon"
      className={cn(
        'h-7 w-7 transition-all',
        isListening && 'dictation-active text-orange-500 hover:text-orange-600',
        isDisabled && 'opacity-50 cursor-not-allowed'
      )}
      onClick={onClick}
      disabled={isDisabled}
      title={
        !isAvailable
          ? 'Speech recognition not available'
          : isListening
          ? 'Stop dictation'
          : 'Start dictation (Cmd+Shift+D)'
      }
    >
      {isAvailable ? (
        <Mic className={cn('h-4 w-4', isListening && 'animate-pulse')} />
      ) : (
        <MicOff className="h-4 w-4" />
      )}
    </Button>
  );
}
