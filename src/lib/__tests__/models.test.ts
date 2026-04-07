import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock appStore before importing models
vi.mock('@/stores/appStore', () => ({
  useAppStore: {
    getState: () => ({
      supportedModels: [],
    }),
  },
}));

const { getModelDisplayName, getModelInfo, getModelDescription, buildTurnConfigLabel, MODELS, toShortDisplayName, isDefaultRecommended, toModelFamily, deduplicateByFamily, buildDeduplicatedModelIds } = await import('../models');

describe('getModelDisplayName', () => {
  it('returns short display name for known static models', () => {
    expect(getModelDisplayName('claude-opus-4-6')).toBe('Opus 4.6 (1M context)');
    expect(getModelDisplayName('claude-sonnet-4-6')).toBe('Sonnet 4.6');
    expect(getModelDisplayName('claude-haiku-4-5-20251001')).toBe('Haiku 4.5');
  });

  it('returns raw model ID for unknown models', () => {
    expect(getModelDisplayName('unknown-model')).toBe('unknown-model');
  });

  // Bedrock ARN display name tests
  it('handles Bedrock inference profile ARN', () => {
    const arn = 'arn:aws:bedrock:us-east-1:451348473281:application-inference-profile/6atmd50rvy0c';
    expect(getModelDisplayName(arn)).toBe('Bedrock (6atmd50rvy0c)');
  });

  it('handles Bedrock foundation model ARN', () => {
    const arn = 'arn:aws:bedrock:us-east-1:123456:foundation-model/anthropic.claude-3-sonnet';
    expect(getModelDisplayName(arn)).toBe('Bedrock (anthropic.claude-3-sonnet)');
  });

  it('handles Bedrock ARN with different regions', () => {
    const arn = 'arn:aws:bedrock:eu-west-1:999999:application-inference-profile/xyz123abc';
    expect(getModelDisplayName(arn)).toBe('Bedrock (xyz123abc)');
  });

  it('handles Bedrock ARN with long profile ID', () => {
    const arn = 'arn:aws:bedrock:ap-southeast-1:111222333:application-inference-profile/a1b2c3d4e5f6g7h8i9j0';
    expect(getModelDisplayName(arn)).toBe('Bedrock (a1b2c3d4e5f6g7h8i9j0)');
  });

  it('does not treat non-bedrock ARNs as Bedrock', () => {
    const s3Arn = 'arn:aws:s3:us-east-1:123456:bucket/my-bucket';
    // Not a bedrock ARN, so returns as-is
    expect(getModelDisplayName(s3Arn)).toBe(s3Arn);
  });

  it('returns empty string model ID as-is', () => {
    expect(getModelDisplayName('')).toBe('');
  });
});

describe('toShortDisplayName', () => {
  it('returns canonical name for known models', () => {
    expect(toShortDisplayName('claude-opus-4-6', 'Claude Opus 4.6')).toBe('Opus 4.6 (1M context)');
    expect(toShortDisplayName('claude-sonnet-4-6', 'Claude Sonnet 4.6')).toBe('Sonnet 4.6');
    expect(toShortDisplayName('claude-haiku-4-5-20251001', 'Claude Haiku 4.5')).toBe('Haiku 4.5');
  });

  it('returns same canonical name for extended context variant', () => {
    expect(toShortDisplayName('claude-opus-4-6[1m]', 'Claude Opus 4.6 1M')).toBe('Opus 4.6 (1M context)');
  });

  it('handles dated model variants', () => {
    expect(toShortDisplayName('claude-sonnet-4-6-20260301', 'Claude Sonnet 4.6')).toBe('Sonnet 4.6');
  });

  it('strips Claude prefix for unknown models', () => {
    expect(toShortDisplayName('claude-future-model', 'Claude Future Model')).toBe('Future Model');
  });

  it('returns SDK displayName for non-Claude models', () => {
    expect(toShortDisplayName('custom-model', 'My Custom Model')).toBe('My Custom Model');
  });
});

describe('getModelDescription', () => {
  it('returns description for known models', () => {
    expect(getModelDescription('claude-opus-4-6')).toBe('Most capable for ambitious work');
    expect(getModelDescription('claude-sonnet-4-6')).toBe('Most efficient for everyday tasks');
    expect(getModelDescription('claude-haiku-4-5-20251001')).toBe('Fastest for quick answers');
  });

  it('returns same description for extended context variant', () => {
    expect(getModelDescription('claude-opus-4-6[1m]')).toBe('Most capable for ambitious work');
  });

  it('returns undefined for unknown models', () => {
    expect(getModelDescription('custom-model')).toBeUndefined();
  });
});

