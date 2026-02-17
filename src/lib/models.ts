export const MODELS = [
  { id: 'claude-opus-4-6', name: 'Claude Opus 4.6', supportsThinking: true, supportsEffort: true },
  { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', supportsThinking: true, supportsEffort: true },
  { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5', supportsThinking: true, supportsEffort: false },
] as const;

export type ModelId = (typeof MODELS)[number]['id'];

export function getModelInfo(modelId: string) {
  return MODELS.find((m) => m.id === modelId);
}

export function getModelDisplayName(modelId: string): string {
  return getModelInfo(modelId)?.name ?? modelId;
}
