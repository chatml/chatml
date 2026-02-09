'use client';

import { useEffect, useState, useMemo, useReducer } from 'react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { CachedMarkdown } from '@/components/shared/CachedMarkdown';
import { Button } from '@/components/ui/button';
import { Loader2, AlertCircle } from 'lucide-react';
import { getSkillContent } from '@/lib/api';
import { CATEGORY_ICON_MAP } from './SkillsStore';
import type { SkillDTO } from '@/lib/api';

/** Strip YAML frontmatter (--- ... ---) from markdown content */
function stripFrontmatter(md: string): string {
  const trimmed = md.trimStart();
  if (!trimmed.startsWith('---')) return md;
  const endIndex = trimmed.indexOf('\n---', 3);
  if (endIndex === -1) return md;
  // Skip past the closing --- and any trailing blank lines
  let i = endIndex + 4;
  while (i < trimmed.length && (trimmed[i] === '\n' || trimmed[i] === '\r')) i++;
  return trimmed.slice(i);
}

interface SkillDetailDialogProps {
  skill: SkillDTO | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInstallToggle: (skillId: string, isInstalled: boolean) => Promise<void>;
}

export function SkillDetailDialog({
  skill,
  open,
  onOpenChange,
  onInstallToggle,
}: SkillDetailDialogProps) {
  const [content, setContent] = useState<string | null>(null);
  const [contentLoading, setContentLoading] = useState(false);
  const [contentError, setContentError] = useState<string | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);
  const [retryCount, retry] = useReducer((c: number) => c + 1, 0);

  useEffect(() => {
    if (!open || !skill) return;

    const abortController = new AbortController();
    setContent(null);
    setContentLoading(true);
    setContentError(null);

    getSkillContent(skill.id)
      .then((res) => {
        if (!abortController.signal.aborted) {
          setContent(res.content);
        }
      })
      .catch((err) => {
        if (!abortController.signal.aborted) {
          setContentError(
            err instanceof Error ? err.message : 'Failed to load skill content'
          );
        }
      })
      .finally(() => {
        if (!abortController.signal.aborted) {
          setContentLoading(false);
        }
      });

    return () => abortController.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, skill?.id, retryCount]);

  const handleInstallToggle = async () => {
    if (!skill) return;
    setIsUpdating(true);
    try {
      await onInstallToggle(skill.id, skill.installed);
    } finally {
      setIsUpdating(false);
    }
  };

  const strippedContent = useMemo(
    () => (content ? stripFrontmatter(content) : null),
    [content]
  );

  if (!skill) return null;

  const CategoryIcon = CATEGORY_ICON_MAP[skill.category];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl p-0 gap-0 flex flex-col h-[85vh]">
        {/* Header */}
        <div className="shrink-0 px-6 pt-6 pb-4">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center h-10 w-10 rounded-full bg-muted shrink-0">
              <CategoryIcon className="h-5 w-5 text-muted-foreground" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <DialogTitle>{skill.name}</DialogTitle>
                <code className="shrink-0 text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded font-mono">
                  /{skill.id}
                </code>
              </div>
              <DialogDescription className="mt-0.5">
                {skill.description}
              </DialogDescription>
            </div>
          </div>
        </div>

        {/* Body — native scroll, no ScrollArea */}
        <div className="flex-1 min-h-0 overflow-y-auto border-y">
          <div className="p-6 skill-detail-markdown">
            {contentLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : contentError ? (
              <div className="flex flex-col items-center justify-center py-12 gap-3">
                <AlertCircle className="h-5 w-5 text-destructive" />
                <p className="text-sm text-destructive">{contentError}</p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={retry}
                >
                  Retry
                </Button>
              </div>
            ) : strippedContent ? (
              <CachedMarkdown
                cacheKey={`skill-detail-${skill.id}`}
                content={strippedContent}
              />
            ) : null}
          </div>
        </div>

        {/* Footer */}
        <div className="shrink-0 px-6 py-4 flex justify-center">
          <Button
            variant={skill.installed ? 'outline' : 'default'}
            onClick={handleInstallToggle}
            disabled={isUpdating}
            className="min-w-[140px]"
          >
            {isUpdating ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : skill.installed ? (
              'Uninstall'
            ) : (
              'Install'
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
