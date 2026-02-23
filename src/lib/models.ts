import { useAppStore } from '@/stores/appStore';

/** Static fallback model definitions used when no agent is connected. */
export const MODELS = [
  { id: 'claude-opus-4-6', name: 'Claude Opus 4.6', provider: 'claude', supportsThinking: true, supportsEffort: true },
  { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', provider: 'claude', supportsThinking: true, supportsEffort: true },
  { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5', provider: 'claude', supportsThinking: true, supportsEffort: false },
] as const;

export type ModelId = (typeof MODELS)[number]['id'];

export interface DynamicModelInfo {
  id: string;
  name: string;
  provider: string;
  supportsThinking: boolean;
  supportsEffort: boolean;
  supportedEffortLevels?: ('low' | 'medium' | 'high' | 'max')[];
}

/**
 * Get model info by ID. Checks SDK-reported dynamic models first,
 * falls back to hardcoded MODELS for offline/pre-connection state.
 */
export function getModelInfo(modelId: string): DynamicModelInfo | undefined {
  // Check dynamic models from SDK
  const dynamic = useAppStore.getState().supportedModels;
  const sdkModel = dynamic.find((m) => m.value === modelId);
  if (sdkModel) {
    return {
      id: sdkModel.value,
      name: sdkModel.displayName,
      provider: 'claude',
      supportsThinking: sdkModel.supportsAdaptiveThinking ?? true,
      supportsEffort: sdkModel.supportsEffort ?? false,
      supportedEffortLevels: sdkModel.supportedEffortLevels,
    };
  }

  // Fallback to hardcoded
  const staticModel = MODELS.find((m) => m.id === modelId);
  if (staticModel) {
    return {
      id: staticModel.id,
      name: staticModel.name,
      provider: staticModel.provider,
      supportsThinking: staticModel.supportsThinking,
      supportsEffort: staticModel.supportsEffort,
    };
  }

  return undefined;
}

export function getModelDisplayName(modelId: string): string {
  return getModelInfo(modelId)?.name ?? modelId;
}
