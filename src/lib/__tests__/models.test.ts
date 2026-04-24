import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock appStore before importing models
vi.mock('@/stores/appStore', () => ({
  useAppStore: {
    getState: () => ({
      supportedModels: [],
    }),
  },
}));

const { getModelDisplayName, getModelInfo, getModelDescription, buildTurnConfigLabel, MODELS, toShortDisplayName, buildStaticModelList, supportsExtendedContext } = await import('../models');

describe('getModelDisplayName', () => {
  it('returns short display name for known static models', () => {
    expect(getModelDisplayName('claude-opus-4-7')).toBe('Opus 4.7 (1M context)');
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
    expect(toShortDisplayName('claude-opus-4-7', 'Claude Opus 4.7')).toBe('Opus 4.7 (1M context)');
    expect(toShortDisplayName('claude-sonnet-4-6', 'Claude Sonnet 4.6')).toBe('Sonnet 4.6');
    expect(toShortDisplayName('claude-haiku-4-5-20251001', 'Claude Haiku 4.5')).toBe('Haiku 4.5');
  });

  it('returns same canonical name for extended context variant', () => {
    expect(toShortDisplayName('claude-opus-4-7[1m]', 'Claude Opus 4.7 1M')).toBe('Opus 4.7 (1M context)');
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
    expect(getModelDescription('claude-opus-4-7')).toBe('Most capable for ambitious work');
    expect(getModelDescription('claude-sonnet-4-6')).toBe('Most efficient for everyday tasks');
    expect(getModelDescription('claude-haiku-4-5-20251001')).toBe('Fastest for quick answers');
  });

  it('returns same description for extended context variant', () => {
    expect(getModelDescription('claude-opus-4-7[1m]')).toBe('Most capable for ambitious work');
  });

  it('returns undefined for unknown models', () => {
    expect(getModelDescription('custom-model')).toBeUndefined();
  });
});

describe('supportsExtendedContext', () => {
  it('returns true for 1M-capable families regardless of suffix', () => {
    expect(supportsExtendedContext('claude-opus-4-7')).toBe(true);
    expect(supportsExtendedContext('claude-opus-4-7[1m]')).toBe(true);
    expect(supportsExtendedContext('claude-opus-4-7-20260101')).toBe(true);
    expect(supportsExtendedContext('claude-opus-4-6')).toBe(true);
    expect(supportsExtendedContext('claude-opus-4-6[1m]')).toBe(true);
    expect(supportsExtendedContext('claude-opus-4-6-20251022')).toBe(true);
    expect(supportsExtendedContext('claude-sonnet-4-6')).toBe(true);
    expect(supportsExtendedContext('claude-sonnet-4-6[1m]')).toBe(true);
    expect(supportsExtendedContext('claude-sonnet-4-6-20251022')).toBe(true);
  });

  it('returns false for non-1M models', () => {
    expect(supportsExtendedContext('claude-haiku-4-5-20251001')).toBe(false);
    expect(supportsExtendedContext('claude-haiku-4-5')).toBe(false);
    expect(supportsExtendedContext('unknown-model')).toBe(false);
    expect(supportsExtendedContext('')).toBe(false);
  });
});

describe('getModelInfo', () => {
  it('returns info for known static models', () => {
    const opus = getModelInfo('claude-opus-4-7');
    expect(opus).toBeDefined();
    expect(opus!.id).toBe('claude-opus-4-7');
    expect(opus!.name).toBe('Opus 4.7 (1M context)');
    expect(opus!.description).toBe('Most capable for ambitious work');
    expect(opus!.supportsThinking).toBe(true);
    expect(opus!.supportsEffort).toBe(true);
  });

  it('returns undefined for unknown model IDs', () => {
    expect(getModelInfo('not-a-real-model')).toBeUndefined();
  });

  it('resolves variant model IDs with [1m] suffix', () => {
    const info = getModelInfo('claude-opus-4-7[1m]');
    expect(info).toBeDefined();
    expect(info!.id).toBe('claude-opus-4-7');
    expect(info!.name).toBe('Opus 4.7 (1M context)');
    expect(info!.supportsThinking).toBe(true);
  });

  it('resolves variant model IDs with date suffix', () => {
    const info = getModelInfo('claude-sonnet-4-6-20260301');
    expect(info).toBeDefined();
    expect(info!.id).toBe('claude-sonnet-4-6');
    expect(info!.name).toBe('Sonnet 4.6');
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
          value: 'claude-opus-4-7',
          displayName: 'Claude Opus 4.7',
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
      const opus = getModelInfo('claude-opus-4-7');
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
    expect(buildTurnConfigLabel({ model: 'claude-opus-4-7' })).toBe('Opus 4.7 (1M context)');
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
    const label = buildTurnConfigLabel({ model: 'claude-opus-4-7', effort: 'high', permissionMode: 'plan' });
    expect(label).toBe('Opus 4.7 (1M context) \u00b7 high effort \u00b7 plan mode');
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
    const label = buildTurnConfigLabel({ model: 'claude-opus-4-7', fastModeState: 'on' });
    expect(label).toBe('Opus 4.7 (1M context) \u00b7 fast');
  });

  it('shows cooldown label when fastModeState is cooldown', () => {
    const label = buildTurnConfigLabel({ fastModeState: 'cooldown' });
    expect(label).toBe('fast (cooldown)');
  });

  it('omits fast label when fastModeState is off', () => {
    const label = buildTurnConfigLabel({ model: 'claude-opus-4-7', fastModeState: 'off' });
    expect(label).toBe('Opus 4.7 (1M context)');
  });
});

