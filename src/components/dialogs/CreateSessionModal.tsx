'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useAppStore } from '@/stores/appStore';
import { useShallow } from 'zustand/react/shallow';
import { useSettingsStore } from '@/stores/settingsStore';
import { navigate } from '@/lib/navigation';
import {
  resolvePR,
  getPRs,
  createSession as createSessionApi,
  listConversations as listConversationsApi,
  listBranches,
  listGitHubIssues,
  searchGitHubIssues,
  getGitHubIssueDetails,
  listMyLinearIssues,
  searchLinearIssues,
  mapSessionDTO,
} from '@/lib/api';
import type {
  PRDashboardItem,
  ResolvePRResponse,
  GitHubIssueListItem,
  LinearIssueDTO,
} from '@/lib/api';
import type { SetupInfo } from '@/lib/types';
import { useBranchCacheStore } from '@/stores/branchCacheStore';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
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
  CircleDot,
  Loader2,
  GitMerge,
  CircleDashed,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { getWorkspaceColor } from '@/lib/workspace-colors';
import { buildContextAttachment } from '@/lib/attachments';

// ============================================================================
// Types
// ============================================================================

interface CreateSessionModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type TabId = 'pr' | 'branch' | 'issues';

interface BranchInfo {
  name: string;
  lastCommitDate: string;
  lastAuthor: string;
  lastCommitSubject: string;
  aheadMain: number;
  behindMain: number;
}

// ============================================================================
// Helpers
// ============================================================================

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

function buildGitHubIssueSystemMessage(issue: GitHubIssueListItem, body: string): string {
  const lines = [
    `## GitHub Issue #${issue.number}: ${issue.title}`,
    `**State:** ${issue.state}`,
    `**Author:** ${issue.user.login}`,
  ];
  if (issue.labels.length > 0) {
    lines.push(`**Labels:** ${issue.labels.map((l) => l.name).join(', ')}`);
  }
  if (issue.assignees.length > 0) {
    lines.push(`**Assignees:** ${issue.assignees.map((a) => a.login).join(', ')}`);
  }
  lines.push('', '### Description', body || 'No description provided.');
  return lines.join('\n');
}

function buildLinearIssueSystemMessage(issue: LinearIssueDTO): string {
  const lines = [
    `## ${issue.identifier}: ${issue.title}`,
    `**Status:** ${issue.stateName}`,
  ];
  if (issue.assignee) {
    lines.push(`**Assignee:** ${issue.assignee}`);
  }
  if (issue.labels.length > 0) {
    lines.push(`**Labels:** ${issue.labels.join(', ')}`);
  }
  if (issue.project) {
    lines.push(`**Project:** ${issue.project}`);
  }
  lines.push('', '### Description', issue.description || 'No description provided.');
  return lines.join('\n');
}

// Protected branch names to filter out from branch list
const PROTECTED_BRANCHES = ['main', 'master', 'develop'];

