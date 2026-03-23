import React, { useEffect } from 'react';
import type { PlateInputHandle } from './PlateInput';
import type { ThinkingLevel } from '@/lib/thinkingLevels';
import type { ModelEntry } from '@/lib/models';

interface UseChatInputKeyboardShortcutsOptions {
  plateInputRef: React.RefObject<PlateInputHandle | null>;
  selectedModel: ModelEntry;
  MODELS: ModelEntry[];
  setSelectedModel: React.Dispatch<React.SetStateAction<ModelEntry>>;
  setThinkingLevel: React.Dispatch<React.SetStateAction<ThinkingLevel>>;
  setMessage: (msg: string) => void;
  handlePlanModeToggle: () => void;
  handleFastModeToggle: () => void;
  handleOpenFilePicker: () => void;
  setLinearPickerOpen: (open: boolean) => void;
  getAvailableThinkingLevels: (model: ModelEntry) => ThinkingLevel[];
}

/**
 * Registers global keyboard shortcuts and native Tauri menu event listeners
 * for the chat input area.
 */
export function useChatInputKeyboardShortcuts({
  plateInputRef,
  selectedModel,
  MODELS,
  setSelectedModel,
  setThinkingLevel,
  setMessage,
  handlePlanModeToggle,
  handleFastModeToggle,
  handleOpenFilePicker,
  setLinearPickerOpen,
  getAvailableThinkingLevels,
}: UseChatInputKeyboardShortcutsOptions) {
  useEffect(() => {
    const handleGlobalKeyDown = (e: globalThis.KeyboardEvent) => {
      // Cmd+L to focus input
      if (e.code === 'KeyL' && (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        plateInputRef.current?.focus();
      }
      // Alt+1..9 to select model by index
      if (e.altKey && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
        const digit = e.code.match(/^Digit([1-9])$/)?.[1];
        if (digit) {
          const idx = parseInt(digit, 10) - 1;
          if (idx >= 0 && idx < MODELS.length) {
            e.preventDefault();
            setSelectedModel(MODELS[idx]);
          }
        }
      }
      // Alt+T to cycle thinking levels
      if (e.code === 'KeyT' && e.altKey && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
        e.preventDefault();
        setThinkingLevel(prev => {
          const available = getAvailableThinkingLevels(selectedModel);
          const idx = available.indexOf(prev);
          return available[(idx + 1) % available.length];
        });
      }
      // Shift+Tab to toggle plan mode
      if (e.code === 'Tab' && e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        handlePlanModeToggle();
      }
      // Alt+F to toggle fast mode
      if (e.code === 'KeyF' && e.altKey && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
        e.preventDefault();
        handleFastModeToggle();
      }
      // Cmd+U to open file picker
      if (e.code === 'KeyU' && (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        handleOpenFilePicker();
      }
      // Cmd+I to open Linear issue picker
      if (e.code === 'KeyI' && (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        setLinearPickerOpen(true);
      }
    };

    // Handle menu events from native Tauri menu
    const handleFocusInput = () => plateInputRef.current?.focus();
    const handleToggleThinking = () => {
      setThinkingLevel(prev => {
        const available = getAvailableThinkingLevels(selectedModel);
        const idx = available.indexOf(prev);
        return available[(idx + 1) % available.length];
      });
    };
    const handleTogglePlanMode = () => handlePlanModeToggle();
    const handleToggleFastMode = () => handleFastModeToggle();

    // Handle template selection from SessionHomeState quick actions
    const handleTemplateSelected = (e: Event) => {
      const text = (e as CustomEvent<{ text: string }>).detail.text;
      plateInputRef.current?.setText(text);
      setMessage(text);
      // Use requestAnimationFrame to ensure the editor has updated before focusing
      requestAnimationFrame(() => plateInputRef.current?.focus());
    };

    document.addEventListener('keydown', handleGlobalKeyDown);
    window.addEventListener('focus-input', handleFocusInput);
    window.addEventListener('toggle-thinking', handleToggleThinking);
    window.addEventListener('toggle-plan-mode', handleTogglePlanMode);
    window.addEventListener('toggle-fast-mode', handleToggleFastMode);
    window.addEventListener('session-home-template-selected', handleTemplateSelected);
    return () => {
      document.removeEventListener('keydown', handleGlobalKeyDown);
      window.removeEventListener('focus-input', handleFocusInput);
      window.removeEventListener('toggle-thinking', handleToggleThinking);
      window.removeEventListener('toggle-plan-mode', handleTogglePlanMode);
      window.removeEventListener('toggle-fast-mode', handleToggleFastMode);
      window.removeEventListener('session-home-template-selected', handleTemplateSelected);
    };
  }, [handlePlanModeToggle, handleFastModeToggle, handleOpenFilePicker, selectedModel, MODELS, setMessage, plateInputRef, setSelectedModel, setThinkingLevel, setLinearPickerOpen, getAvailableThinkingLevels]);
}
