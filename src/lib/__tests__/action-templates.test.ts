import { describe, it, expect, vi } from 'vitest';
import {
  ACTION_TEMPLATES,
  ACTION_TEMPLATE_META,
  ACTION_TEMPLATE_NAMES,
  getTemplateKey,
  parseOverrides,
  serializeOverrides,
  fetchMergedActionTemplates,
  type ActionTemplateKey,
  type ActionTemplateOverride,
} from '../action-templates';

// ============================================================================
// getTemplateKey
// ============================================================================

describe('getTemplateKey', () => {
  it('maps direct action types to template keys', () => {
    expect(getTemplateKey('resolve-conflicts')).toBe('resolve-conflicts');
    expect(getTemplateKey('fix-issues')).toBe('fix-issues');
    expect(getTemplateKey('sync-branch')).toBe('sync-branch');
    expect(getTemplateKey('create-pr')).toBe('create-pr');
    expect(getTemplateKey('merge-pr')).toBe('merge-pr');
  });

  it('maps continue-* variants to continue-operation', () => {
    expect(getTemplateKey('continue-rebase')).toBe('continue-operation');
    expect(getTemplateKey('continue-merge')).toBe('continue-operation');
    expect(getTemplateKey('continue-cherry-pick')).toBe('continue-operation');
    expect(getTemplateKey('continue-revert')).toBe('continue-operation');
  });

  it('returns null for unmapped action types', () => {
    expect(getTemplateKey('view-pr')).toBeNull();
    expect(getTemplateKey('archive-session')).toBeNull();
    expect(getTemplateKey('unknown')).toBeNull();
  });
});

// ============================================================================
// parseOverrides
// ============================================================================

describe('parseOverrides', () => {
  it('parses text and mode from flat key-value map', () => {
    const raw = {
      'resolve-conflicts': 'Custom instructions',
      'resolve-conflicts:mode': 'replace',
    };
    const result = parseOverrides(raw);
    expect(result['resolve-conflicts']).toEqual({
      text: 'Custom instructions',
      mode: 'replace',
    });
  });

  it('defaults mode to append when not specified', () => {
    const raw = { 'fix-issues': 'Extra steps' };
    const result = parseOverrides(raw);
    expect(result['fix-issues']?.mode).toBe('append');
  });

  it('defaults mode to append for invalid mode values', () => {
    const raw = {
      'fix-issues': 'Extra steps',
      'fix-issues:mode': 'invalid',
    };
    const result = parseOverrides(raw);
    expect(result['fix-issues']?.mode).toBe('append');
  });

  it('ignores keys that are not valid template keys', () => {
    const raw = { 'unknown-key': 'value' };
    const result = parseOverrides(raw);
    expect(Object.keys(result)).toHaveLength(0);
  });

  it('skips entries with empty text', () => {
    const raw = { 'fix-issues': '' };
    const result = parseOverrides(raw);
    expect(result['fix-issues']).toBeUndefined();
  });
});

// ============================================================================
// serializeOverrides
// ============================================================================

describe('serializeOverrides', () => {
  it('serializes overrides to flat key-value map', () => {
    const overrides: Partial<Record<ActionTemplateKey, ActionTemplateOverride>> = {
      'fix-issues': { text: 'Custom steps', mode: 'append' },
    };
    const result = serializeOverrides(overrides);
    expect(result).toEqual({ 'fix-issues': 'Custom steps' });
    // append mode should NOT have a :mode key (it's the default)
    expect(result['fix-issues:mode']).toBeUndefined();
  });

  it('includes :mode key only for replace mode', () => {
    const overrides: Partial<Record<ActionTemplateKey, ActionTemplateOverride>> = {
      'create-pr': { text: 'Always draft', mode: 'replace' },
    };
    const result = serializeOverrides(overrides);
    expect(result['create-pr']).toBe('Always draft');
    expect(result['create-pr:mode']).toBe('replace');
  });

  it('trims whitespace from text', () => {
    const overrides: Partial<Record<ActionTemplateKey, ActionTemplateOverride>> = {
      'merge-pr': { text: '  Squash always  ', mode: 'append' },
    };
    const result = serializeOverrides(overrides);
    expect(result['merge-pr']).toBe('Squash always');
  });

  it('skips entries with empty/whitespace-only text', () => {
    const overrides: Partial<Record<ActionTemplateKey, ActionTemplateOverride>> = {
      'fix-issues': { text: '  ', mode: 'replace' },
    };
    const result = serializeOverrides(overrides);
    expect(Object.keys(result)).toHaveLength(0);
  });
});

