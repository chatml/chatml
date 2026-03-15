import { Button } from '@/components/ui/button';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import type { SuggestionPill } from '@/lib/types';

interface ChatInputPillSuggestionsProps {
  pills: SuggestionPill[];
  onPillClick: (pill: SuggestionPill) => void;
}

export function ChatInputPillSuggestions({ pills, onPillClick }: ChatInputPillSuggestionsProps) {
  return (
    <div className="flex items-center gap-2 mb-2">
      <span className="text-xs text-muted-foreground shrink-0">Suggested:</span>
      <div className="flex items-center gap-1.5 flex-wrap">
        {pills.map((pill, i) => {
          const needsTooltip = pill.label !== pill.value;
          const button = (
            <Button
              key={i}
              variant="secondary"
              size="sm"
              className="h-7 text-xs rounded-full px-3"
              onClick={() => onPillClick(pill)}
            >
              {pill.label}
            </Button>
          );
          return needsTooltip ? (
            <Tooltip key={i}>
              <TooltipTrigger asChild>{button}</TooltipTrigger>
              <TooltipContent className="max-w-xs">{pill.value}</TooltipContent>
            </Tooltip>
          ) : button;
        })}
      </div>
    </div>
  );
}
