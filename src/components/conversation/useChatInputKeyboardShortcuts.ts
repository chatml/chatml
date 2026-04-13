import React, { useEffect, useRef } from 'react';
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
 *
 * All callback and state dependencies are stored in a ref so the event
 * listeners are mounted once and never torn down / re-added on parent
 * re-renders. This eliminates listener churn from the previous 11-dependency
 * useEffect.
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
  // Keep all mutable deps in a ref so handlers always read the latest values
  // without requiring effect re-runs.
  const depsRef = useRef({
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
  });
  // Sync on every render (intentional — keeps ref current for event handlers)
  useEffect(() => {
    depsRef.current = {
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
    };
  });

  // Mount all listeners once — handlers close over depsRef, not the values.
  useEffect(() => {
    const handleGlobalKeyDown = (e: globalThis.KeyboardEvent) => {
      const d = depsRef.current;
      // Cmd+L to focus input
      if (e.code === 'KeyL' && (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        d.plateInputRef.current?.focus();
      }
      // Alt+1..9 to select model by index
      if (e.altKey && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
        const digit = e.code.match(/^Digit([1-9])$/)?.[1];
        if (digit) {
          const idx = parseInt(digit, 10) - 1;
          if (idx >= 0 && idx < d.MODELS.length) {
            e.preventDefault();
            d.setSelectedModel(d.MODELS[idx]);
          }
        }
      }
      // Alt+T to cycle thinking levels
      if (e.code === 'KeyT' && e.altKey && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
        e.preventDefault();
        d.setThinkingLevel(prev => {
          const available = d.getAvailableThinkingLevels(d.selectedModel);
          const idx = available.indexOf(prev);
          return available[(idx + 1) % available.length];
        });
      }
      // Shift+Tab to toggle plan mode
      if (e.code === 'Tab' && e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        d.handlePlanModeToggle();
      }
      // Alt+F to toggle fast mode
      if (e.code === 'KeyF' && e.altKey && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
        e.preventDefault();
        d.handleFastModeToggle();
      }
      // Cmd+U to open file picker
      if (e.code === 'KeyU' && (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        d.handleOpenFilePicker();
      }
      // Cmd+I to open Linear issue picker
      if (e.code === 'KeyI' && (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        d.setLinearPickerOpen(true);
      }
    };

    // Handle menu events from native Tauri menu
    const handleFocusInput = () => depsRef.current.plateInputRef.current?.focus();
    const handleToggleThinking = () => {
      const d = depsRef.current;
      d.setThinkingLevel(prev => {
        const available = d.getAvailableThinkingLevels(d.selectedModel);
        const idx = available.indexOf(prev);
        return available[(idx + 1) % available.length];
      });
    };
    const handleTogglePlanMode = () => depsRef.current.handlePlanModeToggle();
    const handleToggleFastMode = () => depsRef.current.handleFastModeToggle();

    // Handle template selection from SessionHomeState quick actions
    const handleTemplateSelected = (e: Event) => {
      const d = depsRef.current;
      const text = (e as CustomEvent<{ text: string }>).detail.text;
      d.plateInputRef.current?.setText(text);
      d.setMessage(text);
      // Use requestAnimationFrame to ensure the editor has updated before focusing
      requestAnimationFrame(() => d.plateInputRef.current?.focus());
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
  }, []);
}
