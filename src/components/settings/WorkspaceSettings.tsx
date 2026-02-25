'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
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
  getGlobalActionTemplates,
  getWorkspaceActionTemplates,
  setWorkspaceActionTemplates,
} from '@/lib/api';
import type { Workspace } from '@/lib/types';
import { REVIEW_PROMPTS, REVIEW_TYPE_META } from '@/hooks/useReviewTrigger';
import {
  ACTION_TEMPLATES,
  ACTION_TEMPLATE_META,
  parseOverrides,
  serializeOverrides,
} from '@/lib/action-templates';
import type { ActionTemplateKey, ActionTemplateOverride, OverrideMode } from '@/lib/action-templates';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible';
import { useToast } from '@/components/ui/toast';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import {
  ArrowLeft,
  ChevronRight,
  Eye,
  Zap,
  GitBranch,
  FolderOpen,
  Globe,
  ExternalLink,
  Tag,
  Loader2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { isMacOS } from '@/lib/platform';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';

interface WorkspaceSettingsProps {
  workspaceId: string;
  onBack: () => void;
}

type WorkspaceSettingsSection = 'repository' | 'review' | 'actions';

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
        {/* Back button - extra padding on macOS for traffic lights */}
        <div data-tauri-drag-region className={cn("h-10 pr-3 flex items-center border-b shrink-0", isMacOS() ? 'pl-20' : 'pl-3')}>
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
              <Button
                variant={section === 'actions' ? 'secondary' : 'ghost'}
                size="sm"
                className={cn(
                  'w-full justify-start gap-2 h-7 text-xs',
                  section === 'actions' && 'bg-sidebar-accent',
                )}
                onClick={() => setSection('actions')}
              >
                <Zap className="w-3.5 h-3.5" />
                Actions
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
            {section === 'actions' && (
              <WorkspaceActionSettings workspaceId={workspaceId} />
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
  const showErrorRef = useRef(showError);
  useEffect(() => { showErrorRef.current = showError; }, [showError]);
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
      updateWorkspace(workspace.id, {
        defaultBranch: updated.branch,
        remote: updated.remote || 'origin',
        branchPrefix: updated.branchPrefix || '',
        customPrefix: updated.customPrefix || '',
      });
    } catch {
      showErrorRef.current('Failed to save setting');
    } finally {
      setSaving(null);
    }
  }, [workspace.id, updateWorkspace]);

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
    <RadioGroup
      value={value}
      onValueChange={(v) => {
        if (v === 'custom') {
          onSelect('custom', customInput.trim());
        } else {
          onSelect(v, '');
        }
      }}
      className={cn('gap-2', saving && 'opacity-50 pointer-events-none')}
    >
      {options.map((opt) => (
        <label
          key={opt.key}
          className="flex items-center gap-2 cursor-pointer text-sm py-1"
        >
          <RadioGroupItem value={opt.key} />
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
    </RadioGroup>
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
  const showErrorRef = useRef(showError);
  useEffect(() => { showErrorRef.current = showError; }, [showError]);

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
      showErrorRef.current('Failed to load settings');
    });
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
      showErrorRef.current('Failed to save settings');
    } finally {
      setSaving(false);
    }
  }, [workspaceId, prompts, prTemplate]);

  const hasAnyOverride = Object.values(prompts).some((v) => v.trim()) || prTemplate.trim();

  const handleResetAll = useCallback(async () => {
    setSaving(true);
    try {
      await Promise.all([
        setWorkspaceReviewPrompts(workspaceId, {}),
        setPRTemplate(workspaceId, ''),
      ]);
      setPrompts({});
      setSaved({});
      setPrTemplate('');
      setSavedPrTemplate('');
    } catch {
      showErrorRef.current('Failed to reset settings');
    } finally {
      setSaving(false);
    }
  }, [workspaceId]);

  const prPlaceholder = globalPrTemplate
    ? `Global: ${globalPrTemplate.slice(0, 60)}${globalPrTemplate.length > 60 ? '…' : ''}`
    : 'e.g., Include a testing checklist, link to related issues';

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-xl font-semibold">Review Prompts</h2>
        {hasAnyOverride && !hasChanges && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs text-muted-foreground hover:text-foreground"
            disabled={saving}
            onClick={handleResetAll}
          >
            Reset to global defaults
          </Button>
        )}
      </div>
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
          const hasOverride = !!(prompts[key]?.trim());

          return (
            <div key={key}>
              <div className="flex items-center gap-2 mb-1.5">
                <label className="text-sm font-medium">{label}</label>
                {hasOverride && (
                  <span className="inline-flex items-center rounded-full bg-primary/10 px-1.5 py-0.5 text-2xs font-medium text-primary">
                    Overridden
                  </span>
                )}
              </div>
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
        <div className="flex items-center gap-2 mb-1">
          <h3 className="text-lg font-semibold">PR Creation</h3>
          {prTemplate.trim() && (
            <span className="inline-flex items-center rounded-full bg-primary/10 px-1.5 py-0.5 text-2xs font-medium text-primary">
              Overridden
            </span>
          )}
        </div>
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

function WorkspaceActionSettings({ workspaceId }: { workspaceId: string }) {
  const [templates, setTemplatesState] = useState<Partial<Record<ActionTemplateKey, ActionTemplateOverride>>>({});
  const [saved, setSaved] = useState<Partial<Record<ActionTemplateKey, ActionTemplateOverride>>>({});
  const [globalOverrides, setGlobalOverrides] = useState<Partial<Record<ActionTemplateKey, ActionTemplateOverride>>>({});
  const [saving, setSaving] = useState(false);
  const { error: showError } = useToast();
  const showErrorRef = useRef(showError);
  useEffect(() => { showErrorRef.current = showError; }, [showError]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      getWorkspaceActionTemplates(workspaceId),
      getGlobalActionTemplates(),
    ]).then(([ws, gl]) => {
      if (cancelled) return;
      const wsParsed = parseOverrides(ws);
      const glParsed = parseOverrides(gl);
      setTemplatesState(wsParsed);
      setSaved(wsParsed);
      setGlobalOverrides(glParsed);
    }).catch(() => {
      if (cancelled) return;
      showErrorRef.current('Failed to load settings');
    });
    return () => { cancelled = true; };
  }, [workspaceId]);

  const hasChanges = JSON.stringify(templates) !== JSON.stringify(saved);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const serialized = serializeOverrides(templates);
      await setWorkspaceActionTemplates(workspaceId, serialized);
      const parsed = parseOverrides(serialized);
      setTemplatesState(parsed);
      setSaved(parsed);
      window.dispatchEvent(new CustomEvent('action-templates-changed'));
    } catch {
      showErrorRef.current('Failed to save settings');
    } finally {
      setSaving(false);
    }
  }, [workspaceId, templates]);

  const hasAnyOverride = Object.values(templates).some((v) => v?.text?.trim());

  const handleResetAll = useCallback(async () => {
    setSaving(true);
    try {
      await setWorkspaceActionTemplates(workspaceId, {});
      setTemplatesState({});
      setSaved({});
      window.dispatchEvent(new CustomEvent('action-templates-changed'));
    } catch {
      showErrorRef.current('Failed to reset settings');
    } finally {
      setSaving(false);
    }
  }, [workspaceId]);

  const setTemplateText = useCallback((key: ActionTemplateKey, text: string) => {
    setTemplatesState((prev) => ({
      ...prev,
      [key]: { text, mode: prev[key]?.mode || 'append' },
    }));
  }, []);

  const setTemplateMode = useCallback((key: ActionTemplateKey, mode: OverrideMode) => {
    setTemplatesState((prev) => ({
      ...prev,
      [key]: { text: prev[key]?.text || '', mode },
    }));
  }, []);

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-xl font-semibold">Action Templates</h2>
        {hasAnyOverride && !hasChanges && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs text-muted-foreground hover:text-foreground"
            disabled={saving}
            onClick={handleResetAll}
          >
            Reset to global defaults
          </Button>
        )}
      </div>
      <p className="text-sm text-muted-foreground mb-6">
        Override the global action template settings for this workspace.
        Leave empty to use the global default.
      </p>

      <div className="space-y-5">
        {ACTION_TEMPLATE_META.map(({ key, label, placeholder }) => {
          const override = templates[key];
          const hasText = !!override?.text?.trim();
          const hasGlobalOverride = !!globalOverrides[key]?.text?.trim();

          return (
            <div key={key} className="border rounded-lg p-4">
              <div className="flex items-center gap-2 mb-2">
                <label className="text-sm font-medium">{label}</label>
                {hasText && (
                  <span className="inline-flex items-center rounded-full bg-primary/10 px-1.5 py-0.5 text-2xs font-medium text-primary">
                    Overridden ({override?.mode === 'replace' ? 'replaced' : 'appended'})
                  </span>
                )}
              </div>

              <Collapsible>
                <CollapsibleTrigger className="group flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
                  <ChevronRight className="h-3.5 w-3.5 transition-transform group-data-[state=open]:rotate-90" />
                  View built-in default
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="mt-2 p-3 bg-muted/50 rounded-md text-xs font-mono whitespace-pre-wrap max-h-48 overflow-y-auto border border-border/50">
                    {ACTION_TEMPLATES[key]}
                  </div>
                </CollapsibleContent>
              </Collapsible>

              {hasGlobalOverride && (
                <p className="text-xs text-muted-foreground mt-2">
                  Global override active ({globalOverrides[key]?.mode === 'replace' ? 'replaces' : 'appends to'} default)
                </p>
              )}

              {hasText && (
                <RadioGroup
                  value={override?.mode || 'append'}
                  onValueChange={(v) => setTemplateMode(key, v as OverrideMode)}
                  className="flex gap-4 mt-3"
                >
                  <div className="flex items-center gap-1.5">
                    <RadioGroupItem value="append" id={`ws-${key}-append`} />
                    <label htmlFor={`ws-${key}-append`} className="text-xs cursor-pointer">Add to default</label>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <RadioGroupItem value="replace" id={`ws-${key}-replace`} />
                    <label htmlFor={`ws-${key}-replace`} className="text-xs cursor-pointer">Replace default</label>
                  </div>
                </RadioGroup>
              )}

              <Textarea
                className="text-sm min-h-[80px] mt-3"
                placeholder={placeholder}
                value={override?.text || ''}
                onChange={(e) => setTemplateText(key, e.target.value)}
              />

              {hasText && (
                <p className="text-xs text-muted-foreground mt-1.5">
                  {override?.mode === 'replace'
                    ? 'Your text will completely replace the built-in default.'
                    : 'Your text will be appended after the built-in default.'}
                </p>
              )}
            </div>
          );
        })}
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
