import { Fragment, useCallback } from 'react';
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
  Zap,
  Plus,
  Link,
  FolderSymlink,
  Check,
  Star,
  Sparkles,
  Shield,
  Mic,
  MicOff,
  Hand,
  Code,
  ClipboardList,
  AlertTriangle,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
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

export type PermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions' | 'dontAsk';

export interface PermissionModeProps {
  mode: PermissionMode;
  defaultMode: PermissionMode;
  setMode: (mode: PermissionMode) => void;
  setDefault: (mode: PermissionMode) => void;
}

interface PermissionOption {
  id: PermissionMode;
  label: string;
  description: string;
  icon: LucideIcon;
  muted?: boolean;
}

const PERMISSION_MODE_OPTIONS: PermissionOption[] = [
  { id: 'default', label: 'Ask permissions', description: 'Always ask before making changes', icon: Hand },
  { id: 'acceptEdits', label: 'Auto accept edits', description: 'Automatically accept all file edits', icon: Code },
  { id: 'dontAsk', label: 'Read-only', description: 'Only read tools allowed, all others denied', icon: Shield },
  { id: 'bypassPermissions', label: 'Bypass permissions', description: 'Accepts all permissions', icon: AlertTriangle, muted: true },
];

export interface DictationProps {
  isDictating: boolean;
  isAvailable: boolean;
  onToggle: () => void;
  shortcutHint: string;
}
interface ChatInputToolbarProps {
  model: ModelProps;
  thinking: ThinkingProps;
  permissionMode: PermissionModeProps;
  planModeEnabled: boolean;
  onPlanModeToggle: () => void;
  fastModeEnabled: boolean;
  onFastModeToggle: () => void;
  showFastMode: boolean;
  selectedConversationId: string | null;
  selectedSessionId: string | null;
  attachments: AttachmentMenuProps;
  action: ActionButtonProps;
  showInfo: (msg: string) => void;
  dictation?: DictationProps;
}

