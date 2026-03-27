'use client';

import { useEffect, useState, useMemo, useReducer } from 'react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { DialogMarkdown } from '@/components/shared/DialogMarkdown';
import { Button } from '@/components/ui/button';
import { Loader2, AlertCircle } from 'lucide-react';
import { getSkillContent } from '@/lib/api';
import { CATEGORY_ICON_MAP } from './SkillsStore';
import type { SkillDTO, SkillCategory } from '@/lib/api';

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
  const isGStack = skill.id.startsWith('gstack-');

  const CATEGORY_LABELS: Record<SkillCategory, string> = {
    'development': 'Development',
    'documentation': 'Documentation',
    'security': 'Security',
    'version-control': 'Version Control',
    'planning': 'Planning',
    'deployment': 'Deployment',
    'quality': 'Quality',
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl p-0 gap-0 flex flex-col h-[85vh]">
        {/* Header */}
        <div className="shrink-0 px-6 pt-6 pb-4">
          <div className="flex items-start gap-3">
            <div className={`flex items-center justify-center h-10 w-10 rounded-lg shrink-0 ${isGStack ? 'bg-violet-500/10' : 'bg-muted'}`}>
              <CategoryIcon className={`h-5 w-5 ${isGStack ? 'text-violet-500' : 'text-muted-foreground'}`} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <DialogTitle>{skill.name}</DialogTitle>
                {isGStack && (
                  <span className="inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-violet-500/10 text-violet-500 shrink-0">
                    GStack
                  </span>
                )}
              </div>
              <DialogDescription className="mt-0.5">
                {skill.description}
              </DialogDescription>
              <div className="flex items-center gap-2 mt-1.5 text-xs text-muted-foreground/60">
                <span>{skill.author}</span>
                <span className="text-muted-foreground/30">&middot;</span>
                <span>{CATEGORY_LABELS[skill.category]}</span>
                <span className="text-muted-foreground/30">&middot;</span>
                <span>v{skill.version}</span>
                <span className="text-muted-foreground/30">&middot;</span>
                <code className="text-[11px] text-muted-foreground/50 font-mono">/{skill.id}</code>
              </div>
            </div>
          </div>
        </div>

        {/* Body — native scroll, no ScrollArea */}
        <div className="flex-1 min-h-0 overflow-y-auto border-y">
          {contentLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : contentError ? (
            <div className="flex flex-col items-center justify-center py-12 gap-3 px-6">
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
            <DialogMarkdown
              cacheKey={`skill-detail-${skill.id}`}
              content={strippedContent}
              className="p-6"
            />
          ) : null}
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
