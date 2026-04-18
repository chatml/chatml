import React from 'react';
import { useAppStore } from '@/stores/appStore';
import { SHOW_UNRELEASED } from './constants';

// ---------------------------------------------------------------------------
// Canonical model catalog — single source of truth for display names & descriptions
// ---------------------------------------------------------------------------

interface ModelCatalogEntry {
  displayName: string;
  description: string;
}

/** Canonical display names and descriptions, keyed by base model ID. */
const MODEL_CATALOG: Record<string, ModelCatalogEntry> = {
  // Cloud models (Anthropic)
  'claude-opus-4-6':   { displayName: 'Opus 4.6 (1M context)', description: 'Most capable for ambitious work' },
  'claude-sonnet-4-6': { displayName: 'Sonnet 4.6',            description: 'Most efficient for everyday tasks' },
  'claude-haiku-4-5':  { displayName: 'Haiku 4.5',             description: 'Fastest for quick answers' },
  // Local models (Ollama) — keep in sync with backend/ollama/models.go
  'gemma-4-e2b':       { displayName: 'Gemma 4 E2B',           description: 'Ultra-light local model (2B)' },
  'gemma-4-e4b':       { displayName: 'Gemma 4 E4B',           description: 'Fast local model (4B)' },
  'gemma-4-27b':       { displayName: 'Gemma 4 27B',           description: 'Local MoE model (4B active)' },
  'gemma-4-31b':       { displayName: 'Gemma 4 31B',           description: 'Most capable local model' },
};

/**
 * Normalize an SDK model value to a base ID for catalog lookup.
 * Strips `[1m]` suffix and trailing date `-20YYMMDD`.
 */
function toBaseId(sdkValue: string): string {
  return sdkValue.replace(/\[1m\]$/, '').replace(/-20\d{6}$/, '');
}

/** Look up the catalog entry for an SDK model value. */
function catalogLookup(sdkValue: string): ModelCatalogEntry | undefined {
  return MODEL_CATALOG[toBaseId(sdkValue)];
}

// ---------------------------------------------------------------------------
// Display name & description helpers
// ---------------------------------------------------------------------------

/**
 * Convert an SDK model value + displayName to a short display name.
 * Uses the canonical catalog first, falls back to stripping "Claude " prefix.
 */
export function toShortDisplayName(sdkValue: string, sdkDisplayName: string): string {
  const entry = catalogLookup(sdkValue);
  if (entry) return entry.displayName;
  // Fallback for unknown models: strip "Claude " prefix
  return sdkDisplayName.replace(/^Claude\s+/i, '');
}

/** Get the canonical description for a model, or undefined for unknown models. */
export function getModelDescription(sdkValue: string): string | undefined {
  return catalogLookup(sdkValue)?.description;
}

// ---------------------------------------------------------------------------
// Static curated models — single source of truth for the model selector
// ---------------------------------------------------------------------------

// Note: Haiku uses a dated id ('claude-haiku-4-5-20251001') that differs from
// its catalog key ('claude-haiku-4-5'). This is intentional — the SDK reports
// the dated variant and stored user settings reference it. catalogLookup via
// toBaseId handles the mapping transparently.
const ALL_MODELS = [
  // Cloud models
  { id: 'claude-opus-4-6', name: MODEL_CATALOG['claude-opus-4-6'].displayName, description: MODEL_CATALOG['claude-opus-4-6'].description, provider: 'claude' as const, supportsThinking: true, supportsEffort: true, supportsFastMode: true },
  { id: 'claude-sonnet-4-6', name: MODEL_CATALOG['claude-sonnet-4-6'].displayName, description: MODEL_CATALOG['claude-sonnet-4-6'].description, provider: 'claude' as const, supportsThinking: true, supportsEffort: true, supportsFastMode: true },
  { id: 'claude-haiku-4-5-20251001', name: MODEL_CATALOG['claude-haiku-4-5'].displayName, description: MODEL_CATALOG['claude-haiku-4-5'].description, provider: 'claude' as const, supportsThinking: true, supportsEffort: false, supportsFastMode: false },
  // Local models
  { id: 'gemma-4-e2b', name: MODEL_CATALOG['gemma-4-e2b'].displayName, description: MODEL_CATALOG['gemma-4-e2b'].description, provider: 'ollama' as const, supportsThinking: false, supportsEffort: false, supportsFastMode: false },
  { id: 'gemma-4-e4b', name: MODEL_CATALOG['gemma-4-e4b'].displayName, description: MODEL_CATALOG['gemma-4-e4b'].description, provider: 'ollama' as const, supportsThinking: false, supportsEffort: false, supportsFastMode: false },
  { id: 'gemma-4-27b', name: MODEL_CATALOG['gemma-4-27b'].displayName, description: MODEL_CATALOG['gemma-4-27b'].description, provider: 'ollama' as const, supportsThinking: false, supportsEffort: false, supportsFastMode: false },
  { id: 'gemma-4-31b', name: MODEL_CATALOG['gemma-4-31b'].displayName, description: MODEL_CATALOG['gemma-4-31b'].description, provider: 'ollama' as const, supportsThinking: false, supportsEffort: false, supportsFastMode: false },
] as const;

export const MODELS: ReadonlyArray<(typeof ALL_MODELS)[number]> = SHOW_UNRELEASED
  ? ALL_MODELS
  : ALL_MODELS.filter((m) => m.provider !== 'ollama');

export type ModelId = (typeof ALL_MODELS)[number]['id'];

export type ModelProvider = 'claude' | 'ollama';

// ---------------------------------------------------------------------------
// SDK types & static model list builder
// ---------------------------------------------------------------------------