describe('isDefaultRecommended', () => {
  it('returns true for "Default (recommended)"', () => {
    expect(isDefaultRecommended('Default (recommended)')).toBe(true);
  });

  it('returns true for display names containing "default"', () => {
    expect(isDefaultRecommended('The default model')).toBe(true);
  });

  it('returns true for display names containing "recommended"', () => {
    expect(isDefaultRecommended('Recommended model')).toBe(true);
  });

  it('returns false for regular model names', () => {
    expect(isDefaultRecommended('Claude Opus 4.6')).toBe(false);
    expect(isDefaultRecommended('Claude Sonnet 4.6')).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(isDefaultRecommended('DEFAULT (RECOMMENDED)')).toBe(true);
  });
});

describe('getModelInfo', () => {
  it('returns info for known static models', () => {
    const opus = getModelInfo('claude-opus-4-6');
    expect(opus).toBeDefined();
    expect(opus!.id).toBe('claude-opus-4-6');
    expect(opus!.name).toBe('Opus 4.6 (1M context)');
    expect(opus!.description).toBe('Most capable for ambitious work');
    expect(opus!.supportsThinking).toBe(true);
    expect(opus!.supportsEffort).toBe(true);
  });

  it('returns undefined for unknown model IDs', () => {
    expect(getModelInfo('not-a-real-model')).toBeUndefined();
  });

  it('returns undefined for Bedrock ARNs (not in static list)', () => {
    const arn = 'arn:aws:bedrock:us-east-1:123:application-inference-profile/abc';
    expect(getModelInfo(arn)).toBeUndefined();
  });

  it('returns supportsFastMode from dynamic SDK models', async () => {
    const { useAppStore } = await import('@/stores/appStore');

    const spy = vi.spyOn(useAppStore, 'getState').mockReturnValue({
      ...useAppStore.getState(),
      supportedModels: [
        {
          value: 'claude-opus-4-6',
          displayName: 'Claude Opus 4.6',
          description: 'Most capable',
          supportsAdaptiveThinking: true,
          supportsEffort: true,
          supportedEffortLevels: ['low', 'medium', 'high', 'max'],
          supportsFastMode: true,
        },
        {
          value: 'claude-haiku-4-5-20251001',
          displayName: 'Claude Haiku 4.5',
          description: 'Fast',
          supportsAdaptiveThinking: false,
          supportsEffort: false,
          supportsFastMode: false,
        },
      ],
    } as ReturnType<typeof useAppStore.getState>);

    try {
      const opus = getModelInfo('claude-opus-4-6');
      expect(opus).toBeDefined();
      expect(opus!.supportsFastMode).toBe(true);

      const haiku = getModelInfo('claude-haiku-4-5-20251001');
      expect(haiku).toBeDefined();
      expect(haiku!.supportsFastMode).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });

  it('returns correct capabilities for each static model', () => {
    for (const model of MODELS) {
      const info = getModelInfo(model.id);
      expect(info).toBeDefined();
      expect(info!.provider).toBe(model.provider);
      expect(info!.supportsThinking).toBe(model.supportsThinking);
      expect(info!.supportsEffort).toBe(model.supportsEffort);
      expect(info!.supportsFastMode).toBe(model.supportsFastMode);
    }
  });
});

describe('buildTurnConfigLabel', () => {
  it('returns null for empty metadata', () => {
    expect(buildTurnConfigLabel({})).toBeNull();
  });

  it('returns model display name only', () => {
    expect(buildTurnConfigLabel({ model: 'claude-opus-4-6' })).toBe('Opus 4.6 (1M context)');
  });

  it('returns effort only', () => {
    expect(buildTurnConfigLabel({ effort: 'high' })).toBe('high effort');
  });

  it('returns plan mode indicator', () => {
    expect(buildTurnConfigLabel({ permissionMode: 'plan' })).toBe('plan mode');
  });

  it('combines model and effort with separator', () => {
    const label = buildTurnConfigLabel({ model: 'claude-sonnet-4-6', effort: 'max' });
    expect(label).toBe('Sonnet 4.6 \u00b7 max effort');
  });

  it('combines all three parts', () => {
    const label = buildTurnConfigLabel({ model: 'claude-opus-4-6', effort: 'high', permissionMode: 'plan' });
    expect(label).toBe('Opus 4.6 (1M context) \u00b7 high effort \u00b7 plan mode');
  });

  it('handles Bedrock ARN in label', () => {
    const arn = 'arn:aws:bedrock:us-east-1:123:application-inference-profile/abc123';
    const label = buildTurnConfigLabel({ model: arn, effort: 'medium' });
    expect(label).toBe('Bedrock (abc123) \u00b7 medium effort');
  });

  it('handles unknown model in label', () => {
    const label = buildTurnConfigLabel({ model: 'custom-model-v1' });
    expect(label).toBe('custom-model-v1');
  });

  it('ignores non-plan permission modes', () => {
    const label = buildTurnConfigLabel({ permissionMode: 'full' });
    expect(label).toBeNull();
  });

  it('shows fast label when fastModeState is on', () => {
    const label = buildTurnConfigLabel({ model: 'claude-opus-4-6', fastModeState: 'on' });
    expect(label).toBe('Opus 4.6 (1M context) \u00b7 fast');
  });

  it('shows cooldown label when fastModeState is cooldown', () => {
    const label = buildTurnConfigLabel({ fastModeState: 'cooldown' });
    expect(label).toBe('fast (cooldown)');
  });

  it('omits fast label when fastModeState is off', () => {
    const label = buildTurnConfigLabel({ model: 'claude-opus-4-6', fastModeState: 'off' });
    expect(label).toBe('Opus 4.6 (1M context)');
  });
});

describe('toModelFamily', () => {
  it('returns "opus" for opus variants', () => {
    expect(toModelFamily('claude-opus-4-6')).toBe('opus');
    expect(toModelFamily('claude-opus-4')).toBe('opus');
    expect(toModelFamily('claude-opus-4-6[1m]')).toBe('opus');
  });

  it('returns "sonnet" for sonnet variants', () => {
    expect(toModelFamily('claude-sonnet-4-6')).toBe('sonnet');
    expect(toModelFamily('claude-sonnet-4-6-20260301')).toBe('sonnet');
  });

  it('returns "haiku" for haiku variants', () => {
    expect(toModelFamily('claude-haiku-4-5-20251001')).toBe('haiku');
  });

  it('returns full ID for unknown models', () => {
    expect(toModelFamily('custom-model')).toBe('custom-model');
    expect(toModelFamily('arn:aws:bedrock:us-east-1:123:profile/abc')).toBe('arn:aws:bedrock:us-east-1:123:profile/abc');
  });
});

describe('deduplicateByFamily', () => {
  it('collapses two opus variants into one, preferring catalog match', () => {
    const input = [
      { id: 'claude-opus-4', name: 'Opus (1M context)' },
      { id: 'claude-opus-4-6', name: 'Opus 4.6 (1M context)' },
    ];
    const result = deduplicateByFamily(input);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('claude-opus-4-6');
  });

  it('keeps first entry when both match catalog', () => {
    const input = [
      { id: 'claude-opus-4-6', name: 'Opus 4.6 (1M context)' },
      { id: 'claude-opus-4-6[1m]', name: 'Opus 4.6 (1M context)' },
    ];
    const result = deduplicateByFamily(input);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('claude-opus-4-6');
  });

  it('preserves different tiers', () => {
    const input = [
      { id: 'claude-opus-4-6', name: 'Opus 4.6' },
      { id: 'claude-sonnet-4-6', name: 'Sonnet 4.6' },
      { id: 'claude-haiku-4-5', name: 'Haiku 4.5' },
    ];
    expect(deduplicateByFamily(input)).toHaveLength(3);
  });

  it('does not collapse unknown models with different IDs', () => {
    const input = [
      { id: 'custom-model-a', name: 'Model A' },
      { id: 'custom-model-b', name: 'Model B' },
    ];
    expect(deduplicateByFamily(input)).toHaveLength(2);
  });
});

describe('buildDeduplicatedModelIds — family dedup', () => {
  it('collapses opus variants that produce different display names', () => {
    const dynamic = [
      { value: 'claude-opus-4-6', displayName: 'Claude Opus 4.6 (1M context)' },
      { value: 'claude-opus-4', displayName: 'Claude Opus (1M context)' },
      { value: 'claude-sonnet-4-6', displayName: 'Claude Sonnet 4.6' },
    ];
    const result = buildDeduplicatedModelIds(dynamic);
    const opusEntries = result.filter((id) => id.toLowerCase().includes('opus'));
    expect(opusEntries).toHaveLength(1);
    expect(opusEntries[0]).toBe('claude-opus-4-6');
  });
});