function filterBranches(
  rawBranches: { name: string; isRemote: boolean; lastCommitDate: string; lastAuthor: string; lastCommitSubject: string; aheadMain: number; behindMain: number }[]
): BranchInfo[] {
  return rawBranches
    .filter((b) => {
      if (!b.isRemote) return false;
      if (b.name.startsWith('session/')) return false;
      const branchName = b.name.replace(/^origin\//, '');
      return !PROTECTED_BRANCHES.includes(branchName);
    })
    .map((b) => ({
      name: b.name,
      lastCommitDate: b.lastCommitDate,
      lastAuthor: b.lastAuthor,
      lastCommitSubject: b.lastCommitSubject,
      aheadMain: b.aheadMain,
      behindMain: b.behindMain,
    }));
}

function PRStatusIcon({ state, isDraft }: { state: string; isDraft: boolean }) {
  if (isDraft) return <CircleDashed className="w-3.5 h-3.5 text-muted-foreground shrink-0" />;
  if (state === 'merged') return <GitMerge className="w-3.5 h-3.5 text-purple-500 shrink-0" />;
  if (state === 'closed') return <CircleDot className="w-3.5 h-3.5 text-red-500 shrink-0" />;
  return <GitPullRequest className="w-3.5 h-3.5 text-green-500 shrink-0" />;
}

// ============================================================================
// Tab Button
// ============================================================================

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'px-3 py-1 text-xs font-medium rounded-md transition-colors',
        active
          ? 'bg-accent text-accent-foreground'
          : 'text-muted-foreground hover:text-foreground hover:bg-muted'
      )}
    >
      {children}
    </button>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export function CreateSessionModal({ isOpen, onClose }: CreateSessionModalProps) {
  const [tab, setTab] = useState<TabId>('pr');
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const creatingRef = useRef(false);
  const [error, setError] = useState('');

  // Workspace state
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string>('');

  // PR tab state
  const [prs, setPrs] = useState<PRDashboardItem[]>([]);
  const [prLoading, setPrLoading] = useState(false);

  // Branch tab state
  const [branches, setBranches] = useState<BranchInfo[]>([]);
  const [branchLoading, setBranchLoading] = useState(false);

  // Issues tab state
  const [githubIssues, setGithubIssues] = useState<GitHubIssueListItem[]>([]);
  const [linearIssues, setLinearIssues] = useState<LinearIssueDTO[]>([]);
  const [issuesLoading, setIssuesLoading] = useState(false);

  const { workspaces, addSession, addConversation } = useAppStore(
    useShallow((s) => ({
      workspaces: s.workspaces,
      addSession: s.addSession,
      addConversation: s.addConversation,
    }))
  );
  const currentWorkspaceId = useAppStore((s) => s.selectedWorkspaceId);
  const { expandWorkspace } = useSettingsStore();
  const workspaceColors = useSettingsStore((s) => s.workspaceColors);

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setSearch('');
      setError('');
      setCreating(false);
      creatingRef.current = false;
      setTab('pr');
      setPrs([]);
      setBranches([]);
      setGithubIssues([]);
      setLinearIssues([]);
    }
  }, [isOpen]);

  // Sync selected workspace when modal opens or current workspace changes
  useEffect(() => {
    if (isOpen) {
      setSelectedWorkspaceId(currentWorkspaceId || workspaces[0]?.id || '');
    }
  }, [isOpen, currentWorkspaceId, workspaces]);

  // ============================================================================
  // Data Fetching
  // ============================================================================

  // Fetch PRs when workspace changes or PR tab is active
  useEffect(() => {
    if (!isOpen || tab !== 'pr' || !selectedWorkspaceId) {
      return;
    }

    let cancelled = false;
    const fetchPRs = async () => {
      setPrLoading(true);
      try {
        const result = await getPRs(selectedWorkspaceId);
        if (!cancelled) setPrs(result);
      } catch (err) {
        if (!cancelled) {
          setPrs([]);
          setError(err instanceof Error ? err.message : 'Failed to load pull requests');
        }
      } finally {
        if (!cancelled) setPrLoading(false);
      }
    };

    fetchPRs();
    return () => { cancelled = true; };
  }, [isOpen, tab, selectedWorkspaceId]);

  // Fetch branches when workspace changes or branch tab is active
  useEffect(() => {
    if (!isOpen || tab !== 'branch' || !selectedWorkspaceId) {
      setBranches([]);
      return;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      setBranchLoading(true);
      try {
        if (!search) {
          const cached = await useBranchCacheStore.getState().fetchBranches(selectedWorkspaceId);
          if (!cancelled) setBranches(filterBranches(cached).slice(0, 50));
        } else {
          const result = await listBranches(selectedWorkspaceId, {
            includeRemote: true,
            search,
            sortBy: 'date',
            limit: 50,
          });
          const allBranches = [...result.sessionBranches, ...result.otherBranches];
          if (!cancelled) setBranches(filterBranches(allBranches));
        }
      } catch (err) {
        if (!cancelled) {
          setBranches([]);
          setError(err instanceof Error ? err.message : 'Failed to load branches');
        }
      } finally {
        if (!cancelled) setBranchLoading(false);
      }
    }, 300);

    return () => { cancelled = true; clearTimeout(timer); };
  }, [isOpen, tab, selectedWorkspaceId, search]);

  // Fetch issues when workspace changes or issues tab is active.
  // No guard on selectedWorkspaceId: Linear issues are workspace-independent,
  // and GitHub issues gracefully fall back to [] when no workspace is selected.
  useEffect(() => {
    if (!isOpen || tab !== 'issues') {
      return;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      setIssuesLoading(true);
      try {
        if (!search) {
          // Fetch both GitHub and Linear issues in parallel
          const [ghResult, linearResult] = await Promise.allSettled([
            selectedWorkspaceId ? listGitHubIssues(selectedWorkspaceId) : Promise.resolve([]),
            listMyLinearIssues(),
          ]);
          if (!cancelled) {
            setGithubIssues(ghResult.status === 'fulfilled' ? ghResult.value : []);
            setLinearIssues(linearResult.status === 'fulfilled' ? linearResult.value : []);
          }
        } else {
          // Search both in parallel
          const [ghResult, linearResult] = await Promise.allSettled([
            selectedWorkspaceId ? searchGitHubIssues(selectedWorkspaceId, search) : Promise.resolve({ totalCount: 0, issues: [] }),
            searchLinearIssues(search),
          ]);
          if (!cancelled) {
            setGithubIssues(ghResult.status === 'fulfilled' ? ghResult.value.issues : []);
            setLinearIssues(linearResult.status === 'fulfilled' ? linearResult.value : []);
          }
        }
      } catch (err) {
        if (!cancelled) {
          setGithubIssues([]);
          setLinearIssues([]);
          setError(err instanceof Error ? err.message : 'Failed to load issues');
        }
      } finally {
        if (!cancelled) setIssuesLoading(false);
      }
    }, 300);

    return () => { cancelled = true; clearTimeout(timer); };
  }, [isOpen, tab, selectedWorkspaceId, search]);

  // ============================================================================
  // Filtered items (client-side for PRs)
  // ============================================================================

  const filteredPRs = useMemo(() => {
    if (!search) return prs;
    const q = search.toLowerCase();
    return prs.filter((pr) =>
      pr.title.toLowerCase().includes(q) ||
      String(pr.number).includes(q) ||
      pr.branch.toLowerCase().includes(q)
    );
  }, [prs, search]);

  // ============================================================================
  // Session Creation
  // ============================================================================

  const createSessionAndNavigate = useCallback(async (
    workspaceId: string,
    params: { branch: string; checkoutExisting: boolean; task?: string; systemMessage?: string },
    draft?: { text: string; attachments: import('@/lib/types').Attachment[] },
  ) => {
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

    // Set draft BEFORE navigation so ChatInput picks it up on mount
    if (draft) {
      useAppStore.getState().setDraftInput(session.id, draft);
    }

    expandWorkspace(workspaceId);
    navigate({
      workspaceId,
      sessionId: session.id,
      contentView: { type: 'conversation' },
    });

    onClose();
  }, [addSession, addConversation, expandWorkspace, onClose]);

  // Handle PR selection
  const handleSelectPR = useCallback(async (pr: PRDashboardItem) => {
    if (creatingRef.current || !selectedWorkspaceId) return;
    creatingRef.current = true;
    setCreating(true);
    setError('');
    try {
      // Resolve full PR details for the system message
      const details = await resolvePR(pr.htmlUrl);
      await createSessionAndNavigate(selectedWorkspaceId, {
        branch: details.branch,
        checkoutExisting: true,
        task: `${details.title}\n\n${details.body || ''}`.trim(),
        systemMessage: buildPRSystemMessage(details),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create session');
    } finally {
      creatingRef.current = false;
      setCreating(false);
    }
  }, [selectedWorkspaceId, createSessionAndNavigate]);

  // Handle branch selection
  const handleSelectBranch = useCallback(async (branchName: string) => {
    if (creatingRef.current || !selectedWorkspaceId) return;
    creatingRef.current = true;
    setCreating(true);
    setError('');
    try {
      await createSessionAndNavigate(selectedWorkspaceId, {
        branch: branchName,
        checkoutExisting: true,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create session');
    } finally {
      creatingRef.current = false;
      setCreating(false);
    }
  }, [selectedWorkspaceId, createSessionAndNavigate]);

  // Handle GitHub issue selection
  const handleSelectGitHubIssue = useCallback(async (issue: GitHubIssueListItem) => {
    if (creatingRef.current || !selectedWorkspaceId) return;
    creatingRef.current = true;
    setCreating(true);
    setError('');
    try {
      // Fetch full issue body
      const details = await getGitHubIssueDetails(selectedWorkspaceId, issue.number);
      const systemMessage = buildGitHubIssueSystemMessage(issue, details.body);

      // Build context attachment so the issue appears in the composer
      const issueAttachment = buildContextAttachment({
        contextType: 'github-issue',
        title: `#${issue.number} ${issue.title}`,
        markdownBody: systemMessage,
        meta: {
          number: issue.number,
          title: issue.title,
          url: issue.htmlUrl,
          state: issue.state,
        },
      });

      // Empty branch tells the backend to auto-create a new session branch
      await createSessionAndNavigate(selectedWorkspaceId, {
        branch: '',
        checkoutExisting: false,
        task: issue.title,
        systemMessage,
      }, { text: '', attachments: [issueAttachment] });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create session');
    } finally {
      creatingRef.current = false;
      setCreating(false);
    }
  }, [selectedWorkspaceId, createSessionAndNavigate]);

  // Handle Linear issue selection
  const handleSelectLinearIssue = useCallback(async (issue: LinearIssueDTO) => {
    if (creatingRef.current || !selectedWorkspaceId) return;
    creatingRef.current = true;
    setCreating(true);
    setError('');
    try {
      const systemMessage = buildLinearIssueSystemMessage(issue);

      // Build context attachment so the issue appears in the composer
      const linearAttachment = buildContextAttachment({
        contextType: 'linear-issue',
        title: `${issue.identifier} ${issue.title}`,
        markdownBody: systemMessage,
        meta: {
          identifier: issue.identifier,
          title: issue.title,
          state: issue.stateName,
        },
      });

      // Empty branch tells the backend to auto-create a new session branch
      await createSessionAndNavigate(selectedWorkspaceId, {
        branch: '',
        checkoutExisting: false,
        task: issue.title,
        systemMessage,
      }, { text: '', attachments: [linearAttachment] });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create session');
    } finally {
      creatingRef.current = false;
      setCreating(false);
    }
  }, [selectedWorkspaceId, createSessionAndNavigate]);

  // ============================================================================
  // Loading state
  // ============================================================================

  const isLoading = tab === 'pr' ? prLoading : tab === 'branch' ? branchLoading : issuesLoading;

  // ============================================================================
  // Render
  // ============================================================================

  return (
    <CommandDialog
      open={isOpen}
      onOpenChange={(open) => { if (!open) onClose(); }}
      title="Create Session from..."
      description="Create a session from a pull request, branch, or issue"
      shouldFilter={false}
      variant="centered"
      className="sm:max-w-xl"
      showCloseButton={false}
    >
      <CommandInput
        placeholder="Search by title, number, or author..."
        value={search}
        onValueChange={setSearch}
      />

      {/* Tab bar + workspace selector */}
      <div className="flex items-center justify-between border-b px-3 py-1.5">
        <div className="flex gap-1">
          <TabButton active={tab === 'pr'} onClick={() => { setTab('pr'); setSearch(''); setError(''); }}>
            Pull requests
          </TabButton>
          <TabButton active={tab === 'branch'} onClick={() => { setTab('branch'); setSearch(''); setError(''); }}>
            Branches
          </TabButton>
          <TabButton active={tab === 'issues'} onClick={() => { setTab('issues'); setSearch(''); setError(''); }}>
            Issues
          </TabButton>
        </div>

        {workspaces.length > 0 && (
          <Select value={selectedWorkspaceId} onValueChange={setSelectedWorkspaceId}>
            <SelectTrigger className="h-7 w-auto max-w-[160px] text-xs gap-1.5 border-none shadow-none px-2">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {workspaces.map((ws) => (
                <SelectItem key={ws.id} value={ws.id} className="text-xs">
                  <div className="flex items-center gap-1.5">
                    <div
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: workspaceColors[ws.id] || getWorkspaceColor(ws.id) }}
                    />
                    {ws.name}
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      <CommandList className="h-[320px]">
        {/* Error display */}
        {error && (
          <div className="px-3 py-2 text-xs text-destructive bg-destructive/10 mx-2 mt-2 rounded">
            {error}
          </div>
        )}

        {/* Creating indicator */}
        {creating && (
          <div className="flex items-center gap-2 px-3 py-4 text-sm text-muted-foreground justify-center">
            <Loader2 className="w-4 h-4 animate-spin" />
            Creating session...
          </div>
        )}

        {/* Loading indicator */}
        {isLoading && !creating && (
          <div className="flex items-center gap-2 px-3 py-4 text-sm text-muted-foreground justify-center">
            <Loader2 className="w-4 h-4 animate-spin" />
            Loading...
          </div>
        )}

        {/* PR Tab */}
        {tab === 'pr' && !isLoading && !creating && (
          <>
            <CommandEmpty>No pull requests found</CommandEmpty>
            <CommandGroup>
              {filteredPRs.map((pr) => (
                <CommandItem
                  key={pr.number}
                  value={`pr-${pr.number}-${pr.title}`}
                  onSelect={() => handleSelectPR(pr)}
                >
                  <PRStatusIcon state={pr.state} isDraft={pr.isDraft} />
                  <span className="text-muted-foreground font-mono text-xs shrink-0">#{pr.number}</span>
                  <span className="truncate flex-1">{pr.title}</span>
                  <span className="text-2xs text-muted-foreground shrink-0">
                    {pr.state === 'open' ? 'Open' : pr.state === 'merged' ? 'Merged' : 'Closed'}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}

        {/* Branch Tab */}
        {tab === 'branch' && !isLoading && !creating && (
          <>
            <CommandEmpty>No branches found</CommandEmpty>
            <CommandGroup>
              {branches.map((branch) => (
                <CommandItem
                  key={branch.name}
                  value={`branch-${branch.name}`}
                  onSelect={() => handleSelectBranch(branch.name)}
                >
                  <GitBranch className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  <div className="flex flex-col gap-0 min-w-0 flex-1">
                    <span className="font-mono text-xs truncate">{branch.name}</span>
                    <span className="text-2xs text-muted-foreground truncate">{branch.lastCommitSubject}</span>
                  </div>
                  <span className="text-2xs text-muted-foreground shrink-0">{branch.lastAuthor}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}

        {/* Issues Tab */}
        {tab === 'issues' && !isLoading && !creating && (
          <>
            {githubIssues.length === 0 && linearIssues.length === 0 && (
              <CommandEmpty>No issues found</CommandEmpty>
            )}

            {githubIssues.length > 0 && (
              <CommandGroup heading="GitHub Issues">
                {githubIssues.map((issue) => (
                  <CommandItem
                    key={`gh-${issue.number}`}
                    value={`gh-issue-${issue.number}-${issue.title}`}
                    onSelect={() => handleSelectGitHubIssue(issue)}
                  >
                    <CircleDot className={cn(
                      'w-3.5 h-3.5 shrink-0',
                      issue.state === 'open' ? 'text-green-500' : 'text-purple-500'
                    )} />
                    <span className="text-muted-foreground font-mono text-xs shrink-0">#{issue.number}</span>
                    <span className="truncate flex-1">{issue.title}</span>
                    <span className="text-2xs text-muted-foreground shrink-0">{issue.user.login}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {linearIssues.length > 0 && (
              <CommandGroup heading="Linear Issues">
                {linearIssues.map((issue) => (
                  <CommandItem
                    key={`linear-${issue.id}`}
                    value={`linear-issue-${issue.identifier}-${issue.title}`}
                    onSelect={() => handleSelectLinearIssue(issue)}
                  >
                    <CircleDot className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                    <span className="text-muted-foreground font-mono text-xs shrink-0">{issue.identifier}</span>
                    <span className="truncate flex-1">{issue.title}</span>
                    <span className="text-2xs text-muted-foreground shrink-0">{issue.stateName}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </>
        )}
      </CommandList>
    </CommandDialog>
  );
}
