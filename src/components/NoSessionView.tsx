'use client';

import { useState, useCallback, useRef, useEffect, type ReactNode } from 'react';
import { GlassCard } from '@/components/ui/glass-card';
import { Button } from '@/components/ui/button';
import { useAppStore } from '@/stores/appStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { createSession as createSessionApi, listConversations as listConversationsApi } from '@/lib/api';
import type { SetupInfo } from '@/lib/types';
import { ADD_WORKSPACE_REQUESTED_EVENT } from '@/lib/constants';
import { Plus, FolderPlus, Loader2, Sparkles } from 'lucide-react';

interface NoSessionViewProps {
  children?: ReactNode;
}

export function NoSessionView({ children }: NoSessionViewProps) {
  const [isCreatingSession, setIsCreatingSession] = useState(false);

  // Get state from store
  const workspaces = useAppStore((s) => s.workspaces);
  const selectedWorkspaceId = useAppStore((s) => s.selectedWorkspaceId);
  const addSession = useAppStore((s) => s.addSession);
  const selectSession = useAppStore((s) => s.selectSession);
  const addConversation = useAppStore((s) => s.addConversation);
  const selectConversation = useAppStore((s) => s.selectConversation);
  const selectWorkspace = useAppStore((s) => s.selectWorkspace);

  // Get expandWorkspace from settings store (workspace collapse state is persisted)
  const expandWorkspace = useSettingsStore((s) => s.expandWorkspace);

  // Track mounted state to prevent state updates after unmount
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const hasWorkspaces = workspaces.length > 0;

  const handleCreateSession = useCallback(async () => {
    if (!selectedWorkspaceId || isCreatingSession) return;

    setIsCreatingSession(true);
    try {
      // Create session via backend API (generates city-based name, branch, and worktree path)
      const session = await createSessionApi(selectedWorkspaceId);

      // Check if component is still mounted before updating state
      if (!isMountedRef.current) return;

      // Add to local store
      addSession({
        id: session.id,
        workspaceId: session.workspaceId,
        name: session.name,
        branch: session.branch,
        worktreePath: session.worktreePath,
        task: session.task,
        status: session.status,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
      });

      // Fetch conversations created by backend (includes "Untitled" with setup info)
      const conversations = await listConversationsApi(selectedWorkspaceId, session.id);

      // Check again after second async operation
      if (!isMountedRef.current) return;

      conversations.forEach((conv) => {
        addConversation({
          id: conv.id,
          sessionId: conv.sessionId,
          type: conv.type,
          name: conv.name,
          status: conv.status,
          messages: conv.messages.map((m) => ({
            id: m.id,
            conversationId: conv.id,
            role: m.role as 'user' | 'assistant' | 'system',
            content: m.content,
            setupInfo: (m as { setupInfo?: SetupInfo }).setupInfo,
            timestamp: m.timestamp,
          })),
          toolSummary: conv.toolSummary,
          createdAt: conv.createdAt,
          updatedAt: conv.updatedAt,
        });
      });

      // Expand the workspace if not already
      expandWorkspace(selectedWorkspaceId);

      // Select the new session and first conversation
      selectWorkspace(selectedWorkspaceId);
      selectSession(session.id);
      if (conversations.length > 0) {
        selectConversation(conversations[0].id);
      }
    } catch (error) {
      if (isMountedRef.current) {
        console.error('Failed to create session:', error);
      }
    } finally {
      if (isMountedRef.current) {
        setIsCreatingSession(false);
      }
    }
  }, [
    selectedWorkspaceId,
    isCreatingSession,
    addSession,
    addConversation,
    expandWorkspace,
    selectWorkspace,
    selectSession,
    selectConversation,
  ]);

  const handleAddWorkspace = useCallback(() => {
    window.dispatchEvent(new CustomEvent(ADD_WORKSPACE_REQUESTED_EVENT));
  }, []);

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="relative flex flex-1 items-center justify-center overflow-hidden">
      {/* Animated gradient background */}
      <div className="absolute inset-0 overflow-hidden">
        {/* Large blur orbs */}
        <div
          className="absolute -top-1/4 -left-1/4 w-1/2 h-1/2 bg-primary/20 rounded-full blur-[120px] animate-gradient-shift"
          style={{ backgroundSize: '200% 200%' }}
        />
        <div
          className="absolute -bottom-1/4 -right-1/4 w-1/2 h-1/2 bg-purple-500/15 rounded-full blur-[120px] animate-gradient-shift"
          style={{ backgroundSize: '200% 200%', animationDelay: '-1.5s' }}
        />
        <div
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-1/3 h-1/3 bg-ai-active/10 rounded-full blur-[100px] animate-gradient-shift"
          style={{ backgroundSize: '200% 200%', animationDelay: '-0.75s' }}
        />
      </div>

      {/* Content */}
      <GlassCard variant="elevated" hover="none" padding="lg" className="relative z-10 w-full max-w-md animate-scale-in">
        <div className="flex flex-col items-center space-y-6">
          {/* Logo with gradient and glow */}
          <div className="flex flex-col items-center space-y-3">
            <div className="relative">
              {/* Glow effect */}
              <div className="absolute inset-0 bg-gradient-to-br from-primary to-purple-500 rounded-2xl blur-xl opacity-50" />
              {/* Logo */}
              <div className="relative flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-purple-500 shadow-lg">
                <Sparkles className="h-8 w-8 text-white" />
              </div>
            </div>
            <h1 className="font-display text-xl font-semibold tracking-tight">Conductor</h1>
          </div>

          {/* Conditional content based on state */}
          {!hasWorkspaces ? (
            // No workspaces - prompt to add one
            <div className="flex flex-col items-center space-y-4 text-center">
              <p className="text-sm text-muted-foreground">
                Add a repository to start working with AI agents
              </p>
              <Button
                size="lg"
                onClick={handleAddWorkspace}
                className="h-11 px-6 bg-gradient-to-r from-primary to-purple-500 hover:from-primary/90 hover:to-purple-500/90 shadow-lg shadow-primary/25 transition-all duration-200"
              >
                <FolderPlus className="mr-2 h-5 w-5" />
                Add Repository
              </Button>
            </div>
          ) : !selectedWorkspaceId ? (
            // Workspaces exist but none selected
            <div className="text-center">
              <p className="text-sm text-muted-foreground">
                Select a workspace from the sidebar to continue
              </p>
            </div>
          ) : (
            // Workspace selected - can create session
            <div className="flex flex-col items-center space-y-4 text-center">
              <p className="text-sm text-muted-foreground">
                Create a new session to start working
              </p>
              <Button
                size="lg"
                onClick={handleCreateSession}
                disabled={isCreatingSession}
                className="h-11 px-6 bg-gradient-to-r from-primary to-purple-500 hover:from-primary/90 hover:to-purple-500/90 shadow-lg shadow-primary/25 transition-all duration-200 disabled:opacity-50"
              >
                {isCreatingSession ? (
                  <>
                    <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                    Creating...
                  </>
                ) : (
                  <>
                    <Plus className="mr-2 h-5 w-5" />
                    New Session
                  </>
                )}
              </Button>
              <p className="text-xs text-muted-foreground/70">
                Or select an existing session from the sidebar
              </p>
            </div>
          )}
        </div>
      </GlassCard>
      </div>
      {children && <div className="shrink-0">{children}</div>}
    </div>
  );
}