describe('buildStaticModelList', () => {
  it('returns static entries with defaults when SDK models is empty', () => {
    const result = buildStaticModelList([]);
    expect(result).toHaveLength(MODELS.length);
    expect(result[0].id).toBe('claude-opus-4-7');
    expect(result[0].name).toBe('Opus 4.7 (1M context)');
    expect(result[0].supportsEffort).toBe(true);
    expect(result[0].supportsFastMode).toBe(true);
  });

  it('enriches capabilities from SDK models', () => {
    const sdkModels = [
      {
        value: 'claude-opus-4-7',
        displayName: 'Claude Opus 4.7',
        supportsAdaptiveThinking: true,
        supportsEffort: true,
        supportedEffortLevels: ['low', 'medium', 'high', 'max'] as const,
        supportsFastMode: true,
      },
    ];
    const result = buildStaticModelList(sdkModels);
    const opus = result.find((m) => m.id === 'claude-opus-4-7')!;
    expect(opus.supportsEffort).toBe(true);
    expect(opus.supportedEffortLevels).toEqual(['low', 'medium', 'high', 'max']);
    expect(opus.supportsFastMode).toBe(true);
  });

  it('matches SDK variants with [1m] suffix to catalog entries', () => {
    const sdkModels = [
      {
        value: 'claude-opus-4-7[1m]',
        displayName: 'Claude Opus 4.7 1M',
        supportsEffort: true,
        supportedEffortLevels: ['low', 'high'] as const,
      },
    ];
    const result = buildStaticModelList(sdkModels);
    const opus = result.find((m) => m.id === 'claude-opus-4-7')!;
    expect(opus.supportedEffortLevels).toEqual(['low', 'high']);
  });

  it('matches SDK variants with date suffix to catalog entries', () => {
    const sdkModels = [
      {
        value: 'claude-haiku-4-5-20251001',
        displayName: 'Claude Haiku 4.5',
        supportsAdaptiveThinking: false,
        supportsEffort: false,
        supportsFastMode: false,
      },
    ];
    const result = buildStaticModelList(sdkModels);
    const haiku = result.find((m) => m.id === 'claude-haiku-4-5-20251001')!;
    expect(haiku.supportsThinking).toBe(false);
    expect(haiku.supportsFastMode).toBe(false);
  });

  it('does not add unknown SDK models to the list', () => {
    const sdkModels = [
      { value: 'claude-opus-4', displayName: 'Claude Opus (1M context)' },
      { value: 'claude-opus-4-7', displayName: 'Claude Opus 4.7 (1M context)' },
      { value: 'some-unknown-model', displayName: 'Unknown Model' },
    ];
    const result = buildStaticModelList(sdkModels);
    expect(result).toHaveLength(MODELS.length);
    expect(result.find((m) => m.id === 'some-unknown-model')).toBeUndefined();
  });

  it('always returns models in catalog order', () => {
    const sdkModels = [
      { value: 'claude-haiku-4-5-20251001', displayName: 'Claude Haiku 4.5' },
      { value: 'claude-opus-4-7', displayName: 'Claude Opus 4.7' },
      { value: 'claude-sonnet-4-6', displayName: 'Claude Sonnet 4.6' },
    ];
    const result = buildStaticModelList(sdkModels);
    expect(result[0].id).toBe('claude-opus-4-7');
    expect(result[1].id).toBe('claude-sonnet-4-6');
    expect(result[2].id).toBe('claude-haiku-4-5-20251001');
  });

  it('never shows duplicate opus entries regardless of SDK variants', () => {
    const sdkModels = [
      { value: 'claude-opus-4-7', displayName: 'Claude Opus 4.7 (1M context)' },
      { value: 'claude-opus-4-7[1m]', displayName: 'Claude Opus 4.7 1M' },
      { value: 'claude-opus-4', displayName: 'Claude Opus (1M context)' },
    ];
    const result = buildStaticModelList(sdkModels);
    const opusEntries = result.filter((m) => m.id.includes('opus'));
    expect(opusEntries).toHaveLength(1);
    expect(opusEntries[0].id).toBe('claude-opus-4-7');
  });
});

