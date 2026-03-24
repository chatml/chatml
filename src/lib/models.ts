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
  'claude-opus-4-6':   { displayName: 'Opus 4.6 (1M context)', description: 'Most capable for ambitious work' },
  'claude-sonnet-4-6': { displayName: 'Sonnet 4.6',            description: 'Most efficient for everyday tasks' },
  'claude-haiku-4-5':  { displayName: 'Haiku 4.5',             description: 'Fastest for quick answers' },
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
  { id: 'claude-opus-4-6', name: MODEL_CATALOG['claude-opus-4-6'].displayName, description: MODEL_CATALOG['claude-opus-4-6'].description, provider: 'claude', supportsThinking: true, supportsEffort: true, supportsFastMode: true },
  { id: 'claude-sonnet-4-6', name: MODEL_CATALOG['claude-sonnet-4-6'].displayName, description: MODEL_CATALOG['claude-sonnet-4-6'].description, provider: 'claude', supportsThinking: true, supportsEffort: true, supportsFastMode: true },
  { id: 'claude-haiku-4-5-20251001', name: MODEL_CATALOG['claude-haiku-4-5'].displayName, description: MODEL_CATALOG['claude-haiku-4-5'].description, provider: 'claude', supportsThinking: true, supportsEffort: false, supportsFastMode: false },
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

/** Tier rank for sorting: Opus=0, Sonnet=1, Haiku=2, unknown=3 */
function modelTierRank(id: string): number {
  const lower = id.toLowerCase();
  if (lower.includes('opus')) return 0;
  if (lower.includes('sonnet')) return 1;
  if (lower.includes('haiku')) return 2;
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
  description?: string;
  icon: React.ComponentType<{ className?: string }>;
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
export function buildTurnConfigLabel(meta: { model?: string; effort?: string; permissionMode?: string; fastModeState?: 'off' | 'cooldown' | 'on' }): string | null {
  const parts: string[] = [];
  if (meta.model) parts.push(getModelDisplayName(meta.model));
  if (meta.effort) parts.push(`${meta.effort} effort`);
  if (meta.fastModeState === 'on') parts.push('fast');
  else if (meta.fastModeState === 'cooldown') parts.push('fast (cooldown)');
  if (meta.permissionMode === 'plan') parts.push('plan mode');
  return parts.length > 0 ? parts.join(' \u00b7 ') : null;
}
