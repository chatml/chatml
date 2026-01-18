'use client';

import { useAppStore } from '@/stores/appStore';
import { deleteRepo } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
  FolderGit2,
  Plus,
  GitBranch,
  X,
  Bot,
  Zap,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface RepoListProps {
  onAddClick: () => void;
}

export function RepoList({ onAddClick }: RepoListProps) {
  const { repos, selectedRepoId, selectRepo, removeRepo, agents } = useAppStore();

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await deleteRepo(id);
    removeRepo(id);
  };

  const getRepoAgentCount = (repoId: string) => {
    return agents.filter((a) => a.repoId === repoId).length;
  };

  const getRunningAgentCount = (repoId: string) => {
    return agents.filter((a) => a.repoId === repoId && a.status === 'running').length;
  };

  return (
    <div className="w-64 border-r flex flex-col h-screen bg-sidebar">
      {/* Header */}
      <div className="p-4 flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
          <Zap className="w-4 h-4 text-primary-foreground" />
        </div>
        <div>
          <h1 className="text-sm font-semibold">ChatML</h1>
          <p className="text-xs text-muted-foreground">Agent Orchestration</p>
        </div>
      </div>

      <Separator />

      {/* Repo List */}
      <div className="flex-1 flex flex-col min-h-0">
        <div className="px-4 py-3 flex items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Repositories
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={onAddClick}
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>

        <ScrollArea className="flex-1 px-2">
          <div className="space-y-1 pb-2">
            {repos.length === 0 ? (
              <div className="px-3 py-8 text-center">
                <FolderGit2 className="w-8 h-8 mx-auto text-muted-foreground/50 mb-2" />
                <p className="text-sm text-muted-foreground">No repositories</p>
                <p className="text-xs text-muted-foreground/70 mt-1">
                  Click + to add one
                </p>
              </div>
            ) : (
              repos.map((repo) => {
                const agentCount = getRepoAgentCount(repo.id);
                const runningCount = getRunningAgentCount(repo.id);
                const isSelected = selectedRepoId === repo.id;

                return (
                  <div
                    key={repo.id}
                    onClick={() => selectRepo(repo.id)}
                    className={cn(
                      'group relative rounded-lg p-2.5 cursor-pointer transition-colors',
                      isSelected
                        ? 'bg-accent text-accent-foreground'
                        : 'hover:bg-accent/50'
                    )}
                  >
                    <div className="flex items-start gap-2.5">
                      <div
                        className={cn(
                          'w-8 h-8 rounded-md flex items-center justify-center shrink-0',
                          isSelected ? 'bg-primary/10' : 'bg-muted'
                        )}
                      >
                        <FolderGit2
                          className={cn(
                            'w-4 h-4',
                            isSelected ? 'text-primary' : 'text-muted-foreground'
                          )}
                        />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm truncate">
                            {repo.name}
                          </span>
                          {runningCount > 0 && (
                            <span className="flex items-center gap-1 text-xs px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-500">
                              <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
                              {runningCount}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-xs text-muted-foreground flex items-center gap-1">
                            <GitBranch className="w-3 h-3" />
                            {repo.branch}
                          </span>
                          {agentCount > 0 && (
                            <span className="text-xs text-muted-foreground flex items-center gap-1">
                              <Bot className="w-3 h-3" />
                              {agentCount}
                            </span>
                          )}
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                        onClick={(e) => handleDelete(repo.id, e)}
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </ScrollArea>
      </div>

      {/* Footer */}
      <Separator />
      <div className="p-3">
        <Button onClick={onAddClick} className="w-full" variant="outline">
          <Plus className="w-4 h-4 mr-2" />
          Add Repository
        </Button>
      </div>
    </div>
  );
}
