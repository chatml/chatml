import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock appStore before importing models
vi.mock('@/stores/appStore', () => ({
  useAppStore: {
    getState: () => ({
      supportedModels: [],
    }),
  },
}));

const { getModelDisplayName, getModelInfo, buildTurnConfigLabel, MODELS } = await import('../models');

describe('getModelDisplayName', () => {
  it('returns display name for known static models', () => {
    expect(getModelDisplayName('claude-opus-4-6')).toBe('Claude Opus 4.6');
    expect(getModelDisplayName('claude-sonnet-4-6')).toBe('Claude Sonnet 4.6');
    expect(getModelDisplayName('claude-haiku-4-5-20251001')).toBe('Claude Haiku 4.5');
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

describe('getModelInfo', () => {
  it('returns info for known static models', () => {
    const opus = getModelInfo('claude-opus-4-6');
    expect(opus).toBeDefined();
    expect(opus!.id).toBe('claude-opus-4-6');
    expect(opus!.name).toBe('Claude Opus 4.6');
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
      expect(info!.provider).toBe('claude');
      expect(info!.supportsThinking).toBe(model.supportsThinking);
      expect(info!.supportsEffort).toBe(model.supportsEffort);
    }
  });
});

describe('buildTurnConfigLabel', () => {
  it('returns null for empty metadata', () => {
    expect(buildTurnConfigLabel({})).toBeNull();
  });

  it('returns model display name only', () => {
    expect(buildTurnConfigLabel({ model: 'claude-opus-4-6' })).toBe('Claude Opus 4.6');
  });

  it('returns effort only', () => {
    expect(buildTurnConfigLabel({ effort: 'high' })).toBe('high effort');
  });

  it('returns plan mode indicator', () => {
    expect(buildTurnConfigLabel({ permissionMode: 'plan' })).toBe('plan mode');
  });

  it('combines model and effort with separator', () => {
    const label = buildTurnConfigLabel({ model: 'claude-sonnet-4-6', effort: 'max' });
    expect(label).toBe('Claude Sonnet 4.6 \u00b7 max effort');
  });

  it('combines all three parts', () => {
    const label = buildTurnConfigLabel({ model: 'claude-opus-4-6', effort: 'high', permissionMode: 'plan' });
    expect(label).toBe('Claude Opus 4.6 \u00b7 high effort \u00b7 plan mode');
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
});