export function ChatInputToolbar({
  model,
  thinking,
  permissionMode,
  planModeEnabled,
  onPlanModeToggle,
  fastModeEnabled,
  onFastModeToggle,
  showFastMode,
  selectedConversationId,
  selectedSessionId,
  attachments,
  action,
  showInfo,
  dictation,
}: ChatInputToolbarProps) {
  const selectedOptionId = permissionMode.mode;
  const resolvedPermOption = PERMISSION_MODE_OPTIONS.find((o) => o.id === selectedOptionId)
    ?? { id: permissionMode.mode, label: permissionMode.mode, description: '', icon: Shield, muted: false } as PermissionOption;
  const isPermModified = permissionMode.mode !== permissionMode.defaultMode;

  const handlePermissionSelect = useCallback((id: PermissionMode) => {
    if (id === selectedOptionId) return;
    permissionMode.setMode(id);
  }, [selectedOptionId, permissionMode]);
  return (
    <div className="flex items-center gap-1 px-2 pb-2">
      {/* Model Selector */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-xs" title={`Model: ${model.selected.name}${model.selected.id === model.defaultId ? ' (default)' : ''}`}>
            <Sparkles className="h-3.5 w-3.5" />
            {model.selected.name}
            <ChevronDown className="h-3 w-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuLabel className="text-2xs font-normal text-muted-foreground uppercase tracking-wider">
            Claude Code
          </DropdownMenuLabel>
          {model.models.map((m, index) => {
            const isDefault = m.id === model.defaultId;
            const isSelected = m.id === model.selected.id;
            return (
              <DropdownMenuItem
                key={m.id}
                className="group flex items-start gap-2 pr-1.5 py-2"
                onClick={() => model.setSelected(m)}
              >
                <span className="flex flex-1 flex-col min-w-0">
                  <span className="truncate font-medium">{m.name}</span>
                  {m.description && (
                    <span className="text-xs text-muted-foreground leading-tight">
                      {m.description}
                    </span>
                  )}
                </span>
                <span className="mt-0.5 flex shrink-0 items-center gap-1">
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
                  {index < 9 && (
                    <kbd className="text-[10px] text-muted-foreground/50 min-w-[1ch] text-right ml-1">{index + 1}</kbd>
                  )}
                </span>
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Fast Mode Toggle */}
      {showFastMode && (
        <Button
          variant="ghost"
          size={fastModeEnabled ? 'sm' : 'icon'}
          className={cn(
            fastModeEnabled ? 'h-7 gap-1.5 px-2' : 'h-7 w-7',
            fastModeEnabled && 'text-amber-500 hover:text-amber-600 bg-amber-500/10 hover:bg-amber-500/20'
          )}
          onClick={onFastModeToggle}
          title={`Fast mode ${fastModeEnabled ? 'on' : 'off'} — applies to next message (⌥F)`}
          aria-label={`Fast mode ${fastModeEnabled ? 'on' : 'off'}`}
          aria-pressed={fastModeEnabled}
        >
          <Zap className="h-4 w-4" />
          {fastModeEnabled && <span className="text-xs font-medium">Fast</span>}
        </Button>
      )}

      {/* Plan Mode Toggle */}
      <Button
        variant="ghost"
        size={planModeEnabled ? 'sm' : 'icon'}
        className={cn(
          planModeEnabled ? 'h-7 gap-1.5 px-2' : 'h-7 w-7',
          planModeEnabled && 'text-amber-500 hover:text-amber-600 bg-amber-500/10 hover:bg-amber-500/20'
        )}
        onClick={onPlanModeToggle}
        title={`Plan mode ${planModeEnabled ? 'on' : 'off'} (⌥P)`}
        aria-label={`Plan mode ${planModeEnabled ? 'on' : 'off'}`}
        aria-pressed={planModeEnabled}
      >
        <ClipboardList className="h-4 w-4" />
        {planModeEnabled && <span className="text-xs font-medium">Plan</span>}
      </Button>

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

      {/* Permission Mode Dropdown */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              'h-7 gap-1.5 px-2 text-xs',
              isPermModified && 'text-amber-500 hover:text-amber-600 bg-amber-500/10 hover:bg-amber-500/20',
            )}
            title={`Permissions: ${resolvedPermOption.label}`}
            aria-label={`Permissions: ${resolvedPermOption.label}`}
          >
            <resolvedPermOption.icon className="h-4 w-4" />
            <span className="font-medium">{resolvedPermOption.label}</span>
            <ChevronDown className="h-3 w-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-72">
          {PERMISSION_MODE_OPTIONS.map((option) => {
            const isSelected = option.id === selectedOptionId;
            const isDefault = option.id === permissionMode.defaultMode;
            const Icon = option.icon;
            return (
              <DropdownMenuItem
                key={option.id}
                onClick={() => handlePermissionSelect(option.id)}
                className={cn(
                  'group flex items-start gap-3 py-2.5',
                  option.muted && 'text-muted-foreground',
                )}
              >
                <Icon className={cn('h-4 w-4 mt-0.5 shrink-0', option.muted && 'text-muted-foreground/60')} />
                <div className="flex flex-col gap-0.5 min-w-0">
                  <span className={cn('font-medium text-sm', option.muted && 'text-muted-foreground')}>{option.label}</span>
                  <span className="text-xs text-muted-foreground leading-tight">{option.description}</span>
                </div>
                <span className="ml-auto flex shrink-0 items-center gap-1 mt-0.5">
                  {isSelected && <Check className="h-4 w-4 text-blue-500" />}
                  {isDefault ? (
                    <Star className="h-3 w-3 fill-current text-amber-500" />
                  ) : (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          aria-label={`Set ${option.label} as default permission mode`}
                          className="flex items-center justify-center rounded p-0.5 text-muted-foreground/50 opacity-0 transition-opacity group-hover:opacity-100 hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                          onPointerDown={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                          }}
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            permissionMode.setDefault(option.id);
                            showInfo(`${option.label} set as default permission mode`);
                          }}
                        >
                          <Star className="h-3 w-3" />
                        </button>
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

      {/* Dictation toggle */}
      {dictation?.isAvailable && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                'h-7 w-7 rounded-md',
                dictation.isDictating && 'dictation-active text-blue-500'
              )}
              onClick={dictation.onToggle}
              aria-label={dictation.isDictating ? 'Stop dictation' : 'Start dictation'}
            >
              {dictation.isDictating ? (
                <MicOff className="size-4" />
              ) : (
                <Mic className="size-4" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">
            {dictation.isDictating ? 'Stop dictation' : 'Start dictation'} ({dictation.shortcutHint})
          </TooltipContent>
        </Tooltip>
      )}

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
