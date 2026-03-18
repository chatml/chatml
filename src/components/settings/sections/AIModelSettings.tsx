'use client';

import { useState, useEffect, useMemo } from 'react';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Eye, EyeOff } from 'lucide-react';
import { useSettingsStore, SETTINGS_DEFAULTS } from '@/stores/settingsStore';
import { useAppStore } from '@/stores/appStore';
import { MODELS as SHARED_MODELS, AUTO_MODEL_ID, resolveModelName, normalizeModelId, deduplicateById } from '@/lib/models';
import type { ThinkingLevel } from '@/lib/thinkingLevels';
import { getAnthropicApiKey, setAnthropicApiKey } from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import { SettingsRow } from '../shared/SettingsRow';
import { SettingsGroup } from '../shared/SettingsGroup';

export function AIModelSettings() {
  const defaultModel = useSettingsStore((s) => s.defaultModel);
  const setDefaultModel = useSettingsStore((s) => s.setDefaultModel);
  const defaultThinkingLevel = useSettingsStore((s) => s.defaultThinkingLevel);
  const setDefaultThinkingLevel = useSettingsStore((s) => s.setDefaultThinkingLevel);
  const reviewModel = useSettingsStore((s) => s.reviewModel);
  const setReviewModel = useSettingsStore((s) => s.setReviewModel);
  const defaultPlanMode = useSettingsStore((s) => s.defaultPlanMode);
  const setDefaultPlanMode = useSettingsStore((s) => s.setDefaultPlanMode);
  const defaultFastMode = useSettingsStore((s) => s.defaultFastMode);
  const setDefaultFastMode = useSettingsStore((s) => s.setDefaultFastMode);
  const maxThinkingTokens = useSettingsStore((s) => s.maxThinkingTokens);
  const setMaxThinkingTokens = useSettingsStore((s) => s.setMaxThinkingTokens);

  // Build model options from SDK-reported models, with static fallback.
  // Always include "Auto" so the setting is selectable even before SDK connects.
  const dynamicModels = useAppStore((s) => s.supportedModels);
  const modelOptions = useMemo(() => {
    const autoOption = { id: AUTO_MODEL_ID, name: 'Auto' };
    if (dynamicModels.length === 0) {
      return [autoOption, ...SHARED_MODELS.map((m) => ({ id: m.id, name: m.name }))];
    }
    const deduped = deduplicateById(
      dynamicModels.map((m) => ({ id: normalizeModelId(m), name: resolveModelName(m.value, m.displayName) }))
    );
    // Ensure Auto is present (SDK may not always include a "Default" entry)
    if (!deduped.some((m) => m.id === AUTO_MODEL_ID)) {
      return [autoOption, ...deduped];
    }
    return deduped;
  }, [dynamicModels]);

  return (
    <div>
      <h2 className="text-xl font-semibold mb-5">AI & Models</h2>

      <SettingsGroup label="Models">
        <SettingsRow
          settingId="defaultModel"
          title="Default model"
          description="Model for new conversations"
          isModified={defaultModel !== SETTINGS_DEFAULTS.defaultModel}
          onReset={() => setDefaultModel(SETTINGS_DEFAULTS.defaultModel)}
        >
          <Select value={defaultModel} onValueChange={setDefaultModel}>
            <SelectTrigger className="w-52" aria-label="Default model">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {modelOptions.map((m) => (
                <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingsRow>

        <SettingsRow
          settingId="reviewModel"
          title="Review model"
          description="Model for code reviews"
          isModified={reviewModel !== SETTINGS_DEFAULTS.reviewModel}
          onReset={() => setReviewModel(SETTINGS_DEFAULTS.reviewModel)}
        >
          <Select value={reviewModel} onValueChange={setReviewModel}>
            <SelectTrigger className="w-52" aria-label="Review model">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {modelOptions.map((m) => (
                <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup label="Reasoning">
        <SettingsRow
          settingId="defaultThinkingLevel"
          title="Default thinking"
          description="Controls reasoning depth for new conversations"
          isModified={defaultThinkingLevel !== SETTINGS_DEFAULTS.defaultThinkingLevel}
          onReset={() => setDefaultThinkingLevel(SETTINGS_DEFAULTS.defaultThinkingLevel)}
        >
          <Select value={defaultThinkingLevel} onValueChange={(v) => setDefaultThinkingLevel(v as ThinkingLevel)}>
            <SelectTrigger className="w-36" aria-label="Default thinking level">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="off">Off</SelectItem>
              <SelectItem value="low">Low</SelectItem>
              <SelectItem value="medium">Medium</SelectItem>
              <SelectItem value="high">High (default)</SelectItem>
              <SelectItem value="max">Max</SelectItem>
            </SelectContent>
          </Select>
        </SettingsRow>

        <SettingsRow
          settingId="defaultPlanMode"
          title="Default to plan mode"
          description="Start new conversations in plan mode"
          isModified={defaultPlanMode !== SETTINGS_DEFAULTS.defaultPlanMode}
          onReset={() => setDefaultPlanMode(SETTINGS_DEFAULTS.defaultPlanMode)}
        >
          <Switch checked={defaultPlanMode} onCheckedChange={setDefaultPlanMode} aria-label="Default to plan mode" />
        </SettingsRow>

        <SettingsRow
          settingId="defaultFastMode"
          title="Default to fast mode"
          description="Start new conversations with faster output (same model, optimized for speed)"
          isModified={defaultFastMode !== SETTINGS_DEFAULTS.defaultFastMode}
          onReset={() => setDefaultFastMode(SETTINGS_DEFAULTS.defaultFastMode)}
        >
          <Switch checked={defaultFastMode} onCheckedChange={setDefaultFastMode} aria-label="Default to fast mode" />
        </SettingsRow>

        {defaultThinkingLevel !== 'off' && (
          <SettingsRow
            settingId="maxThinkingTokens"
            title="Max thinking budget"
            description="Token budget cap for Sonnet & Haiku (Opus uses adaptive thinking)"
            isModified={maxThinkingTokens !== SETTINGS_DEFAULTS.maxThinkingTokens}
            onReset={() => setMaxThinkingTokens(SETTINGS_DEFAULTS.maxThinkingTokens)}
          >
            <Select
              value={maxThinkingTokens.toString()}
              onValueChange={(value) => {
                const n = parseInt(value, 10);
                if (!isNaN(n) && n > 0) setMaxThinkingTokens(n);
              }}
            >
              <SelectTrigger className="w-32" aria-label="Max thinking budget">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="8000">8,000</SelectItem>
                <SelectItem value="10000">10,000</SelectItem>
                <SelectItem value="16000">16,000</SelectItem>
                <SelectItem value="32000">32,000</SelectItem>
              </SelectContent>
            </Select>
          </SettingsRow>
        )}
      </SettingsGroup>

      <SettingsGroup label="Authentication">
        <ApiKeySection />
      </SettingsGroup>
    </div>
  );
}

function ApiKeySection() {
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [apiKeyConfigured, setApiKeyConfigured] = useState(false);
  const [apiKeyMasked, setApiKeyMasked] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [apiKeySaving, setApiKeySaving] = useState(false);
  const toasts = useToast();

  useEffect(() => {
    getAnthropicApiKey().then((data) => {
      setApiKeyConfigured(data.configured);
      setApiKeyMasked(data.maskedKey);
    }).catch(() => {
      // ignore -- settings page should still render
    });
  }, []);

  const handleSaveApiKey = async () => {
    setApiKeySaving(true);
    try {
      const result = await setAnthropicApiKey(apiKeyInput);
      setApiKeyConfigured(result.configured);
      setApiKeyMasked(result.maskedKey);
      setApiKeyInput('');
      toasts.success('New sessions will use this key.', 'API key saved');
    } catch {
      toasts.error('Failed to save API key');
    } finally {
      setApiKeySaving(false);
    }
  };

  const handleRemoveApiKey = async () => {
    setApiKeySaving(true);
    try {
      await setAnthropicApiKey('');
      setApiKeyConfigured(false);
      setApiKeyMasked('');
      toasts.success('API key removed');
    } catch {
      toasts.error('Failed to remove API key');
    } finally {
      setApiKeySaving(false);
    }
  };

  return (
    <SettingsRow
      settingId="anthropicApiKey"
      variant="stacked"
      title="Anthropic API Key"
      description={
        'Set an API key to bypass OAuth authentication. Get one from console.anthropic.com.'
      }
    >
      {apiKeyConfigured && (
        <p className="text-xs text-muted-foreground mb-2">
          Current key: <code className="text-xs bg-muted px-1 py-0.5 rounded">{apiKeyMasked}</code>
        </p>
      )}

      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-xs">
          <input
            type={showApiKey ? 'text' : 'password'}
            value={apiKeyInput}
            onChange={(e) => setApiKeyInput(e.target.value)}
            placeholder={apiKeyConfigured ? 'Enter new key to replace' : 'sk-ant-...'}
            aria-label="Anthropic API Key"
            className="w-full px-3 py-1.5 pr-8 text-sm bg-background border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <button
            type="button"
            onClick={() => setShowApiKey(!showApiKey)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            aria-label={showApiKey ? 'Hide API key' : 'Show API key'}
          >
            {showApiKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
          </button>
        </div>
        <Button
          size="sm"
          disabled={!apiKeyInput.trim() || apiKeySaving}
          onClick={handleSaveApiKey}
        >
          {apiKeySaving ? 'Saving...' : 'Save'}
        </Button>
        {apiKeyConfigured && (
          <Button
            size="sm"
            variant="outline"
            disabled={apiKeySaving}
            onClick={handleRemoveApiKey}
          >
            Remove
          </Button>
        )}
      </div>
    </SettingsRow>
  );
}
