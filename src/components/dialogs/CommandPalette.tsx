'use client';

import { useState, useCallback } from 'react';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command';
import { useRepoState } from '@/stores/selectors';
import { useShortcut } from '@/hooks/useShortcut';
import {
  FolderGit2,
  Plus,
  Bot,
  GitBranch,
} from 'lucide-react';

interface CommandPaletteProps {
  onAddRepo: () => void;
  onSpawnAgent?: () => void;
}

export function CommandPalette({ onAddRepo, onSpawnAgent }: CommandPaletteProps) {
  const [open, setOpen] = useState(false);
  const { repos, selectedRepoId, selectRepo } = useRepoState();

  // Register Cmd+K shortcut
  useShortcut('commandPalette', useCallback(() => {
    setOpen((prev) => !prev);
  }, []));

  const runCommand = useCallback((command: () => void) => {
    setOpen(false);
    command();
  }, []);

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Type a command or search..." />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>

        <CommandGroup heading="Actions">
          <CommandItem onSelect={() => runCommand(onAddRepo)}>
            <Plus className="size-4" />
            Add Repository
          </CommandItem>
          {selectedRepoId && onSpawnAgent && (
            <CommandItem onSelect={() => runCommand(onSpawnAgent)}>
              <Bot className="size-4" />
              Spawn New Agent
            </CommandItem>
          )}
        </CommandGroup>

        {repos.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Repositories">
              {repos.map((repo) => (
                <CommandItem
                  key={repo.id}
                  onSelect={() => runCommand(() => selectRepo(repo.id))}
                >
                  <FolderGit2 className="size-4" />
                  <span className="flex-1">{repo.name}</span>
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    <GitBranch className="h-3 w-3" />
                    {repo.branch}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}
      </CommandList>
    </CommandDialog>
  );
}
