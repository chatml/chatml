'use client';

import { useEffect, useState } from 'react';
import { useAppStore } from '@/stores/appStore';
import { getRepoDetails, type RepoDetailsDTO } from '@/lib/api';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import {
  ArrowLeft,
  GitBranch,
  FolderOpen,
  Globe,
  ExternalLink,
} from 'lucide-react';

interface WorkspaceSettingsProps {
  workspaceId: string;
  onBack: () => void;
}

export function WorkspaceSettings({ workspaceId, onBack }: WorkspaceSettingsProps) {
  const { workspaces } = useAppStore();
  const workspace = workspaces.find((w) => w.id === workspaceId);
  const [repoDetails, setRepoDetails] = useState<RepoDetailsDTO | null>(null);

  // Fetch repo details on mount
  useEffect(() => {
    const fetchDetails = async () => {
      try {
        const details = await getRepoDetails(workspaceId);
        setRepoDetails(details);
      } catch (error) {
        console.error('Failed to fetch repo details:', error);
      }
    };
    fetchDetails();
  }, [workspaceId]);

  // Handle Escape key to go back
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onBack();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onBack]);

  if (!workspace) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        Workspace not found
      </div>
    );
  }

  return (
    <div className="flex h-full bg-background">
      {/* Left Sidebar */}
      <div className="w-56 border-r bg-sidebar flex flex-col">
        {/* Back button - with padding for macOS traffic lights */}
        <div data-tauri-drag-region className="h-10 pl-20 pr-3 flex items-center border-b shrink-0">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 -ml-2 text-muted-foreground hover:text-foreground"
            onClick={onBack}
          >
            <ArrowLeft className="w-4 h-4" />
            Back to app
          </Button>
        </div>

        <ScrollArea className="flex-1">
          <div className="py-2 px-2">
            <div className="space-y-0.5">
              <div className="px-2 py-1.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                {workspace.name}
              </div>
            </div>
          </div>
        </ScrollArea>
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {/* Drag region for window */}
        <div data-tauri-drag-region className="h-10 shrink-0 border-b" />

        <ScrollArea className="flex-1">
          <div className="max-w-2xl mx-auto py-8 px-8">
            {/* Repository Info Section */}
            <div className="mb-8">
              <h2 className="text-xl font-semibold mb-5">Repository</h2>

              <div className="space-y-4">
                <div className="flex items-start gap-3 py-3 border-b border-border/50">
                  <FolderOpen className="w-4 h-4 mt-0.5 text-muted-foreground" />
                  <div className="flex-1">
                    <h4 className="text-[13px] font-medium">Path</h4>
                    <p className="text-[12px] text-muted-foreground mt-0.5 font-mono">
                      {workspace.path}
                    </p>
                  </div>
                </div>

                {repoDetails?.workspacesPath && (
                  <div className="flex items-start gap-3 py-3 border-b border-border/50">
                    <FolderOpen className="w-4 h-4 mt-0.5 text-muted-foreground" />
                    <div className="flex-1">
                      <h4 className="text-[13px] font-medium">Workspaces Path</h4>
                      <p className="text-[12px] text-muted-foreground mt-0.5 font-mono">
                        {repoDetails.workspacesPath}
                      </p>
                    </div>
                  </div>
                )}

                <div className="flex items-start gap-3 py-3 border-b border-border/50">
                  <GitBranch className="w-4 h-4 mt-0.5 text-muted-foreground" />
                  <div className="flex-1">
                    <h4 className="text-[13px] font-medium">Default Branch</h4>
                    <p className="text-[12px] text-muted-foreground mt-0.5">
                      {workspace.defaultBranch || 'main'}
                    </p>
                  </div>
                </div>

                {repoDetails?.remoteUrl && (
                  <div className="flex items-start gap-3 py-3 border-b border-border/50">
                    <Globe className="w-4 h-4 mt-0.5 text-muted-foreground" />
                    <div className="flex-1">
                      <h4 className="text-[13px] font-medium">Remote Origin</h4>
                      <div className="flex items-center gap-2 mt-0.5">
                        <p className="text-[12px] text-muted-foreground font-mono">
                          git+{repoDetails.remoteUrl}.git
                        </p>
                        <a
                          href={repoDetails.remoteUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary hover:text-primary/80 transition-colors"
                        >
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}
