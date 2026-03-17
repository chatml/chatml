import { Fragment } from 'react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  ChevronDown,
  Paperclip,
  ArrowUp,
  Square,
  Brain,
  BookOpen,
  Plus,
  Link,
  FolderSymlink,
  Check,
  Star,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { ContextMeter } from './ContextMeter';
import { THINKING_LEVELS, type ThinkingLevel, canDisableThinking } from '@/lib/thinkingLevels';
import type { LinearIssueDTO } from '@/lib/api';
import type { ModelEntry } from '@/lib/models';

export interface ModelProps {
  selected: ModelEntry;
  models: ModelEntry[];
  defaultId: string;
  setSelected: (model: ModelEntry) => void;
  setDefault: (modelId: string) => void;
}

export interface ThinkingProps {
  level: ThinkingLevel;
  defaultLevel: ThinkingLevel;
  setLevel: (level: ThinkingLevel) => void;
  setDefault: (level: ThinkingLevel) => void;
}

export interface AttachmentMenuProps {
  onOpenFilePicker: () => void;
  onLinearPickerOpen: () => void;
  linkedLinearIssue: LinearIssueDTO | null;
  onWorkspacePickerOpen: () => void;
  linkedWorkspaceIds: string[];
}

export interface ActionButtonProps {
  buttonMode: 'send' | 'stop' | 'queue' | 'send-disabled';
  queuedCount: number;
  isSending: boolean;
  authDisabled: boolean;
  sendWithEnter: boolean;
  onSubmit: () => void;
  onStop: () => void;
}

interface ChatInputToolbarProps {
  model: ModelProps;
  thinking: ThinkingProps;
  planModeEnabled: boolean;
  onPlanModeToggle: () => void;
  selectedConversationId: string | null;
  selectedSessionId: string | null;
  attachments: AttachmentMenuProps;
  action: ActionButtonProps;
  showInfo: (msg: string) => void;
}