/** SDK model entry as reported by the agent. */
export interface SdkModelEntry {
  value: string;
  displayName: string;
  supportsAdaptiveThinking?: boolean;
  supportsEffort?: boolean;
  supportedEffortLevels?: ('low' | 'medium' | 'high' | 'max')[];
  supportsFastMode?: boolean;
}

/** Entry returned by buildStaticModelList — the curated model list enriched with SDK capabilities. */
export interface StaticModelEntry {
  id: string;
  name: string;
  description: string;
  provider: ModelProvider;
  supportsThinking: boolean;
  supportsEffort: boolean;
  supportedEffortLevels?: ('low' | 'medium' | 'high' | 'max')[];
  supportsFastMode: boolean;
}

/** Merge SDK-reported capabilities into a static model entry's defaults. */
function enrichWithSdk(staticModel: (typeof MODELS)[number], sdkModel?: SdkModelEntry) {
  return {
    supportsThinking: sdkModel?.supportsAdaptiveThinking ?? staticModel.supportsThinking,
    supportsEffort: sdkModel?.supportsEffort ?? staticModel.supportsEffort,
    supportedEffortLevels: sdkModel?.supportedEffortLevels,
    supportsFastMode: sdkModel?.supportsFastMode ?? staticModel.supportsFastMode,
  };
}

/**
 * Build the model list from the static catalog, enriched with SDK-reported capabilities.
 * The static MODELS array is always the source of truth for which models appear in the UI.
 * SDK data is only used to update capability flags (supportsEffort, supportsFastMode, etc.).
 */
export function buildStaticModelList(sdkModels: SdkModelEntry[]): StaticModelEntry[] {
  // Index SDK models by base ID for O(1) lookup
  const sdkByBase = new Map<string, SdkModelEntry>();
  for (const m of sdkModels) {
    const base = toBaseId(m.value);
    if (!sdkByBase.has(base)) sdkByBase.set(base, m);
  }

  return MODELS.map((staticModel) => {
    const sdk = sdkByBase.get(toBaseId(staticModel.id));
    return {
      id: staticModel.id,
      name: staticModel.name,
      description: staticModel.description,
      provider: staticModel.provider,
      ...enrichWithSdk(staticModel, sdk),
    };
  });
}

// ---------------------------------------------------------------------------
// Model entry types
// ---------------------------------------------------------------------------

/** Model entry used for UI model selectors and keyboard shortcut cycling. */
export interface ModelEntry {
  id: string;
  name: string;
  description?: string;
  icon: React.ComponentType<{ className?: string }>;
  provider?: ModelProvider;
  supportsThinking: boolean;
  supportsEffort: boolean;
  supportedEffortLevels?: ('low' | 'medium' | 'high' | 'max')[];
  supportsFastMode?: boolean;
}

export interface DynamicModelInfo {
  id: string;
  name: string;
  description?: string;
  provider: string;
  supportsThinking: boolean;
  supportsEffort: boolean;
  supportedEffortLevels?: ('low' | 'medium' | 'high' | 'max')[];
  supportsFastMode?: boolean;
}

// ---------------------------------------------------------------------------
// Local model detection
// ---------------------------------------------------------------------------

/** Local model IDs — derived from the MODELS array to stay in sync automatically. */
const LOCAL_MODEL_IDS: Set<string> = new Set(
  MODELS.filter(m => m.provider === 'ollama').map(m => m.id)
);

/** Check whether a model ID refers to a locally-run model (Ollama). */
export function isLocalModel(modelId: string): boolean {
  return LOCAL_MODEL_IDS.has(modelId) || modelId.startsWith('ollama/');
}

// ---------------------------------------------------------------------------
// Model info lookups
// ---------------------------------------------------------------------------

/**
 * Get model info by ID. Starts from the static catalog and enriches with
 * SDK-reported capabilities when available. Uses toBaseId() matching so
 * SDK variants (e.g. claude-opus-4-6[1m]) resolve to catalog entries.
 */
export function getModelInfo(modelId: string): DynamicModelInfo | undefined {
  // Match by base ID so variant suffixes ([1m], -20YYMMDD) resolve correctly
  const baseId = toBaseId(modelId);
  const staticModel = MODELS.find((m) => toBaseId(m.id) === baseId);
  if (staticModel) {
    // Enrich with SDK capabilities when available
    const dynamic = useAppStore.getState().supportedModels;
    const sdkModel = dynamic.find((m) => toBaseId(m.value) === baseId);
    return {
      id: staticModel.id,
      name: staticModel.name,
      description: staticModel.description,
      provider: staticModel.provider,
      ...enrichWithSdk(staticModel, sdkModel),
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
export function buildTurnConfigLabel(meta: { model?: string; effort?: string; permissionMode?: string; fastModeState?: 'off' | 'cooldown' | 'on'; backendType?: string }): string | null {
  const parts: string[] = [];
  const info = meta.model ? getModelInfo(meta.model) : undefined;
  if (meta.model) parts.push(getModelDisplayName(meta.model));
  // Only show effort/fast when the model actually supports them
  if ((info?.supportsEffort !== false) && meta.effort) parts.push(`${meta.effort} effort`);
  if (info?.supportsFastMode !== false) {
    if (meta.fastModeState === 'on') parts.push('fast');
    else if (meta.fastModeState === 'cooldown') parts.push('fast (cooldown)');
  }
  if (meta.permissionMode === 'plan') parts.push('plan mode');
  if (meta.backendType === 'native') parts.push('ChatML Code');
  return parts.length > 0 ? parts.join(' \u00b7 ') : null;
}
