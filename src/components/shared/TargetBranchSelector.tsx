'use client';

import { useState, useCallback, useEffect } from 'react';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from '@/components/ui/command';
import { Button } from '@/components/ui/button';
import { GitBranch, Check, ArrowRight, RotateCcw } from 'lucide-react';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { listBranches, updateSession as apiUpdateSession, mapSessionDTO } from '@/lib/api';
import { useAppStore } from '@/stores/appStore';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';
import type { BranchDTO } from '@/lib/api';

interface TargetBranchSelectorProps {
  sessionId: string;
  workspaceId: string;
  currentTargetBranch?: string; // e.g. "origin/develop"
  workspaceDefaultBranch: string; // e.g. "main"
  variant?: 'toolbar' | 'panel';
  disabled?: boolean;
}

function stripOriginPrefix(branch: string): string {
  return branch.replace(/^origin\//, '');
}

export function TargetBranchSelector({
  sessionId,
  workspaceId,
  currentTargetBranch,
  workspaceDefaultBranch,
  variant = 'toolbar',
  disabled = false,
}: TargetBranchSelectorProps) {
  const [open, setOpen] = useState(false);
  const [branches, setBranches] = useState<BranchDTO[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const { showError } = useToast();
  const updateSession = useAppStore((s) => s.updateSession);

  const effectiveTarget = currentTargetBranch || `origin/${workspaceDefaultBranch}`;
  const displayTarget = stripOriginPrefix(effectiveTarget);
  const isDefault = !currentTargetBranch;

  const loadBranches = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listBranches(workspaceId, {
        includeRemote: true,
        sortBy: 'date',
        limit: 100,
      });
      // Combine and deduplicate — prefer remote branches for target selection
      const allBranches = [...res.sessionBranches, ...res.otherBranches];
      // Filter to remote branches only (since target branch is always "origin/...")
      const remoteBranches = allBranches.filter((b) => b.isRemote);
      setBranches(remoteBranches);
    } catch {
      showError('Failed to load branches');
    } finally {
      setLoading(false);
    }
  }, [workspaceId, showError]);

  useEffect(() => {
    if (open) {
      loadBranches();
      setSearch('');
    }
  }, [open, loadBranches]);

  const handleSelect = useCallback(
    async (branchName: string) => {
      // branchName is the remote branch name like "origin/develop"
      const newTarget = branchName === `origin/${workspaceDefaultBranch}` ? '' : branchName;
      setOpen(false);
      try {
        const updated = await apiUpdateSession(workspaceId, sessionId, {
          targetBranch: newTarget,
        });
        updateSession(sessionId, mapSessionDTO(updated));
      } catch {
        showError('Failed to update target branch');
      }
    },
    [workspaceId, sessionId, workspaceDefaultBranch, updateSession, showError],
  );

  const filteredBranches = branches.filter((b) => {
    if (!search) return true;
    const lower = search.toLowerCase();
    return b.name.toLowerCase().includes(lower);
  });

  if (variant === 'toolbar') {
    return (
      <Popover open={open} onOpenChange={setOpen}>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 gap-1 px-1.5 text-muted-foreground hover:text-foreground"
                disabled={disabled}
              >
                <ArrowRight className="h-3 w-3" />
                <span className="text-xs font-medium">{displayTarget}</span>
                {isDefault && (
                  <span className="text-[10px] text-muted-foreground/60">(default)</span>
                )}
              </Button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs">
            Target branch for PRs and sync
          </TooltipContent>
        </Tooltip>
        <PopoverContent className="w-64 p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput
              placeholder="Search branches..."
              value={search}
              onValueChange={setSearch}
            />
            <CommandList>
              <CommandEmpty>
                {loading ? 'Loading...' : 'No branches found'}
              </CommandEmpty>
              <CommandGroup>
                {filteredBranches.map((branch) => {
                  const remoteRef = branch.isRemote
                    ? branch.name
                    : `origin/${branch.name}`;
                  const isSelected = remoteRef === effectiveTarget;
                  const isWorkspaceDefault = stripOriginPrefix(remoteRef) === workspaceDefaultBranch;
                  return (
                    <CommandItem
                      key={branch.name}
                      value={branch.name}
                      onSelect={() => handleSelect(remoteRef)}
                    >
                      <GitBranch className="mr-2 h-3.5 w-3.5 text-muted-foreground" />
                      <span className="flex-1 truncate">
                        {stripOriginPrefix(branch.name)}
                      </span>
                      {isWorkspaceDefault && (
                        <span className="text-[10px] text-muted-foreground mr-1">default</span>
                      )}
                      {isSelected && (
                        <Check className="h-3.5 w-3.5 text-muted-foreground" />
                      )}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>
          </Command>
          {!isDefault && (
            <div className="border-t p-1">
              <Button
                variant="ghost"
                size="sm"
                className="w-full justify-start h-7 text-xs text-muted-foreground"
                onClick={() => handleSelect(`origin/${workspaceDefaultBranch}`)}
              >
                <RotateCcw className="mr-2 h-3 w-3" />
                Reset to workspace default ({workspaceDefaultBranch})
              </Button>
            </div>
          )}
        </PopoverContent>
      </Popover>
    );
  }

  // Panel variant - full row with label
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className={cn(
            'flex items-center gap-2 w-full text-left px-2 py-1 rounded-md',
            'hover:bg-muted/50 transition-colors text-sm',
            disabled && 'opacity-50 pointer-events-none',
          )}
          disabled={disabled}
        >
          <GitBranch className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <span className="text-muted-foreground text-xs shrink-0">Target</span>
          <span className="font-mono text-xs truncate">{displayTarget}</span>
          {isDefault && (
            <span className="text-[10px] text-muted-foreground/60 shrink-0">(default)</span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search branches..."
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            <CommandEmpty>
              {loading ? 'Loading...' : 'No branches found'}
            </CommandEmpty>
            <CommandGroup>
              {filteredBranches.map((branch) => {
                const remoteRef = branch.isRemote
                  ? branch.name
                  : `origin/${branch.name}`;
                const isSelected = remoteRef === effectiveTarget;
                const isWorkspaceDefault = stripOriginPrefix(remoteRef) === workspaceDefaultBranch;
                return (
                  <CommandItem
                    key={branch.name}
                    value={branch.name}
                    onSelect={() => handleSelect(remoteRef)}
                  >
                    <GitBranch className="mr-2 h-3.5 w-3.5 text-muted-foreground" />
                    <span className="flex-1 truncate">
                      {stripOriginPrefix(branch.name)}
                    </span>
                    {isWorkspaceDefault && (
                      <span className="text-[10px] text-muted-foreground mr-1">default</span>
                    )}
                    {isSelected && (
                      <Check className="h-3.5 w-3.5 text-muted-foreground" />
                    )}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
        {!isDefault && (
          <div className="border-t p-1">
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start h-7 text-xs text-muted-foreground"
              onClick={() => handleSelect(`origin/${workspaceDefaultBranch}`)}
            >
              <RotateCcw className="mr-2 h-3 w-3" />
              Reset to workspace default ({workspaceDefaultBranch})
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
