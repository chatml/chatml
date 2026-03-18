import React from 'react';
import { useAppStore } from '@/stores/appStore';

/** Sentinel model ID meaning "let the SDK choose the best model". */
export const AUTO_MODEL_ID = 'auto';

/** Static fallback model definitions used when no agent is connected. */
export const MODELS = [
  { id: 'claude-opus-4-6', name: 'Claude Opus 4.6', provider: 'claude', supportsThinking: true, supportsEffort: true, supportsFastMode: true },
  { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', provider: 'claude', supportsThinking: true, supportsEffort: true, supportsFastMode: true },
  { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5', provider: 'claude', supportsThinking: true, supportsEffort: false, supportsFastMode: false },
] as const;

export type ModelId = (typeof MODELS)[number]['id'];

/** Check whether an SDK display name represents the auto/default model. */
export function isAutoModel(sdkDisplayName: string): boolean {
  return /\bdefault\b/i.test(sdkDisplayName) || /\brecommended\b/i.test(sdkDisplayName);
}

/**
 * Resolve a clean display name for an SDK-reported model.
 * - SDK "Default (recommended)" → "Auto"
 * - Known static models → our clean name (e.g. "Claude Opus 4.6")
 * - Unknown models → SDK displayName as-is
 */
export function resolveModelName(sdkValue: string, sdkDisplayName: string): string {
  if (isAutoModel(sdkDisplayName) || sdkValue === AUTO_MODEL_ID) {
    return 'Auto';
  }
  const staticMatch = MODELS.find((m) => m.id === sdkValue);
  if (staticMatch) return staticMatch.name;
  return sdkDisplayName;
}

/**
 * Normalize an SDK-reported model value to the canonical ID used in the UI.
 * Models matching the "auto/default/recommended" heuristic map to AUTO_MODEL_ID.
 */
export function normalizeModelId(m: { value: string; displayName: string }): string {
  return isAutoModel(m.displayName) || m.value === AUTO_MODEL_ID ? AUTO_MODEL_ID : m.value;
}

/**
 * Deduplicate an array of objects by their `id` field, keeping the first occurrence.
 * The SDK may report the same logical model under multiple entries (e.g. both
 * "Default (recommended)" and the explicit auto sentinel).
 */
export function deduplicateById<T extends { id: string }>(entries: T[]): T[] {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    if (seen.has(entry.id)) return false;
    seen.add(entry.id);
    return true;
  });
}

/** Model entry used for UI model selectors and keyboard shortcut cycling. */
export interface ModelEntry {
  id: string;
  name: string;
  icon: React.ComponentType<{ className?: string }>;
  supportsThinking: boolean;
  supportsEffort: boolean;
  supportedEffortLevels?: ('low' | 'medium' | 'high' | 'max')[];
  supportsFastMode?: boolean;
}

export interface DynamicModelInfo {
  id: string;
  name: string;
  provider: string;
  supportsThinking: boolean;
  supportsEffort: boolean;
  supportedEffortLevels?: ('low' | 'medium' | 'high' | 'max')[];
  supportsFastMode?: boolean;
}

/**
 * Get model info by ID. Checks SDK-reported dynamic models first,
 * falls back to hardcoded MODELS for offline/pre-connection state.
 */
export function getModelInfo(modelId: string): DynamicModelInfo | undefined {
  // Check dynamic models from SDK
  const dynamic = useAppStore.getState().supportedModels;
  // For 'auto', find the SDK's default/recommended model
  const sdkModel = modelId === AUTO_MODEL_ID
    ? dynamic.find((m) => isAutoModel(m.displayName))
    : dynamic.find((m) => m.value === modelId);
  if (sdkModel) {
    return {
      id: modelId === AUTO_MODEL_ID ? AUTO_MODEL_ID : sdkModel.value,
      name: resolveModelName(sdkModel.value, sdkModel.displayName),
      provider: 'claude',
      supportsThinking: sdkModel.supportsAdaptiveThinking ?? true,
      supportsEffort: sdkModel.supportsEffort ?? false,
      supportedEffortLevels: sdkModel.supportedEffortLevels,
      supportsFastMode: sdkModel.supportsFastMode,
    };
  }

  // Auto fallback when SDK hasn't connected yet
  if (modelId === AUTO_MODEL_ID) {
    return {
      id: AUTO_MODEL_ID,
      name: 'Auto',
      provider: 'claude',
      supportsThinking: true,
      supportsEffort: true,
      supportsFastMode: true,
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
      supportsFastMode: staticModel.supportsFastMode,
    };
  }

  return undefined;
}

export function getModelDisplayName(modelId: string): string {
  if (modelId === AUTO_MODEL_ID) return 'Auto';
  const info = getModelInfo(modelId);
  if (info) return info.name;

  // Handle Bedrock inference profile ARNs (e.g. "arn:aws:bedrock:us-east-1:...:application-inference-profile/abc123")
  if (modelId.startsWith('arn:aws:bedrock:')) {
    const parts = modelId.split('/');
    return `Bedrock (${parts[parts.length - 1]})`;
  }

  return modelId;
}

/** Build the turn-start config label from init event metadata. */
export function buildTurnConfigLabel(meta: { model?: string; effort?: string; permissionMode?: string; fastModeState?: 'off' | 'cooldown' | 'on' }): string | null {
  const parts: string[] = [];
  if (meta.model) parts.push(getModelDisplayName(meta.model));
  if (meta.effort) parts.push(`${meta.effort} effort`);
  if (meta.fastModeState === 'on') parts.push('fast');
  else if (meta.fastModeState === 'cooldown') parts.push('fast (cooldown)');
  if (meta.permissionMode === 'plan') parts.push('plan mode');
  return parts.length > 0 ? parts.join(' \u00b7 ') : null;
}
