import React from 'react';
import { useAppStore } from '@/stores/appStore';

// ---------------------------------------------------------------------------
// Short name mapping
// ---------------------------------------------------------------------------

/** Map known base model IDs → short display names (no "Claude" prefix). */
const SHORT_NAME_MAP: Record<string, string> = {
  'claude-opus-4-6': 'Opus 4.6',
  'claude-sonnet-4-6': 'Sonnet 4.6',
  'claude-haiku-4-5-20251001': 'Haiku 4.5',
  'claude-haiku-4-5': 'Haiku 4.5',
};

/** Models that should show a "NEW" badge in the selector. */
const NEW_MODEL_IDS = new Set(['claude-opus-4-6[1m]']);

/**
 * Convert an SDK model value + displayName to a short display name.
 *
 * Examples:
 *   ("claude-opus-4-6", "Claude Opus 4.6")        → "Opus 4.6"
 *   ("claude-opus-4-6[1m]", "Claude Opus 4.6 1M") → "Opus 4.6 1M"
 *   ("claude-sonnet-4-6-20260301", "Sonnet 4.6")   → "Sonnet 4.6"
 *   ("custom-model", "My Custom Model")             → "My Custom Model"
 */
export function toShortDisplayName(sdkValue: string, sdkDisplayName: string): string {
  const has1M = sdkValue.includes('[1m]');
  // Strip [1m] suffix and any trailing date (e.g. -20260301) to find the base ID
  const baseId = sdkValue.replace(/\[1m\]$/, '').replace(/-20\d{6}$/, '');

  let name = SHORT_NAME_MAP[baseId];
  if (!name) {
    // Fallback: strip "Claude " prefix from SDK display name
    name = sdkDisplayName.replace(/^Claude\s+/i, '');
  }
  if (has1M && !name.includes('1M')) {
    name += ' 1M';
  }
  return name;
}

/** Check whether a model should show the "NEW" badge. */
export function isNewModel(sdkValue: string): boolean {
  return NEW_MODEL_IDS.has(sdkValue);
}

/** Check whether an SDK entry is the "Default (recommended)" pseudo-model. */
export function isDefaultRecommended(sdkDisplayName: string): boolean {
  return /\bdefault\b/i.test(sdkDisplayName) || /\brecommended\b/i.test(sdkDisplayName);
}

// ---------------------------------------------------------------------------
// Static fallback models (used before SDK connects)
// ---------------------------------------------------------------------------

export const MODELS = [
  { id: 'claude-opus-4-6', name: 'Opus 4.6', provider: 'claude', supportsThinking: true, supportsEffort: true, supportsFastMode: true },
  { id: 'claude-sonnet-4-6', name: 'Sonnet 4.6', provider: 'claude', supportsThinking: true, supportsEffort: true, supportsFastMode: true },
  { id: 'claude-haiku-4-5-20251001', name: 'Haiku 4.5', provider: 'claude', supportsThinking: true, supportsEffort: false, supportsFastMode: false },
] as const;

export type ModelId = (typeof MODELS)[number]['id'];

// ---------------------------------------------------------------------------
// Deduplication
// ---------------------------------------------------------------------------

/**
 * Deduplicate an array of objects by a given field, keeping the first occurrence.
 */
export function deduplicateById<T extends { id: string }>(entries: T[]): T[] {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    if (seen.has(entry.id)) return false;
    seen.add(entry.id);
    return true;
  });
}

/** Deduplicate by name, keeping the first occurrence. */
export function deduplicateByName<T extends { name: string }>(entries: T[]): T[] {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    if (seen.has(entry.name)) return false;
    seen.add(entry.name);
    return true;
  });
}

/** SDK model entry as reported by the agent. */
interface SdkModelEntry {
  value: string;
  displayName: string;
  supportsAdaptiveThinking?: boolean;
  supportsEffort?: boolean;
  supportedEffortLevels?: ('low' | 'medium' | 'high' | 'max')[];
  supportsFastMode?: boolean;
}

/**
 * Build a deduplicated model ID list from SDK-reported models.
 * Filters out the "Default (recommended)" pseudo-model, deduplicates by ID,
 * then deduplicates by resolved display name (dated variants collapse).
 * Falls back to static MODELS when no SDK models are available.
 */
export function buildDeduplicatedModelIds(dynamic: SdkModelEntry[]): string[] {
  if (dynamic.length === 0) return MODELS.map((m) => m.id);
  const entries = deduplicateById(
    dynamic
      .filter((m) => !isDefaultRecommended(m.displayName))
      .map((m) => ({ id: m.value, name: toShortDisplayName(m.value, m.displayName) }))
  );
  return deduplicateByName(entries).map((e) => e.id);
}

// ---------------------------------------------------------------------------
// Model entry types
// ---------------------------------------------------------------------------

/** Model entry used for UI model selectors and keyboard shortcut cycling. */
export interface ModelEntry {
  id: string;
  name: string;
  icon: React.ComponentType<{ className?: string }>;
  supportsThinking: boolean;
  supportsEffort: boolean;
  supportedEffortLevels?: ('low' | 'medium' | 'high' | 'max')[];
  supportsFastMode?: boolean;
  isNew?: boolean;
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

// ---------------------------------------------------------------------------
// Model info lookups
// ---------------------------------------------------------------------------

/**
 * Get model info by ID. Checks SDK-reported dynamic models first,
 * falls back to hardcoded MODELS for offline/pre-connection state.
 */
export function getModelInfo(modelId: string): DynamicModelInfo | undefined {
  const dynamic = useAppStore.getState().supportedModels;
  const sdkModel = dynamic.find((m) => m.value === modelId);
  if (sdkModel) {
    return {
      id: sdkModel.value,
      name: toShortDisplayName(sdkModel.value, sdkModel.displayName),
      provider: 'claude',
      supportsThinking: sdkModel.supportsAdaptiveThinking ?? true,
      supportsEffort: sdkModel.supportsEffort ?? false,
      supportedEffortLevels: sdkModel.supportedEffortLevels,
      supportsFastMode: sdkModel.supportsFastMode,
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
