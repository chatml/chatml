import { describe, it, expect, beforeEach } from 'vitest';
import { useSettingsStore } from '../settingsStore';

describe('settingsStore - showThinkingBlocks', () => {
  beforeEach(() => {
    useSettingsStore.setState({ showThinkingBlocks: true });
  });

  it('defaults to true', () => {
    expect(useSettingsStore.getState().showThinkingBlocks).toBe(true);
  });

  it('setShowThinkingBlocks sets to false', () => {
    useSettingsStore.getState().setShowThinkingBlocks(false);
    expect(useSettingsStore.getState().showThinkingBlocks).toBe(false);
  });

  it('setShowThinkingBlocks sets to true', () => {
    useSettingsStore.setState({ showThinkingBlocks: false });
    useSettingsStore.getState().setShowThinkingBlocks(true);
    expect(useSettingsStore.getState().showThinkingBlocks).toBe(true);
  });

  it('toggleShowThinkingBlocks flips from true to false', () => {
    useSettingsStore.getState().toggleShowThinkingBlocks();
    expect(useSettingsStore.getState().showThinkingBlocks).toBe(false);
  });

  it('toggleShowThinkingBlocks flips from false to true', () => {
    useSettingsStore.setState({ showThinkingBlocks: false });
    useSettingsStore.getState().toggleShowThinkingBlocks();
    expect(useSettingsStore.getState().showThinkingBlocks).toBe(true);
  });

  it('toggleShowThinkingBlocks round-trips correctly', () => {
    expect(useSettingsStore.getState().showThinkingBlocks).toBe(true);
    useSettingsStore.getState().toggleShowThinkingBlocks();
    expect(useSettingsStore.getState().showThinkingBlocks).toBe(false);
    useSettingsStore.getState().toggleShowThinkingBlocks();
    expect(useSettingsStore.getState().showThinkingBlocks).toBe(true);
  });

  it('does not affect other settings when toggling', () => {
    const before = useSettingsStore.getState();
    const originalModel = before.defaultModel;
    const originalThinking = before.defaultThinking;

    useSettingsStore.getState().toggleShowThinkingBlocks();

    const after = useSettingsStore.getState();
    expect(after.defaultModel).toBe(originalModel);
    expect(after.defaultThinking).toBe(originalThinking);
    expect(after.showThinkingBlocks).toBe(false);
  });
});
