import React from 'react';
import { useAppStore } from '@/stores/appStore';

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

/** Check whether an SDK entry is the "Default (recommended)" pseudo-model. */
export function isDefaultRecommended(sdkDisplayName: string): boolean {
  return /\bdefault\b/i.test(sdkDisplayName) || /\brecommended\b/i.test(sdkDisplayName);
}

// ---------------------------------------------------------------------------
// Static fallback models (used before SDK connects)
// ---------------------------------------------------------------------------

// Note: Haiku uses a dated id ('claude-haiku-4-5-20251001') that differs from
// its catalog key ('claude-haiku-4-5'). This is intentional — the SDK reports
// the dated variant and stored user settings reference it. catalogLookup via
// toBaseId handles the mapping transparently.
export const MODELS = [
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

/**
 * Extract model family key for dedup: all Opus variants → 'opus',
 * Sonnet → 'sonnet', Haiku → 'haiku'.
 * Unknown models keep their full ID as family key (no aggressive collapsing).
 */
export function toModelFamily(id: string): string {
  const lower = id.toLowerCase();
  if (!lower.startsWith('claude-')) return id;
  if (lower.includes('opus')) return 'opus';
  if (lower.includes('sonnet')) return 'sonnet';
  if (lower.includes('haiku')) return 'haiku';
  return id;
}

/**
 * Deduplicate by model family (opus/sonnet/haiku), keeping the best entry
 * per family. When two entries share a family, prefers the one with a catalog
 * match. This catches variants with different IDs AND different display names
 * that belong to the same family (e.g., claude-opus-4 vs claude-opus-4-6).
 */
export function deduplicateByFamily<T extends { id: string }>(entries: T[]): T[] {
  const familyMap = new Map<string, T>();
  for (const entry of entries) {
    const family = toModelFamily(entry.id);
    if (!familyMap.has(family)) {
      familyMap.set(family, entry);
    } else {
      // Prefer the entry that matches the catalog (has a canonical display name)
      const existing = familyMap.get(family)!;
      if (!catalogLookup(existing.id) && catalogLookup(entry.id)) {
        familyMap.set(family, entry);
      }
    }
  }
  return entries.filter((entry) => familyMap.get(toModelFamily(entry.id)) === entry);
}

/** Tier rank for sorting: Opus=0, Sonnet=1, Haiku=2, unknown cloud=3, local=4+ */
function modelTierRank(id: string): number {
  const family = toModelFamily(id);
  if (family === 'opus') return 0;
  if (family === 'sonnet') return 1;
  if (family === 'haiku') return 2;
  const lower = id.toLowerCase();
  if (lower.startsWith('gemma-')) return 4;
  if (lower.startsWith('ollama/')) return 5;
  return 3;
}

/** Sort model entries by tier (Opus → Sonnet → Haiku), then by ID for stability. */
export function sortModelEntries<T extends { id: string }>(entries: T[]): T[] {
  return [...entries].sort((a, b) => {
    const rankDiff = modelTierRank(a.id) - modelTierRank(b.id);
    if (rankDiff !== 0) return rankDiff;
    return a.id.localeCompare(b.id);
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
 * then by resolved display name, then by model family (opus/sonnet/haiku).
 * Falls back to static MODELS when no SDK models are available.
 */
export function buildDeduplicatedModelIds(dynamic: SdkModelEntry[]): string[] {
  if (dynamic.length === 0) return MODELS.map((m) => m.id);
  const entries = deduplicateById(
    dynamic
      .filter((m) => !isDefaultRecommended(m.displayName))
      .map((m) => ({ id: m.value, name: toShortDisplayName(m.value, m.displayName) }))
  );
  return deduplicateByFamily(deduplicateByName(entries)).map((e) => e.id);
}

// ---------------------------------------------------------------------------
// Model entry types
// ---------------------------------------------------------------------------

export type ModelProvider = 'claude' | 'ollama';

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
      description: getModelDescription(sdkModel.value),
      provider: isLocalModel(sdkModel.value) ? 'ollama' : 'claude',
      supportsThinking: sdkModel.supportsAdaptiveThinking ?? !isLocalModel(sdkModel.value),
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
      description: staticModel.description,
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
