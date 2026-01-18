'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command';
import { useAppStore } from '@/stores/appStore';
import {
  FolderGit2,
  Plus,
  Bot,
  Settings,
  GitBranch,
  Trash2,
} from 'lucide-react';

interface CommandPaletteProps {
  onAddRepo: () => void;
  onSpawnAgent?: () => void;
}

export function CommandPalette({ onAddRepo, onSpawnAgent }: CommandPaletteProps) {
  const [open, setOpen] = useState(false);
  const { repos, selectedRepoId, selectRepo } = useAppStore();

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((open) => !open);
      }
    };

    document.addEventListener('keydown', down);
    return () => document.removeEventListener('keydown', down);
  }, []);

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
            <Plus className="mr-2 h-4 w-4" />
            Add Repository
          </CommandItem>
          {selectedRepoId && onSpawnAgent && (
            <CommandItem onSelect={() => runCommand(onSpawnAgent)}>
              <Bot className="mr-2 h-4 w-4" />
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
                  <FolderGit2 className="mr-2 h-4 w-4" />
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
