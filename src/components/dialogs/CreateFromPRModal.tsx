'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAppStore } from '@/stores/appStore';
import { useShallow } from 'zustand/react/shallow';
import { useSettingsStore } from '@/stores/settingsStore';
import { navigate } from '@/lib/navigation';
import {
  resolvePR,
  createSession as createSessionApi,
  listConversations as listConversationsApi,
  listBranches,
  mapSessionDTO,
} from '@/lib/api';
import type { ResolvePRResponse } from '@/lib/api';
import type { SetupInfo } from '@/lib/types';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  GitPullRequest,
  GitBranch,
  AlertCircle,
  Loader2,
  Plus,
  Minus,
  FileCode,
  Users,
} from 'lucide-react';

interface CreateFromPRModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const PR_URL_PATTERN = /github\.com\/[^/]+\/[^/]+\/pull\/\d+/;

function buildPRSystemMessage(pr: ResolvePRResponse): string {
  const lines = [
    `## PR #${pr.prNumber}: ${pr.title}`,
    `**Branch:** ${pr.branch} \u2192 ${pr.baseBranch}`,
    `**Status:** ${pr.state}${pr.isDraft ? ' (Draft)' : ''}`,
    `**Changes:** +${pr.additions} -${pr.deletions} across ${pr.changedFiles} files`,
  ];
  if (pr.reviewers.length > 0) {
    lines.push(`**Reviewers:** ${pr.reviewers.join(', ')}`);
  }
  if (pr.labels.length > 0) {
    lines.push(`**Labels:** ${pr.labels.join(', ')}`);
  }
  lines.push('', '### Description', pr.body || 'No description provided.');
  return lines.join('\n');
}

interface BranchInfo {
  name: string;
  lastCommitDate: string;
  lastAuthor: string;
  lastCommitSubject: string;
  aheadMain: number;
  behindMain: number;
}

