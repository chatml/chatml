'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';
import { getGlobalActionTemplates, setGlobalActionTemplates } from '@/lib/api';
import { ACTION_TEMPLATES, ACTION_TEMPLATE_META } from '@/lib/action-templates';

function OverridableBadge() {
  return (
    <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-2xs font-medium text-muted-foreground">
      Per-workspace
    </span>
  );
}

export function ActionSettings() {
  const [templates, setTemplates] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const { error: showError } = useToast();
  const showErrorRef = useRef(showError);
  useEffect(() => { showErrorRef.current = showError; }, [showError]);

  useEffect(() => {
    getGlobalActionTemplates()
      .then((data) => {
        setTemplates(data);
        setSaved(data);
      })
      .catch(() => {
        showErrorRef.current('Failed to load action templates');
      });
  }, []);

  const hasChanges = JSON.stringify(templates) !== JSON.stringify(saved);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const cleaned: Record<string, string> = {};
      for (const [k, v] of Object.entries(templates)) {
        if (v.trim()) cleaned[k] = v.trim();
      }
      await setGlobalActionTemplates(cleaned);
      setTemplates(cleaned);
      setSaved(cleaned);
      window.dispatchEvent(new CustomEvent('action-templates-changed'));
    } catch {
      showErrorRef.current('Failed to save action templates');
    } finally {
      setSaving(false);
    }
  }, [templates]);

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
        {ACTION_TEMPLATE_META.map(({ key, label, placeholder }) => (
          <div key={key}>
            <label className="text-sm font-medium block mb-1.5">{label}</label>
            <p className="text-xs text-muted-foreground mb-1.5 line-clamp-2">
              Default: {ACTION_TEMPLATES[key]?.slice(0, 100)}&hellip;
            </p>
            <Textarea
              className="text-sm min-h-[80px]"
              placeholder={placeholder}
              value={templates[key] || ''}
              onChange={(e) => setTemplates((prev) => ({ ...prev, [key]: e.target.value }))}
            />
          </div>
        ))}
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