// ============================================================================
// parseOverrides + serializeOverrides roundtrip
// ============================================================================

describe('roundtrip', () => {
  it('serialized overrides parse back to the same structure', () => {
    const original: Partial<Record<ActionTemplateKey, ActionTemplateOverride>> = {
      'resolve-conflicts': { text: 'Custom A', mode: 'replace' },
      'fix-issues': { text: 'Custom B', mode: 'append' },
    };
    const serialized = serializeOverrides(original);
    const parsed = parseOverrides(serialized);
    expect(parsed).toEqual(original);
  });
});

// ============================================================================
// fetchMergedActionTemplates
// ============================================================================

describe('fetchMergedActionTemplates', () => {
  const getGlobal = vi.fn<() => Promise<Record<string, string>>>();
  const getWorkspace = vi.fn<(id: string) => Promise<Record<string, string>>>();

  it('returns built-in templates when no overrides', async () => {
    getGlobal.mockResolvedValue({});
    getWorkspace.mockResolvedValue({});

    const result = await fetchMergedActionTemplates('ws-1', getGlobal, getWorkspace);
    for (const key of Object.keys(ACTION_TEMPLATES) as ActionTemplateKey[]) {
      expect(result[key]).toContain('IMPORTANT:');
    }
  });

  it('appends global override in append mode', async () => {
    getGlobal.mockResolvedValue({ 'fix-issues': 'Run lint too' });
    getWorkspace.mockResolvedValue({});

    const result = await fetchMergedActionTemplates('ws-1', getGlobal, getWorkspace);
    expect(result['fix-issues']).toContain('Run lint too');
    expect(result['fix-issues']).toContain('Additional Instructions');
    // Should still contain safety footer
    expect(result['fix-issues']).toContain('IMPORTANT:');
  });

  it('replaces with global override in replace mode', async () => {
    getGlobal.mockResolvedValue({
      'fix-issues': 'Completely custom',
      'fix-issues:mode': 'replace',
    });
    getWorkspace.mockResolvedValue({});

    const result = await fetchMergedActionTemplates('ws-1', getGlobal, getWorkspace);
    expect(result['fix-issues']).toContain('Completely custom');
    // Should NOT contain original built-in content
    expect(result['fix-issues']).not.toContain('## Fix CI Failures');
    // Safety footer is always appended
    expect(result['fix-issues']).toContain('IMPORTANT:');
  });

  it('workspace replace overrides global', async () => {
    getGlobal.mockResolvedValue({ 'create-pr': 'Global instructions' });
    getWorkspace.mockResolvedValue({
      'create-pr': 'Workspace wins',
      'create-pr:mode': 'replace',
    });

    const result = await fetchMergedActionTemplates('ws-1', getGlobal, getWorkspace);
    expect(result['create-pr']).toContain('Workspace wins');
    expect(result['create-pr']).not.toContain('Global instructions');
  });

  it('workspace append stacks on top of global append', async () => {
    getGlobal.mockResolvedValue({ 'merge-pr': 'Global extra' });
    getWorkspace.mockResolvedValue({ 'merge-pr': 'Workspace extra' });

    const result = await fetchMergedActionTemplates('ws-1', getGlobal, getWorkspace);
    expect(result['merge-pr']).toContain('Global extra');
    expect(result['merge-pr']).toContain('Workspace extra');
  });

  it('handles API errors gracefully', async () => {
    getGlobal.mockRejectedValue(new Error('network'));
    getWorkspace.mockRejectedValue(new Error('network'));

    const result = await fetchMergedActionTemplates('ws-1', getGlobal, getWorkspace);
    // Should fall back to built-in templates
    for (const key of Object.keys(ACTION_TEMPLATES) as ActionTemplateKey[]) {
      expect(result[key]).toBeDefined();
    }
  });
});

// ============================================================================
// Constants integrity
// ============================================================================

describe('constants', () => {
  it('ACTION_TEMPLATE_META covers all template keys', () => {
    const metaKeys = ACTION_TEMPLATE_META.map((m) => m.key);
    for (const key of Object.keys(ACTION_TEMPLATES)) {
      expect(metaKeys).toContain(key);
    }
  });

  it('ACTION_TEMPLATE_NAMES covers all template keys', () => {
    for (const key of Object.keys(ACTION_TEMPLATES)) {
      expect(ACTION_TEMPLATE_NAMES[key as ActionTemplateKey]).toBeDefined();
    }
  });

  it('all built-in templates contain the safety footer', () => {
    for (const template of Object.values(ACTION_TEMPLATES)) {
      expect(template).toContain('Never switch to or check out main');
    }
  });
});