export function ChatInputToolbar({
  model,
  thinking,
  planModeEnabled,
  onPlanModeToggle,
  selectedConversationId,
  selectedSessionId,
  attachments,
  action,
  showInfo,
}: ChatInputToolbarProps) {
  return (
    <div className="flex items-center gap-1 px-2 pb-2">
      {/* Model Selector */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-xs" title={`Model: ${model.selected.name}${model.selected.id === model.defaultId ? ' (default)' : ''} (⌥M to cycle)`}>
            <model.selected.icon className="h-3.5 w-3.5" />
            {model.selected.name}
            <ChevronDown className="h-3 w-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          {model.models.map((m) => {
            const isDefault = m.id === model.defaultId;
            const isSelected = m.id === model.selected.id;
            return (
              <DropdownMenuItem
                key={m.id}
                className="group flex items-center gap-2 pr-1.5"
                onClick={() => model.setSelected(m)}
              >
                <span className="flex flex-1 items-center gap-1.5 min-w-0">
                  <span className="truncate">{m.name}</span>
                </span>
                <span className="ml-auto flex shrink-0 items-center gap-1">
                  {isSelected && <Check className="h-3.5 w-3.5" />}
                  {isDefault ? (
                    <Star className="h-3 w-3 fill-current text-amber-500" />
                  ) : (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span
                          role="button"
                          aria-label={`Set ${m.name} as default`}
                          className="flex items-center justify-center rounded p-0.5 text-muted-foreground/50 opacity-0 transition-opacity group-hover:opacity-100 hover:text-foreground"
                          onPointerDown={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                          }}
                          onClick={(e) => {
                            e.stopPropagation();
                            model.setDefault(m.id);
                            showInfo(`${m.name} set as default for new conversations`);
                          }}
                        >
                          <Star className="h-3 w-3" />
                        </span>
                      </TooltipTrigger>
                      <TooltipContent side="right" sideOffset={8}>Set as default</TooltipContent>
                    </Tooltip>
                  )}
                </span>
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Unified Thinking Level Dropdown */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              'h-7 gap-1.5 px-2 text-xs',
              thinking.level !== thinking.defaultLevel && 'text-amber-500 hover:text-amber-600 bg-amber-500/10 hover:bg-amber-500/20'
            )}
            title={`Thinking: ${thinking.level} (⌥T to cycle)`}
            aria-label={`Thinking: ${thinking.level}`}
          >
            <Brain className="h-4 w-4" />
            <span className="font-medium capitalize">{thinking.level}</span>
            <ChevronDown className="h-3 w-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuLabel className="flex items-center justify-between text-2xs font-normal text-muted-foreground uppercase tracking-wider">
            Extended Thinking
            <span className="normal-case tracking-normal text-muted-foreground/60">⌥T</span>
          </DropdownMenuLabel>
          {THINKING_LEVELS
            .filter((level) => {
              if (level.id === 'off') return canDisableThinking(model.selected);
              if (model.selected.supportsEffort && model.selected.supportedEffortLevels) {
                return model.selected.supportedEffortLevels.includes(level.id as 'low' | 'medium' | 'high' | 'max');
              }
              return true;
            })
            .map((level, index, arr) => {
              const isSelected = level.id === thinking.level;
              const isDefault = level.id === thinking.defaultLevel;
              return (
                <Fragment key={level.id}>
                  {index === 1 && arr[0].id === 'off' && <DropdownMenuSeparator />}
                  <DropdownMenuItem
                    onClick={() => thinking.setLevel(level.id)}
                    className="group flex-col items-start gap-0 py-2"
                  >
                    <div className="flex w-full items-center gap-1.5">
                      <span className="font-medium">{level.label}</span>
                      <span className="ml-auto flex shrink-0 items-center gap-1">
                        {isSelected && <Check className="h-3.5 w-3.5" />}
                        {isDefault ? (
                          <Star className="h-3 w-3 fill-current text-amber-500" />
                        ) : level.id !== 'off' ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button
                                type="button"
                                aria-label={`Set ${level.label} as default thinking level`}
                                className="flex items-center justify-center rounded p-0.5 text-muted-foreground/50 opacity-0 transition-opacity group-hover:opacity-100 hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                onPointerDown={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                }}
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  thinking.setDefault(level.id);
                                  showInfo(`${level.label} set as default thinking level`);
                                }}
                              >
                                <Star className="h-3 w-3" />
                              </button>
                            </TooltipTrigger>
                            <TooltipContent side="right" sideOffset={8}>Set as default</TooltipContent>
                          </Tooltip>
                        ) : null}
                      </span>
                    </div>
                    <span className="text-xs text-muted-foreground leading-tight">
                      {level.description}
                    </span>
                  </DropdownMenuItem>
                </Fragment>
              );
            })}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Plan Mode Toggle */}
      <Button
        variant="ghost"
        size={planModeEnabled ? 'sm' : 'icon'}
        className={cn(
          planModeEnabled ? 'h-7 gap-1.5 px-2' : 'h-7 w-7',
          planModeEnabled && 'text-amber-500 hover:text-amber-600 bg-amber-500/10 hover:bg-amber-500/20'
        )}
        onClick={onPlanModeToggle}
        title={`Plan mode ${planModeEnabled ? 'on' : 'off'} (⇧Tab)`}
        aria-label={`Plan mode ${planModeEnabled ? 'on' : 'off'}`}
        aria-pressed={planModeEnabled}
      >
        <BookOpen className="h-4 w-4" />
        {planModeEnabled && <span className="text-xs font-medium">Plan</span>}
      </Button>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Context Meter */}
      <ContextMeter conversationId={selectedConversationId} />

      {/* Plus Menu */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Add attachment or link">
            <Plus className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={attachments.onOpenFilePicker}>
            <Paperclip className="size-4" />
            Add attachment
            <span className="ml-auto text-xs text-muted-foreground">⌘U</span>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={attachments.onLinearPickerOpen}>
            <Link className="size-4" />
            Link Linear issue
            {attachments.linkedLinearIssue ? (
              <span className="ml-auto text-xs bg-brand/20 text-brand px-1.5 py-0.5 rounded-full">
                1
              </span>
            ) : (
              <span className="ml-auto text-xs text-muted-foreground">⌘I</span>
            )}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={attachments.onWorkspacePickerOpen}>
            <FolderSymlink className="size-4" />
            Link workspaces
            {attachments.linkedWorkspaceIds.length > 0 && (
              <span className="ml-auto text-xs bg-brand/20 text-brand px-1.5 py-0.5 rounded-full">
                {attachments.linkedWorkspaceIds.length}
              </span>
            )}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Single Contextual Action Button — changes between Stop/Queue/Send based on state */}
      {action.buttonMode === 'stop' ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="icon"
              variant="destructive"
              className="h-8 w-8 rounded-lg"
              onClick={action.onStop}
              aria-label="Stop agent (⌘⇧⌫)"
            >
              <Square className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">Stop agent (⌘⇧⌫)</TooltipContent>
        </Tooltip>
      ) : action.buttonMode === 'queue' ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="icon"
              className="h-8 w-8 rounded-lg"
              onClick={action.onSubmit}
              disabled={!selectedSessionId || action.isSending || action.authDisabled}
              aria-label="Queue message"
            >
              <ArrowUp className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">{action.queuedCount > 0 ? `Queue message (${action.queuedCount} queued)` : 'Queue message — sent after current response'}</TooltipContent>
        </Tooltip>
      ) : (
        <Button
          size="icon"
          className={cn('h-8 w-8 rounded-lg', action.buttonMode !== 'send' && 'opacity-50')}
          onClick={action.onSubmit}
          disabled={action.buttonMode !== 'send' || !selectedSessionId || action.isSending || action.authDisabled}
          aria-label={action.sendWithEnter ? 'Send message (Enter)' : 'Send message (Cmd+Enter)'}
          title={action.sendWithEnter ? 'Send (Enter)' : 'Send (Cmd+Enter)'}
        >
          <ArrowUp className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}
