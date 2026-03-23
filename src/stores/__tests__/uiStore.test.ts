import { describe, it, expect, beforeEach } from 'vitest';
import { useUIStore, DEFAULT_TOOLBAR_BG, type ToolbarConfig } from '../uiStore';

beforeEach(() => {
  useUIStore.setState({
    toolbarBackgrounds: {
      left: DEFAULT_TOOLBAR_BG,
      center: DEFAULT_TOOLBAR_BG,
      right: DEFAULT_TOOLBAR_BG,
    },
    toolbarConfig: null,
    tabTitles: {},
  });
});

// ============================================================================
// Toolbar Backgrounds
// ============================================================================

describe('toolbar backgrounds', () => {
  it('sets a single toolbar background', () => {
    useUIStore.getState().setToolbarBackground('left', 'bg-red-500');
    const state = useUIStore.getState();
    expect(state.toolbarBackgrounds.left).toBe('bg-red-500');
    expect(state.toolbarBackgrounds.center).toBe(DEFAULT_TOOLBAR_BG);
    expect(state.toolbarBackgrounds.right).toBe(DEFAULT_TOOLBAR_BG);
  });

  it('sets all toolbar backgrounds at once', () => {
    useUIStore.getState().setAllToolbarBackgrounds('bg-blue-500');
    const { toolbarBackgrounds } = useUIStore.getState();
    expect(toolbarBackgrounds.left).toBe('bg-blue-500');
    expect(toolbarBackgrounds.center).toBe('bg-blue-500');
    expect(toolbarBackgrounds.right).toBe('bg-blue-500');
  });

  it('resets all toolbar backgrounds to default', () => {
    useUIStore.getState().setAllToolbarBackgrounds('bg-blue-500');
    useUIStore.getState().resetToolbarBackgrounds();
    const { toolbarBackgrounds } = useUIStore.getState();
    expect(toolbarBackgrounds.left).toBe(DEFAULT_TOOLBAR_BG);
    expect(toolbarBackgrounds.center).toBe(DEFAULT_TOOLBAR_BG);
    expect(toolbarBackgrounds.right).toBe(DEFAULT_TOOLBAR_BG);
  });
});

// ============================================================================
// Toolbar Config
// ============================================================================

describe('toolbar config', () => {
  it('starts as null', () => {
    expect(useUIStore.getState().toolbarConfig).toBeNull();
  });

  it('sets toolbar config', () => {
    const config: ToolbarConfig = { leading: 'back', title: 'Settings' };
    useUIStore.getState().setToolbarConfig(config);
    expect(useUIStore.getState().toolbarConfig).toEqual(config);
  });

  it('clears toolbar config by setting null', () => {
    useUIStore.getState().setToolbarConfig({ title: 'Test' });
    useUIStore.getState().setToolbarConfig(null);
    expect(useUIStore.getState().toolbarConfig).toBeNull();
  });
});

// ============================================================================
// Tab Titles
// ============================================================================

describe('tab titles', () => {
  it('sets a tab title', () => {
    useUIStore.getState().setTabTitle('tab-1', 'My Tab');
    expect(useUIStore.getState().tabTitles['tab-1']).toBe('My Tab');
  });

  it('overwrites an existing tab title', () => {
    useUIStore.getState().setTabTitle('tab-1', 'Original');
    useUIStore.getState().setTabTitle('tab-1', 'Updated');
    expect(useUIStore.getState().tabTitles['tab-1']).toBe('Updated');
  });

  it('removes a tab title', () => {
    useUIStore.getState().setTabTitle('tab-1', 'Title');
    useUIStore.getState().setTabTitle('tab-2', 'Other');
    useUIStore.getState().removeTabTitle('tab-1');
    expect(useUIStore.getState().tabTitles['tab-1']).toBeUndefined();
    expect(useUIStore.getState().tabTitles['tab-2']).toBe('Other');
  });

  it('removing non-existent tab title is a no-op', () => {
    useUIStore.getState().setTabTitle('tab-1', 'Title');
    useUIStore.getState().removeTabTitle('nonexistent');
    expect(useUIStore.getState().tabTitles['tab-1']).toBe('Title');
  });
});
