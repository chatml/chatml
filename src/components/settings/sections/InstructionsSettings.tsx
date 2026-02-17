'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';
import { getCustomInstructions, setCustomInstructions } from '@/lib/api';

export function InstructionsSettings() {
  const [instructions, setInstructions] = useState('');
  const [saved, setSaved] = useState('');
  const [saving, setSaving] = useState(false);
  const { error: showError } = useToast();

  useEffect(() => {
    getCustomInstructions()
      .then((data) => {
        setInstructions(data);
        setSaved(data);
      })
      .catch(() => {
        showError('Failed to load custom instructions');
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hasChanges = instructions !== saved;

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const trimmed = instructions.trim();
      await setCustomInstructions(trimmed);
      setInstructions(trimmed);
      setSaved(trimmed);
    } catch {
      showError('Failed to save custom instructions');
    } finally {
      setSaving(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instructions]);

  return (
    <div>
      <h2 className="text-xl font-semibold mb-1">Custom Instructions</h2>
      <p className="text-sm text-muted-foreground mb-6">
        These instructions are included in the system prompt for every new conversation.
        Use this to set behavioral rules, coding standards, or preferences that apply across all sessions.
      </p>

      <Textarea
        className="text-sm min-h-[200px]"
        placeholder="e.g., Always write tests before implementation. Use TypeScript strict mode. Prefer functional components with hooks."
        value={instructions}
        onChange={(e) => setInstructions(e.target.value)}
      />

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
