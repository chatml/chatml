'use client';

import { useState, useEffect } from 'react';
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
import { useSettingsStore } from '@/stores/settingsStore';
import type { ThinkingLevel } from '@/lib/thinkingLevels';
import { getAnthropicApiKey, setAnthropicApiKey } from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import { SettingsRow } from '../shared/SettingsRow';

export function AIModelSettings() {
  const defaultModel = useSettingsStore((s) => s.defaultModel);
  const setDefaultModel = useSettingsStore((s) => s.setDefaultModel);
  const defaultThinkingLevel = useSettingsStore((s) => s.defaultThinkingLevel);
  const setDefaultThinkingLevel = useSettingsStore((s) => s.setDefaultThinkingLevel);
  const reviewModel = useSettingsStore((s) => s.reviewModel);
  const setReviewModel = useSettingsStore((s) => s.setReviewModel);
  const defaultPlanMode = useSettingsStore((s) => s.defaultPlanMode);
  const setDefaultPlanMode = useSettingsStore((s) => s.setDefaultPlanMode);
  const maxThinkingTokens = useSettingsStore((s) => s.maxThinkingTokens);
  const setMaxThinkingTokens = useSettingsStore((s) => s.setMaxThinkingTokens);
  const showTokenUsage = useSettingsStore((s) => s.showTokenUsage);
  const setShowTokenUsage = useSettingsStore((s) => s.setShowTokenUsage);
  const showChatCost = useSettingsStore((s) => s.showChatCost);
  const setShowChatCost = useSettingsStore((s) => s.setShowChatCost);
  const autoApproveSafeCommands = useSettingsStore((s) => s.autoApproveSafeCommands);
  const setAutoApproveSafeCommands = useSettingsStore((s) => s.setAutoApproveSafeCommands);

  return (
    <div>
      <h2 className="text-xl font-semibold mb-5">AI & Models</h2>

      <SettingsRow title="Default model" description="Model for new conversations">
        <Select value={defaultModel} onValueChange={setDefaultModel}>
          <SelectTrigger className="w-52">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="claude-opus-4-6">Claude Opus 4.6</SelectItem>
            <SelectItem value="claude-sonnet-4-6">Claude Sonnet 4.6</SelectItem>
            <SelectItem value="claude-haiku-4-5-20251001">Claude Haiku 4.5</SelectItem>
          </SelectContent>
        </Select>
      </SettingsRow>

      <SettingsRow title="Review model" description="Model for code reviews">
        <Select value={reviewModel} onValueChange={setReviewModel}>
          <SelectTrigger className="w-52">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="claude-opus-4-6">Claude Opus 4.6</SelectItem>
            <SelectItem value="claude-sonnet-4-6">Claude Sonnet 4.6</SelectItem>
            <SelectItem value="claude-haiku-4-5-20251001">Claude Haiku 4.5</SelectItem>
          </SelectContent>
        </Select>
      </SettingsRow>

      <SettingsRow
        title="Default thinking"
        description="Controls reasoning depth for new conversations"
      >
        <Select value={defaultThinkingLevel} onValueChange={(v) => setDefaultThinkingLevel(v as ThinkingLevel)}>
          <SelectTrigger className="w-36">
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
        title="Default to plan mode"
        description="Start new conversations in plan mode"
      >
        <Switch checked={defaultPlanMode} onCheckedChange={setDefaultPlanMode} />
      </SettingsRow>

      {defaultThinkingLevel !== 'off' && (
        <SettingsRow
          title="Max thinking budget"
          description="Token budget cap for Sonnet & Haiku (Opus uses adaptive thinking)"
        >
          <Select
            value={maxThinkingTokens.toString()}
            onValueChange={(value) => {
              const n = parseInt(value, 10);
              if (!isNaN(n) && n > 0) setMaxThinkingTokens(n);
            }}
          >
            <SelectTrigger className="w-32">
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

      <SettingsRow
        title="Show token usage"
        description="Display token counts and cost breakdown in run summaries"
      >
        <Switch checked={showTokenUsage} onCheckedChange={setShowTokenUsage} />
      </SettingsRow>

      <SettingsRow
        title="Show cost"
        description="Display cost in run summaries"
      >
        <Switch checked={showChatCost} onCheckedChange={setShowChatCost} />
      </SettingsRow>

      <SettingsRow
        title="Auto-approve safe commands"
        description="Automatically approve read-only commands (coming soon)"
      >
        <Switch checked={autoApproveSafeCommands} onCheckedChange={setAutoApproveSafeCommands} disabled />
      </SettingsRow>

      {/* Anthropic API Key */}
      <ApiKeySection />
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
    <div className="py-4 border-b border-border/50">
      <h4 className="text-sm font-medium">Anthropic API Key</h4>
      <p className="text-xs text-muted-foreground mt-0.5">
        Set an API key to bypass OAuth authentication. Get one from{' '}
        <a href="https://console.anthropic.com" target="_blank" rel="noopener noreferrer" className="underline hover:text-foreground">
          console.anthropic.com
        </a>.
      </p>

      {apiKeyConfigured && (
        <p className="text-xs text-muted-foreground mt-2">
          Current key: <code className="text-xs bg-muted px-1 py-0.5 rounded">{apiKeyMasked}</code>
        </p>
      )}

      <div className="flex items-center gap-2 mt-3">
        <div className="relative flex-1 max-w-xs">
          <input
            type={showApiKey ? 'text' : 'password'}
            value={apiKeyInput}
            onChange={(e) => setApiKeyInput(e.target.value)}
            placeholder={apiKeyConfigured ? 'Enter new key to replace' : 'sk-ant-...'}
            className="w-full px-3 py-1.5 pr-8 text-sm bg-background border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <button
            type="button"
            onClick={() => setShowApiKey(!showApiKey)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
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
    </div>
  );
}
