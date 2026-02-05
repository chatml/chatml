import { useState, useCallback, useMemo, useRef } from 'react';
import {
  type SlashCommand,
  type SlashCommandContext,
  type SlashCommandAvailability,
  getAvailableSlashCommands,
  filterSlashCommands,
} from '@/lib/slashCommands';

// ============================================================================
// Trigger Detection
// ============================================================================

interface TriggerResult {
  active: boolean;
  query: string;
  triggerPos: number;
}

function detectSlashTrigger(message: string, cursorPosition: number): TriggerResult {
  const inactive: TriggerResult = { active: false, query: '', triggerPos: -1 };

  if (!message || cursorPosition === 0) return inactive;

  const textBeforeCursor = message.slice(0, cursorPosition);
  const lastNewline = textBeforeCursor.lastIndexOf('\n');
  const lineStart = lastNewline + 1;
  const currentLine = textBeforeCursor.slice(lineStart);

  if (!currentLine.startsWith('/')) return inactive;

  // Don't trigger if there's text before the "/" on this line (non-whitespace)
  // The "/" must be the first character on the line
  const query = currentLine.slice(1);

  // Don't activate if query contains a space followed by more text
  // (user is typing a path like /foo/bar or a full sentence)
  // But allow empty query (just typed "/")
  if (query.includes(' ')) return inactive;

  return { active: true, query, triggerPos: lineStart };
}

// ============================================================================
// Hook
// ============================================================================

export interface UseSlashCommandsReturn {
  isOpen: boolean;
  query: string;
  filteredCommands: SlashCommand[];
  selectedIndex: number;
  /** Call in input onKeyDown. Returns true if the event was consumed. */
  handleKeyDown: (e: React.KeyboardEvent, currentMessage?: string) => boolean;
  /** Call when input value or cursor position changes. */
  handleInputChange: (value: string, cursorPos: number) => void;
  /** Execute a specific command (e.g., on click). */
  executeCommand: (command: SlashCommand) => void;
  /** Dismiss the menu. */
  dismiss: () => void;
  /** Set the selected index (e.g., on mouse hover). */
  setSelectedIndex: (index: number) => void;
}

interface UseSlashCommandsOptions {
  context: SlashCommandContext;
  availability: SlashCommandAvailability;
}

export function useSlashCommands({ context, availability }: UseSlashCommandsOptions): UseSlashCommandsReturn {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [availableCommands, setAvailableCommands] = useState<SlashCommand[]>([]);
  const triggerPosRef = useRef(-1);

  const filteredCommands = useMemo(
    () => filterSlashCommands(availableCommands, query),
    [availableCommands, query]
  );

  const dismiss = useCallback(() => {
    setIsOpen(false);
    setQuery('');
    setSelectedIndex(0);
    triggerPosRef.current = -1;
  }, []);

  const executeCommand = useCallback(
    (command: SlashCommand, currentMessage?: string) => {
      const triggerPos = triggerPosRef.current;
      dismiss();

      if (command.executionType === 'action') {
        // Preserve text outside the /command trigger range
        if (currentMessage !== undefined && triggerPos >= 0) {
          const before = currentMessage.slice(0, triggerPos);
          // Find the end of the slash command (next newline or end of string)
          const afterTrigger = currentMessage.slice(triggerPos);
          const newlineIdx = afterTrigger.indexOf('\n');
          const after = newlineIdx >= 0 ? afterTrigger.slice(newlineIdx + 1) : '';
          const preserved = (before + after).trim();
          context.setMessage(preserved);
        } else {
          context.setMessage('');
        }
        command.execute(context);
      } else {
        // Insert type: execute sets the message to the prompt prefix
        command.execute(context);
      }
    },
    [context, dismiss]
  );

  const handleInputChange = useCallback(
    (value: string, cursorPos: number) => {
      const trigger = detectSlashTrigger(value, cursorPos);

      if (trigger.active) {
        // Snapshot available commands when first opening
        const cmds = isOpen ? availableCommands : getAvailableSlashCommands(availability);
        if (!isOpen) {
          setAvailableCommands(cmds);
        }
        triggerPosRef.current = trigger.triggerPos;
        setQuery(trigger.query);
        setIsOpen(true);
        // Clamp selected index to new filtered results
        const newFiltered = filterSlashCommands(cmds, trigger.query);
        setSelectedIndex((prev) => (prev >= newFiltered.length ? 0 : prev));
      } else {
        if (isOpen) dismiss();
      }
    },
    [isOpen, dismiss, availability, availableCommands]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent, currentMessage?: string): boolean => {
      if (!isOpen || filteredCommands.length === 0) return false;

      switch (e.key) {
        case 'ArrowDown': {
          e.preventDefault();
          setSelectedIndex((prev) => (prev + 1) % filteredCommands.length);
          return true;
        }
        case 'ArrowUp': {
          e.preventDefault();
          setSelectedIndex((prev) => (prev - 1 + filteredCommands.length) % filteredCommands.length);
          return true;
        }
        case 'Enter':
        case 'Tab': {
          e.preventDefault();
          const selected = filteredCommands[selectedIndex];
          if (selected) {
            executeCommand(selected, currentMessage);
          }
          return true;
        }
        case 'Escape': {
          e.preventDefault();
          dismiss();
          return true;
        }
        default:
          return false;
      }
    },
    [isOpen, filteredCommands, selectedIndex, executeCommand, dismiss]
  );

  return {
    isOpen,
    query,
    filteredCommands,
    selectedIndex,
    handleKeyDown,
    handleInputChange,
    executeCommand,
    dismiss,
    setSelectedIndex,
  };
}
