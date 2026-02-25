'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible';
import { useToast } from '@/components/ui/toast';
import { getGlobalActionTemplates, setGlobalActionTemplates } from '@/lib/api';
import {
  ACTION_TEMPLATES,
  ACTION_TEMPLATE_META,
  parseOverrides,
  serializeOverrides,
} from '@/lib/action-templates';
import type { ActionTemplateKey, ActionTemplateOverride, OverrideMode } from '@/lib/action-templates';

function OverridableBadge() {
  return (
    <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-2xs font-medium text-muted-foreground">
      Per-workspace
    </span>
  );
}

export function ActionSettings() {
  const [templates, setTemplates] = useState<Partial<Record<ActionTemplateKey, ActionTemplateOverride>>>({});
  const [saved, setSaved] = useState<Partial<Record<ActionTemplateKey, ActionTemplateOverride>>>({});
  const [saving, setSaving] = useState(false);
  const { error: showError } = useToast();
  const showErrorRef = useRef(showError);
  useEffect(() => { showErrorRef.current = showError; }, [showError]);

  useEffect(() => {
    getGlobalActionTemplates()
      .then((data) => {
        const parsed = parseOverrides(data);
        setTemplates(parsed);
        setSaved(parsed);
      })
      .catch(() => {
        showErrorRef.current('Failed to load action templates');
      });
  }, []);

  const hasChanges = JSON.stringify(templates) !== JSON.stringify(saved);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const serialized = serializeOverrides(templates);
      await setGlobalActionTemplates(serialized);
      const parsed = parseOverrides(serialized);
      setTemplates(parsed);
      setSaved(parsed);
      window.dispatchEvent(new CustomEvent('action-templates-changed'));
    } catch {
      showErrorRef.current('Failed to save action templates');
    } finally {
      setSaving(false);
    }
  }, [templates]);

  const setTemplateText = useCallback((key: ActionTemplateKey, text: string) => {
    setTemplates((prev) => ({
      ...prev,
      [key]: { text, mode: prev[key]?.mode || 'append' },
    }));
  }, []);

  const setTemplateMode = useCallback((key: ActionTemplateKey, mode: OverrideMode) => {
    setTemplates((prev) => ({
      ...prev,
      [key]: { text: prev[key]?.text || '', mode },
    }));
  }, []);

  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <h2 className="text-xl font-semibold">Actions</h2>
        <OverridableBadge />
      </div>
      <p className="text-sm text-muted-foreground mb-6">
        Customize the instructions sent to the agent for each toolbar action.
        Per-workspace overrides can be set in workspace settings.
      </p>

      <div data-setting-id="actionTemplates" className="space-y-5">
        {ACTION_TEMPLATE_META.map(({ key, label, placeholder }) => {
          const override = templates[key];
          const hasText = !!override?.text?.trim();

          return (
            <div key={key} className="border rounded-lg p-4">
              <label className="text-sm font-medium block mb-2">{label}</label>

              <Collapsible>
                <CollapsibleTrigger className="group flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
                  <ChevronRight className="h-3.5 w-3.5 transition-transform group-data-[state=open]:rotate-90" />
                  View built-in default
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="mt-2 p-3 bg-muted/50 rounded-md text-xs font-mono whitespace-pre-wrap max-h-48 overflow-y-auto border border-border/50">
                    {ACTION_TEMPLATES[key]}
                  </div>
                </CollapsibleContent>
              </Collapsible>

              {hasText && (
                <RadioGroup
                  value={override?.mode || 'append'}
                  onValueChange={(v) => setTemplateMode(key, v as OverrideMode)}
                  className="flex gap-4 mt-3"
                >
                  <div className="flex items-center gap-1.5">
                    <RadioGroupItem value="append" id={`${key}-append`} />
                    <label htmlFor={`${key}-append`} className="text-xs cursor-pointer">Add to default</label>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <RadioGroupItem value="replace" id={`${key}-replace`} />
                    <label htmlFor={`${key}-replace`} className="text-xs cursor-pointer">Replace default</label>
                  </div>
                </RadioGroup>
              )}

              <Textarea
                className="text-sm min-h-[80px] mt-3"
                placeholder={placeholder}
                value={override?.text || ''}
                onChange={(e) => setTemplateText(key, e.target.value)}
              />

              {hasText && (
                <p className="text-xs text-muted-foreground mt-1.5">
                  {override?.mode === 'replace'
                    ? 'Your text will completely replace the built-in default.'
                    : 'Your text will be appended after the built-in default.'}
                </p>
              )}
            </div>
          );
        })}
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
