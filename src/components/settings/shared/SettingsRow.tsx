import { useId } from 'react';
import { RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SettingsRowProps {
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  /** 'inline' (default) = label left / control right. 'stacked' = label on top, control below */
  variant?: 'inline' | 'stacked';
  /** Optional icon before the title */
  icon?: React.ReactNode;
  /** Optional badge rendered next to the title (e.g. "Coming soon") */
  badge?: React.ReactNode;
  /** Hide the bottom border */
  noBorder?: boolean;
  /** Additional className for the outer container */
  className?: string;
  /** When true, shows a reset-to-default icon on hover */
  isModified?: boolean;
  /** Callback to reset this setting to its default value */
  onReset?: () => void;
  /** Identifier used for scroll-to-setting from search results */
  settingId?: string;
}

function ResetButton({ onReset }: { onReset: () => void }) {
  return (
    <button
      type="button"
      onClick={onReset}
      className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded text-muted-foreground hover:text-foreground"
      aria-label="Reset to default"
      title="Reset to default"
    >
      <RotateCcw className="w-3 h-3" />
    </button>
  );
}

export function SettingsRow({
  title,
  description,
  children,
  variant = 'inline',
  icon,
  badge,
  noBorder,
  className,
  isModified,
  onReset,
  settingId,
}: SettingsRowProps) {
  const id = useId();
  const descriptionId = description ? `${id}-desc` : undefined;
  const showReset = isModified && onReset;

  if (variant === 'stacked') {
    return (
      <div
        data-setting-id={settingId}
        className={cn(
          'group py-4 last:border-b-0 transition-colors',
          !noBorder && 'border-b border-border/50',
          className,
        )}
      >
        <div className="flex items-center gap-2">
          {icon && <span className="text-muted-foreground shrink-0">{icon}</span>}
          <h4 id={id} className="text-sm font-medium">{title}</h4>
          {badge}
          {showReset && <ResetButton onReset={onReset} />}
        </div>
        {description && (
          <p id={descriptionId} className="text-xs text-muted-foreground mt-0.5">{description}</p>
        )}
        <div className="mt-3" role="group" aria-labelledby={id} aria-describedby={descriptionId}>
          {children}
        </div>
      </div>
    );
  }

  return (
    <div
      data-setting-id={settingId}
      className={cn(
        'group flex items-start justify-between py-3 last:border-b-0 transition-colors',
        !noBorder && 'border-b border-border/50',
        className,
      )}
    >
      <div className="flex-1 pr-4">
        <div className="flex items-center gap-2">
          {icon && <span className="text-muted-foreground shrink-0">{icon}</span>}
          <h4 id={id} className="text-sm font-medium">{title}</h4>
          {badge}
          {showReset && <ResetButton onReset={onReset} />}
        </div>
        {description && (
          <p id={descriptionId} className="text-xs text-muted-foreground mt-0.5">{description}</p>
        )}
      </div>
      <div className="shrink-0 pt-0.5" role="group" aria-labelledby={id} aria-describedby={descriptionId}>
        {children}
      </div>
    </div>
  );
}
