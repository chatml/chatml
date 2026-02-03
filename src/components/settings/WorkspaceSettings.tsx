'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAppStore } from '@/stores/appStore';
import {
  getRepoDetails,
  type RepoDetailsDTO,
  type RepoRemotesDTO,
  getRepoRemotes,
  updateRepoSettings,
  getGlobalReviewPrompts,
  getWorkspaceReviewPrompts,
  setWorkspaceReviewPrompts,
  getGlobalPRTemplate,
  getPRTemplate,
  setPRTemplate,
} from '@/lib/api';
import type { Workspace } from '@/lib/types';
import { REVIEW_PROMPTS, REVIEW_TYPE_META } from '@/hooks/useReviewTrigger';
import { useToast } from '@/components/ui/toast';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import {
  ArrowLeft,
  Eye,
  GitBranch,
  FolderOpen,
  Globe,
  ExternalLink,
  Tag,
  Loader2,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface WorkspaceSettingsProps {
  workspaceId: string;
  onBack: () => void;
}

type WorkspaceSettingsSection = 'repository' | 'review';

export function WorkspaceSettings({ workspaceId, onBack }: WorkspaceSettingsProps) {
  const workspaces = useAppStore((s) => s.workspaces);
  const workspace = workspaces.find((w) => w.id === workspaceId);
  const [repoDetails, setRepoDetails] = useState<RepoDetailsDTO | null>(null);
  const [section, setSection] = useState<WorkspaceSettingsSection>('repository');

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
    <div className="flex h-full bg-content-background">
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
              <div className="px-2 py-1.5 text-2xs font-medium text-muted-foreground uppercase tracking-wider">
                {workspace.name}
              </div>
              <Button
                variant={section === 'repository' ? 'secondary' : 'ghost'}
                size="sm"
                className={cn(
                  'w-full justify-start gap-2 h-7 text-xs',
                  section === 'repository' && 'bg-sidebar-accent',
                )}
                onClick={() => setSection('repository')}
              >
                <FolderOpen className="w-3.5 h-3.5" />
                Repository
              </Button>
              <Button
                variant={section === 'review' ? 'secondary' : 'ghost'}
                size="sm"
                className={cn(
                  'w-full justify-start gap-2 h-7 text-xs',
                  section === 'review' && 'bg-sidebar-accent',
                )}
                onClick={() => setSection('review')}
              >
                <Eye className="w-3.5 h-3.5" />
                Review
              </Button>
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
            {section === 'repository' && (
              <RepositorySection workspace={workspace} repoDetails={repoDetails} />
            )}
            {section === 'review' && (
              <WorkspaceReviewSettings workspaceId={workspaceId} />
            )}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}

function RepositorySection({
  workspace,
  repoDetails,
}: {
  workspace: Workspace;
  repoDetails: RepoDetailsDTO | null;
}) {
  const updateWorkspace = useAppStore((s) => s.updateWorkspace);
  const { error: showError } = useToast();
  const [remotesData, setRemotesData] = useState<RepoRemotesDTO | null>(null);
  const [loadingRemotes, setLoadingRemotes] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  // Fetch remotes data on mount
  useEffect(() => {
    const fetchRemotes = async () => {
      try {
        const data = await getRepoRemotes(workspace.id);
        setRemotesData(data);
      } catch (error) {
        console.error('Failed to fetch remotes:', error);
      } finally {
        setLoadingRemotes(false);
      }
    };
    fetchRemotes();
  }, [workspace.id]);

  const handleUpdateSetting = useCallback(async (
    key: string,
    settings: { branch?: string; remote?: string; branchPrefix?: string; customPrefix?: string },
  ) => {
    setSaving(key);
    try {
      const updated = await updateRepoSettings(workspace.id, settings);
      // Update workspace in store
      updateWorkspace(workspace.id, {
        defaultBranch: updated.branch,
        remote: updated.remote || 'origin',
        branchPrefix: updated.branchPrefix || '',
        customPrefix: updated.customPrefix || '',
      });
    } catch {
      showError('Failed to save setting');
    } finally {
      setSaving(null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace.id]);

  const currentRemote = workspace.remote || 'origin';
  const remoteBranches = remotesData?.branches?.[currentRemote] || [];

  return (
    <div className="mb-8">
      <h2 className="text-xl font-semibold mb-5">Repository</h2>

      <div className="space-y-4">
        {/* Path (read-only) */}
        <div className="flex items-start gap-3 py-3 border-b border-border/50">
          <FolderOpen className="w-4 h-4 mt-0.5 text-muted-foreground" />
          <div className="flex-1">
            <h4 className="text-sm font-medium">Path</h4>
            <p className="text-xs text-muted-foreground mt-0.5 font-mono">
              {workspace.path}
            </p>
          </div>
        </div>

        {/* Workspaces Path (read-only) */}
        {repoDetails?.workspacesPath && (
          <div className="flex items-start gap-3 py-3 border-b border-border/50">
            <FolderOpen className="w-4 h-4 mt-0.5 text-muted-foreground" />
            <div className="flex-1">
              <h4 className="text-sm font-medium">Workspaces Path</h4>
              <p className="text-xs text-muted-foreground mt-0.5 font-mono">
                {repoDetails.workspacesPath}
              </p>
            </div>
          </div>
        )}

        {/* Branch new workspaces from */}
        <div className="flex items-start gap-3 py-3 border-b border-border/50">
          <GitBranch className="w-4 h-4 mt-0.5 text-muted-foreground" />
          <div className="flex-1">
            <h4 className="text-sm font-medium">Branch new workspaces from</h4>
            <p className="text-xs text-muted-foreground mt-0.5 mb-2">
              Each workspace is an isolated copy of your codebase branched from this ref.
            </p>
            {loadingRemotes ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="w-3 h-3 animate-spin" />
                Loading branches...
              </div>
            ) : (
              <select
                className="w-full max-w-xs text-sm h-8 px-2 rounded-md border bg-background text-foreground"
                value={currentRemote + '/' + (workspace.defaultBranch || 'main')}
                onChange={(e) => {
                  const val = e.target.value;
                  // val is like "origin/main" — extract branch name after first "/"
                  const slashIdx = val.indexOf('/');
                  const branch = slashIdx >= 0 ? val.slice(slashIdx + 1) : val;
                  handleUpdateSetting('branch', { branch });
                }}
                disabled={saving === 'branch'}
              >
                {remoteBranches.length > 0 ? (
                  remoteBranches.map((b) => (
                    <option key={b} value={b}>{b}</option>
                  ))
                ) : (
                  <option value={currentRemote + '/' + (workspace.defaultBranch || 'main')}>
                    {currentRemote}/{workspace.defaultBranch || 'main'}
                  </option>
                )}
              </select>
            )}
          </div>
        </div>

        {/* Remote origin */}
        <div className="flex items-start gap-3 py-3 border-b border-border/50">
          <Globe className="w-4 h-4 mt-0.5 text-muted-foreground" />
          <div className="flex-1">
            <h4 className="text-sm font-medium">Remote</h4>
            <p className="text-xs text-muted-foreground mt-0.5 mb-2">
              Where should we push, pull, and create PRs?
            </p>
            {loadingRemotes ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="w-3 h-3 animate-spin" />
                Loading remotes...
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <select
                  className="max-w-xs text-sm h-8 px-2 rounded-md border bg-background text-foreground"
                  value={currentRemote}
                  onChange={async (e) => {
                    const newRemote = e.target.value;
                    await handleUpdateSetting('remote', { remote: newRemote });
                    // Re-fetch remotes to update branch list for the new remote
                    try {
                      const data = await getRepoRemotes(workspace.id);
                      setRemotesData(data);
                    } catch {
                      // ignore
                    }
                  }}
                  disabled={saving === 'remote'}
                >
                  {(remotesData?.remotes || ['origin']).map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
                {repoDetails?.remoteUrl && (
                  <a
                    href={repoDetails.remoteUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:text-primary/80 transition-colors"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Branch name prefix */}
        <div className="flex items-start gap-3 py-3 border-b border-border/50">
          <Tag className="w-4 h-4 mt-0.5 text-muted-foreground" />
          <div className="flex-1">
            <h4 className="text-sm font-medium">Branch name prefix</h4>
            <p className="text-xs text-muted-foreground mt-0.5 mb-3">
              Prefix for new workspace branch names. Leave as &ldquo;Use global default&rdquo; to follow the global Git setting.
            </p>
            <BranchPrefixSelector
              value={workspace.branchPrefix || ''}
              customValue={workspace.customPrefix || ''}
              saving={saving === 'prefix'}
              onSelect={(branchPrefix, customPrefix) => {
                handleUpdateSetting('prefix', { branchPrefix, customPrefix });
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function BranchPrefixSelector({
  value,
  customValue,
  saving,
  onSelect,
}: {
  value: string;
  customValue: string;
  saving: boolean;
  onSelect: (branchPrefix: string, customPrefix: string) => void;
}) {
  const [customInput, setCustomInput] = useState(customValue);

  const options = [
    { key: '', label: 'Use global default' },
    { key: 'github', label: 'GitHub username' },
    { key: 'custom', label: 'Custom' },
    { key: 'none', label: 'None' },
  ] as const;

  return (
    <div className="space-y-2">
      {options.map((opt) => (
        <label
          key={opt.key}
          className={cn(
            'flex items-center gap-2 cursor-pointer text-sm py-1',
            saving && 'opacity-50 pointer-events-none',
          )}
        >
          <input
            type="radio"
            name="branchPrefix"
            className="accent-primary"
            checked={value === opt.key}
            onChange={() => {
              if (opt.key === 'custom') {
                onSelect('custom', customInput.trim());
              } else {
                onSelect(opt.key, '');
              }
            }}
          />
          {opt.label}
        </label>
      ))}
      {value === 'custom' && (
        <div className="ml-6 flex items-center gap-2">
          <Input
            className="max-w-[200px] h-7 text-sm"
            placeholder="e.g., yourname"
            value={customInput}
            onChange={(e) => setCustomInput(e.target.value)}
            onBlur={() => {
              if (customInput.trim() !== customValue) {
                onSelect('custom', customInput.trim());
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                onSelect('custom', customInput.trim());
              }
            }}
          />
        </div>
      )}
    </div>
  );
}

function WorkspaceReviewSettings({ workspaceId }: { workspaceId: string }) {
  const [prompts, setPrompts] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<Record<string, string>>({});
  const [globalPrompts, setGlobalPrompts] = useState<Record<string, string>>({});
  const [prTemplate, setPrTemplate] = useState('');
  const [savedPrTemplate, setSavedPrTemplate] = useState('');
  const [globalPrTemplate, setGlobalPrTemplate] = useState('');
  const [saving, setSaving] = useState(false);
  const { error: showError } = useToast();

  useEffect(() => {
    Promise.all([
      getWorkspaceReviewPrompts(workspaceId),
      getGlobalReviewPrompts(),
      getPRTemplate(workspaceId),
      getGlobalPRTemplate(),
    ]).then(([ws, gl, wsPr, glPr]) => {
      setPrompts(ws);
      setSaved(ws);
      setGlobalPrompts(gl);
      setPrTemplate(wsPr);
      setSavedPrTemplate(wsPr);
      setGlobalPrTemplate(glPr);
    }).catch(() => {
      showError('Failed to load settings');
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  const hasChanges = JSON.stringify(prompts) !== JSON.stringify(saved) || prTemplate !== savedPrTemplate;

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const cleaned: Record<string, string> = {};
      for (const [k, v] of Object.entries(prompts)) {
        if (v.trim()) cleaned[k] = v.trim();
      }
      await Promise.all([
        setWorkspaceReviewPrompts(workspaceId, cleaned),
        setPRTemplate(workspaceId, prTemplate.trim()),
      ]);
      setPrompts(cleaned);
      setSaved(cleaned);
      setPrTemplate(prTemplate.trim());
      setSavedPrTemplate(prTemplate.trim());
    } catch {
      showError('Failed to save settings');
    } finally {
      setSaving(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, prompts, prTemplate]);

  const prPlaceholder = globalPrTemplate
    ? `Global: ${globalPrTemplate.slice(0, 60)}${globalPrTemplate.length > 60 ? '…' : ''}`
    : 'e.g., Include a testing checklist, link to related issues';

  return (
    <div>
      <h2 className="text-xl font-semibold mb-1">Review Prompts</h2>
      <p className="text-sm text-muted-foreground mb-6">
        Override the global review prompt settings for this workspace.
        Leave empty to use the global default.
      </p>

      <div className="space-y-5">
        {REVIEW_TYPE_META.map(({ key, label, placeholder }) => {
          const globalOverride = globalPrompts[key];
          const effectivePlaceholder = globalOverride
            ? `Global: ${globalOverride.slice(0, 60)}…`
            : placeholder;

          return (
            <div key={key}>
              <label className="text-sm font-medium block mb-1.5">{label}</label>
              <p className="text-xs text-muted-foreground mb-1.5 line-clamp-1">
                Default: {REVIEW_PROMPTS[key]?.slice(0, 80)}…
              </p>
              <Textarea
                className="text-sm min-h-[60px]"
                placeholder={effectivePlaceholder}
                value={prompts[key] || ''}
                onChange={(e) => setPrompts((prev) => ({ ...prev, [key]: e.target.value }))}
              />
            </div>
          );
        })}
      </div>

      <div className="mt-8 pt-8 border-t border-border/50">
        <h3 className="text-lg font-semibold mb-1">PR Creation</h3>
        <p className="text-sm text-muted-foreground mb-4">
          Override the global PR template for this workspace.
          Leave empty to use the global default.
        </p>

        <label className="text-sm font-medium block mb-1.5">PR Description Prompt</label>
        <p className="text-xs text-muted-foreground mb-1.5">
          These instructions will be prepended to the default PR generation prompt
        </p>
        <Textarea
          className="text-sm min-h-[80px]"
          placeholder={prPlaceholder}
          value={prTemplate}
          onChange={(e) => setPrTemplate(e.target.value)}
        />
      </div>

      {hasChanges && (
        <div className="mt-4 flex justify-end">
          <Button size="sm" disabled={saving} onClick={handleSave}>
            {saving ? 'Saving...' : 'Save'}
          </Button>
        </div>
      )}
    </div>
  );
}
