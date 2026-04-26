'use client';

import { useAppStore } from '@/stores/appStore';
import { Download, HardDrive } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SHOW_UNRELEASED } from '@/lib/constants';

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i > 1 ? 1 : 0)} ${units[i]}`;
}

/**
 * Inline progress block shown in the conversation area when Ollama binary
 * download or model pull is in progress. Displayed above the streaming
 * message area, auto-hides when progress reaches 100%.
 */
export function OllamaProgressBlock() {
  const progress = useAppStore((s) => s.ollamaProgress);
  if (!SHOW_UNRELEASED) return null;
  if (!progress) return null;

  const isDownload = progress.type === 'ollama_download';
  const Icon = isDownload ? Download : HardDrive;
  const title = isDownload ? 'Installing Ollama' : `Pulling ${progress.model ?? 'model'}`;
  const percent = Math.min(Math.max(progress.percent, 0), 100);

  return (
    <div className="mx-auto w-full max-w-2xl px-4 mb-3">
      <div className="flex items-center gap-3 rounded-lg border bg-card px-4 py-3">
        <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="flex-1 min-w-0 space-y-1.5">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium truncate">{title}</span>
            <span className="text-xs text-muted-foreground tabular-nums ml-2">
              {progress.total > 0
                ? `${formatBytes(progress.downloaded)} / ${formatBytes(progress.total)}`
                : progress.status}
            </span>
          </div>
          <div className="h-1.5 bg-muted rounded-full overflow-hidden">
            <div
              className={cn(
                'h-full rounded-full transition-all duration-300',
                percent >= 100 ? 'bg-green-500' : 'bg-brand'
              )}
              style={{ width: `${percent}%` }}
            />
          </div>
          {progress.status && progress.total > 0 && (
            <p className="text-2xs text-muted-foreground truncate">{progress.status}</p>
          )}
        </div>
        <span className="text-xs font-mono text-muted-foreground tabular-nums w-10 text-right">
          {percent}%
        </span>
      </div>
    </div>
  );
}