export function CreateFromPRModal({ isOpen, onClose }: CreateFromPRModalProps) {
  const [tab, setTab] = useState<string>('pr');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // PR tab state
  const [prUrl, setPrUrl] = useState('');
  const [prDetails, setPrDetails] = useState<ResolvePRResponse | null>(null);
  const [prLoading, setPrLoading] = useState(false);
  const [prError, setPrError] = useState('');

  // Branch tab state
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string>('');
  const [branches, setBranches] = useState<BranchInfo[]>([]);
  const [branchSearch, setBranchSearch] = useState('');
  const [branchLoading, setBranchLoading] = useState(false);
  const [selectedBranch, setSelectedBranch] = useState<string>('');

  const { workspaces, addSession, addConversation } = useAppStore(
    useShallow((s) => ({
      workspaces: s.workspaces,
      addSession: s.addSession,
      addConversation: s.addConversation,
    }))
  );
  const currentWorkspaceId = useAppStore((s) => s.selectedWorkspaceId);
  const { expandWorkspace } = useSettingsStore();

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setPrUrl('');
      setPrDetails(null);
      setPrError('');
      setPrLoading(false);
      setError('');
      setLoading(false);
      setBranches([]);
      setBranchSearch('');
      setSelectedBranch('');
      setSelectedWorkspaceId(currentWorkspaceId || '');
    }
  }, [isOpen, currentWorkspaceId]);

  // Resolve PR when URL changes (debounced with abort on cleanup)
  useEffect(() => {
    if (!prUrl || !PR_URL_PATTERN.test(prUrl)) {
      setPrDetails(null);
      setPrError('');
      return;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      setPrLoading(true);
      setPrError('');
      setPrDetails(null);
      try {
        const details = await resolvePR(prUrl);
        if (cancelled) return;
        setPrDetails(details);
        // Auto-select matched workspace
        if (details.matchedWorkspaceId) {
          setSelectedWorkspaceId(details.matchedWorkspaceId);
        }
      } catch (err) {
        if (cancelled) return;
        setPrError(err instanceof Error ? err.message : 'Failed to resolve PR');
      } finally {
        if (!cancelled) setPrLoading(false);
      }
    }, 500);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [prUrl]);

  // Fetch branches when workspace changes (branch tab)
  useEffect(() => {
    if (tab !== 'branch' || !selectedWorkspaceId) {
      setBranches([]);
      return;
    }

    const fetchBranches = async () => {
      setBranchLoading(true);
      try {
        const result = await listBranches(selectedWorkspaceId, {
          includeRemote: true,
          search: branchSearch || undefined,
          sortBy: 'date',
          limit: 50,
        });
        // Combine session and other branches, filter out session/* branches
        const allBranches = [...result.sessionBranches, ...result.otherBranches]
          .filter((b) => b.isRemote && !b.name.startsWith('session/'))
          .map((b) => ({
            name: b.name,
            lastCommitDate: b.lastCommitDate,
            lastAuthor: b.lastAuthor,
            lastCommitSubject: b.lastCommitSubject,
            aheadMain: b.aheadMain,
            behindMain: b.behindMain,
          }));
        setBranches(allBranches);
      } catch {
        setBranches([]);
      } finally {
        setBranchLoading(false);
      }
    };

    const timer = setTimeout(fetchBranches, 300);
    return () => clearTimeout(timer);
  }, [tab, selectedWorkspaceId, branchSearch]);

  const createSessionAndNavigate = useCallback(async (
    workspaceId: string,
    params: { branch: string; checkoutExisting: boolean; task?: string; systemMessage?: string },
  ) => {
    setLoading(true);
    setError('');
    try {
      const session = await createSessionApi(workspaceId, params);

      addSession(mapSessionDTO(session));

      const conversations = await listConversationsApi(workspaceId, session.id);
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

      expandWorkspace(workspaceId);
      navigate({
        workspaceId,
        sessionId: session.id,
        contentView: { type: 'conversation' },
      });

      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create session');
    } finally {
      setLoading(false);
    }
  }, [addSession, addConversation, expandWorkspace, onClose]);

  const createSessionFromPR = useCallback(async () => {
    if (!prDetails || !selectedWorkspaceId) return;
    await createSessionAndNavigate(selectedWorkspaceId, {
      branch: prDetails.branch,
      checkoutExisting: true,
      task: `${prDetails.title}\n\n${prDetails.body || ''}`.trim(),
      systemMessage: buildPRSystemMessage(prDetails),
    });
  }, [prDetails, selectedWorkspaceId, createSessionAndNavigate]);

  const createSessionFromBranch = useCallback(async () => {
    if (!selectedBranch || !selectedWorkspaceId) return;
    await createSessionAndNavigate(selectedWorkspaceId, {
      branch: selectedBranch,
      checkoutExisting: true,
    });
  }, [selectedBranch, selectedWorkspaceId, createSessionAndNavigate]);

  const canSubmitPR = prDetails && selectedWorkspaceId && !loading;
  const canSubmitBranch = selectedBranch && selectedWorkspaceId && !loading;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitPullRequest className="w-5 h-5" />
            New Session from PR / Branch
          </DialogTitle>
          <DialogDescription>
            Create a session that checks out an existing branch.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="pr" className="gap-1.5">
              <GitPullRequest className="w-3.5 h-3.5" />
              From PR
            </TabsTrigger>
            <TabsTrigger value="branch" className="gap-1.5">
              <GitBranch className="w-3.5 h-3.5" />
              From Branch
            </TabsTrigger>
          </TabsList>

          <TabsContent value="pr">
            <div className="space-y-3 py-2">
              <Input
                value={prUrl}
                onChange={(e) => setPrUrl(e.target.value)}
                placeholder="https://github.com/owner/repo/pull/123"
                className="font-mono text-sm"
                autoFocus
              />

              {prLoading && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Loading PR details...
                </div>
              )}

              {prError && (
                <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 p-3 rounded-lg">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  {prError}
                </div>
              )}

              {prDetails && (
                <div className="space-y-2 rounded-lg border p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="font-medium text-sm leading-snug">
                      #{prDetails.prNumber} {prDetails.title}
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {prDetails.isDraft && (
                        <Badge variant="outline" className="text-2xs">Draft</Badge>
                      )}
                      <Badge
                        variant={prDetails.state === 'open' ? 'default' : 'secondary'}
                        className="text-2xs"
                      >
                        {prDetails.state}
                      </Badge>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1 font-mono">
                      <GitBranch className="w-3 h-3" />
                      {prDetails.branch}
                    </span>
                    <span className="flex items-center gap-1">
                      <Plus className="w-3 h-3 text-green-500" />
                      {prDetails.additions}
                      <Minus className="w-3 h-3 text-red-500" />
                      {prDetails.deletions}
                    </span>
                    <span className="flex items-center gap-1">
                      <FileCode className="w-3 h-3" />
                      {prDetails.changedFiles} files
                    </span>
                    {prDetails.reviewers.length > 0 && (
                      <span className="flex items-center gap-1">
                        <Users className="w-3 h-3" />
                        {prDetails.reviewers.join(', ')}
                      </span>
                    )}
                  </div>

                  {prDetails.labels.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {prDetails.labels.map((label) => (
                        <Badge key={label} variant="outline" className="text-2xs">
                          {label}
                        </Badge>
                      ))}
                    </div>
                  )}

                  {!prDetails.matchedWorkspaceId && workspaces.length > 0 && (
                    <div className="space-y-1.5 pt-1">
                      <p className="text-xs text-amber-500">
                        No matching workspace found. Select one:
                      </p>
                      <Select value={selectedWorkspaceId} onValueChange={setSelectedWorkspaceId}>
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue placeholder="Select workspace" />
                        </SelectTrigger>
                        <SelectContent>
                          {workspaces.map((ws) => (
                            <SelectItem key={ws.id} value={ws.id} className="text-xs">
                              {ws.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  {prDetails.matchedWorkspaceId && (
                    <p className="text-xs text-muted-foreground">
                      Workspace: {workspaces.find((w) => w.id === prDetails.matchedWorkspaceId)?.name}
                    </p>
                  )}
                </div>
              )}
            </div>
          </TabsContent>

          <TabsContent value="branch">
            <div className="space-y-3 py-2">
              <Select value={selectedWorkspaceId} onValueChange={(v) => { setSelectedWorkspaceId(v); setSelectedBranch(''); }}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Select workspace" />
                </SelectTrigger>
                <SelectContent>
                  {workspaces.map((ws) => (
                    <SelectItem key={ws.id} value={ws.id} className="text-xs">
                      {ws.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {selectedWorkspaceId && (
                <>
                  <Input
                    value={branchSearch}
                    onChange={(e) => setBranchSearch(e.target.value)}
                    placeholder="Search branches..."
                    className="text-sm h-8"
                  />

                  <ScrollArea className="h-48 rounded-lg border">
                    {branchLoading ? (
                      <div className="flex items-center justify-center h-full py-8">
                        <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                      </div>
                    ) : branches.length === 0 ? (
                      <div className="flex items-center justify-center h-full py-8 text-xs text-muted-foreground">
                        No remote branches found
                      </div>
                    ) : (
                      <div className="p-1">
                        {branches.map((branch) => (
                          <button
                            key={branch.name}
                            className={`w-full text-left px-2 py-1.5 rounded text-xs transition-colors ${
                              selectedBranch === branch.name
                                ? 'bg-accent text-accent-foreground'
                                : 'hover:bg-accent/50'
                            }`}
                            onClick={() => setSelectedBranch(branch.name)}
                          >
                            <div className="flex items-center justify-between">
                              <span className="font-mono truncate">{branch.name}</span>
                              <span className="text-2xs text-muted-foreground shrink-0 ml-2">
                                {branch.lastAuthor}
                              </span>
                            </div>
                            <div className="text-2xs text-muted-foreground truncate mt-0.5">
                              {branch.lastCommitSubject}
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </ScrollArea>
                </>
              )}
            </div>
          </TabsContent>
        </Tabs>

        {error && (
          <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 p-3 rounded-lg">
            <AlertCircle className="w-4 h-4 shrink-0" />
            {error}
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          {tab === 'pr' ? (
            <Button
              onClick={createSessionFromPR}
              disabled={!canSubmitPR}
            >
              {loading ? 'Creating...' : 'Create Session'}
            </Button>
          ) : (
            <Button
              onClick={createSessionFromBranch}
              disabled={!canSubmitBranch}
            >
              {loading ? 'Creating...' : 'Create Session'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
