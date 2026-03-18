'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible';
import { useToast } from '@/components/ui/toast';
import { getGlobalReviewPrompts, setGlobalReviewPrompts, getGlobalPRTemplate, setGlobalPRTemplate } from '@/lib/api';
import { REVIEW_PROMPTS, REVIEW_TYPE_META } from '@/hooks/useReviewTrigger';
import { useSettingsStore, SETTINGS_DEFAULTS } from '@/stores/settingsStore';
import { SettingsRow } from '../shared/SettingsRow';
import { SettingsGroup } from '../shared/SettingsGroup';

function OverridableBadge() {
  return (
    <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-2xs font-medium text-muted-foreground">
      Per-workspace
    </span>
  );
}

export function ReviewSettings() {
  const reviewActionableOnly = useSettingsStore((s) => s.reviewActionableOnly);
  const setReviewActionableOnly = useSettingsStore((s) => s.setReviewActionableOnly);
  const [prompts, setPrompts] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<Record<string, string>>({});
  const [prTemplate, setPRTemplate] = useState('');
  const [savedPRTemplate, setSavedPRTemplate] = useState('');
  const [saving, setSaving] = useState(false);
  const { error: showError } = useToast();
  const showErrorRef = useRef(showError);
  useEffect(() => { showErrorRef.current = showError; }, [showError]);

  useEffect(() => {
    Promise.all([getGlobalReviewPrompts(), getGlobalPRTemplate()])
      .then(([reviewData, prData]) => {
        setPrompts(reviewData);
        setSaved(reviewData);
        setPRTemplate(prData);
        setSavedPRTemplate(prData);
      })
      .catch(() => {
        showErrorRef.current('Failed to load settings');
      });
  }, []);

  const hasChanges = JSON.stringify(prompts) !== JSON.stringify(saved) || prTemplate !== savedPRTemplate;

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const cleaned: Record<string, string> = {};
      for (const [k, v] of Object.entries(prompts)) {
        if (v.trim()) cleaned[k] = v.trim();
      }
      await Promise.all([
        setGlobalReviewPrompts(cleaned),
        setGlobalPRTemplate(prTemplate.trim()),
      ]);
      setPrompts(cleaned);
      setSaved(cleaned);
      setPRTemplate(prTemplate.trim());
      setSavedPRTemplate(prTemplate.trim());
    } catch {
      showErrorRef.current('Failed to save settings');
    } finally {
      setSaving(false);
    }
  }, [prompts, prTemplate]);

  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <h2 className="text-xl font-semibold">Review & PRs</h2>
        <OverridableBadge />
      </div>
      <p className="text-sm text-muted-foreground mb-6">
        Custom instructions appended to each review type&apos;s default prompt.
        Per-workspace and per-session overrides can be set in their respective settings.
      </p>

      <SettingsGroup label="Review Preferences">
        <SettingsRow
          settingId="reviewActionableOnly"
          title="Actionable feedback only"
          description="Only include actionable review comments (errors, warnings, suggestions). Hides informational and positive feedback."
          isModified={reviewActionableOnly !== SETTINGS_DEFAULTS.reviewActionableOnly}
          onReset={() => setReviewActionableOnly(SETTINGS_DEFAULTS.reviewActionableOnly)}
        >
          <Switch
            checked={reviewActionableOnly}
            onCheckedChange={setReviewActionableOnly}
            aria-label="Actionable feedback only"
          />
        </SettingsRow>
      </SettingsGroup>

      <div data-setting-id="reviewPrompts" className="space-y-5 mt-6">
        {REVIEW_TYPE_META.map(({ key, label, placeholder }) => (
          <div key={key} className="border rounded-lg p-4">
            <label className="text-sm font-medium block mb-2">{label}</label>

            <Collapsible>
              <CollapsibleTrigger className="group flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
                <ChevronRight className="h-3.5 w-3.5 transition-transform group-data-[state=open]:rotate-90" />
                View built-in default
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="mt-2 p-3 bg-muted/50 rounded-md text-xs font-mono whitespace-pre-wrap max-h-48 overflow-y-auto border border-border/50">
                  {REVIEW_PROMPTS[key]}
                </div>
              </CollapsibleContent>
            </Collapsible>

            <Textarea
              className="text-sm min-h-[60px] mt-3"
              placeholder={placeholder}
              value={prompts[key] || ''}
              onChange={(e) => setPrompts((prev) => ({ ...prev, [key]: e.target.value }))}
            />
          </div>
        ))}
      </div>

      <div data-setting-id="prTemplate" className="mt-8 pt-8 border-t border-border/50">
        <h3 className="text-lg font-semibold mb-1">PR Description</h3>
        <p className="text-sm text-muted-foreground mb-4">
          Custom instructions for AI-generated PR descriptions.
          Per-session overrides can be set in session settings.
        </p>

        <label className="text-sm font-medium block mb-1.5">PR Description Prompt</label>
        <p className="text-xs text-muted-foreground mb-1.5">
          These instructions will be prepended to the default PR generation prompt
        </p>
        <Textarea
          className="text-sm min-h-[80px]"
          placeholder="e.g., Include a testing checklist, link to related issues, use conventional commit format for title"
          value={prTemplate}
          onChange={(e) => setPRTemplate(e.target.value)}
        />
      </div>

      {hasChanges && (
        <div className="mt-4 flex justify-end">
          <Button size="sm" disabled={saving} onClick={handleSave}>
            {saving ? 'Saving...' : 'Save'}
          </Button>
        </div>
      )}
    </div>
  );
}
