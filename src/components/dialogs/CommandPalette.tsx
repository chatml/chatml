'use client';

import { useState, useCallback, useMemo, useEffect } from 'react';
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
import { useSettingsStore } from '@/stores/settingsStore';
import { useShortcut } from '@/hooks/useShortcut';
import { navigate } from '@/lib/navigation';
import { copyToClipboard } from '@/lib/tauri';
import { useToast } from '@/components/ui/toast';
import { getShortcutById, formatShortcutKeys } from '@/lib/shortcuts';
import type { LucideIcon } from 'lucide-react';
import {
  // Navigation
  LayoutDashboard,
  FolderGit2,
  GitBranch,
  MessageSquare,
  Settings,
  Layers,
  GitPullRequest,
  Archive,
  // Actions
  Plus,
  Bot,
  MessageCirclePlus,
  Brain,
  Sparkles,
  Focus,
  FileSearch,
  PanelBottom,
  PanelLeft,
  PanelRight,
  // Git
  GitCommit,
  Copy,
  ExternalLink,
  Terminal,
  RefreshCw,
  // Review
  Search,
  Shield,
  FileCode,
  // Settings
  Moon,
  Volume2,
  ChevronLeft,
  Clock,
  ChevronRight,
} from 'lucide-react';

// ============================================================================
// Types
// ============================================================================

type CommandCategory = 'Recent' | 'Navigation' | 'Actions' | 'Git' | 'Review' | 'Settings';

interface Command {
  id: string;
  category: CommandCategory;
  label: string;
  icon: LucideIcon;
  shortcutId?: string;
  keywords?: string[];
  available?: () => boolean;
  hasSubmenu?: boolean;
  submenuId?: string;
  action: () => unknown;
}

interface SubmenuPage {
  title: string;
  icon: LucideIcon;
  getItems: () => SubmenuItem[];
}

interface SubmenuItem {
  id: string;
  label: string;
  description?: string;
  icon?: LucideIcon;
  action: () => unknown;
}

// ============================================================================
// Command Definitions
// ============================================================================

const COMMANDS: Command[] = [
  // Navigation
  {
    id: 'go-to-workspace',
    category: 'Navigation',
    label: 'Go to Workspace...',
    icon: FolderGit2,
    keywords: ['repository', 'repo', 'project'],
    hasSubmenu: true,
    submenuId: 'workspaces',
    available: () => useAppStore.getState().workspaces.length > 0,
    action: () => {},
  },
  {
    id: 'go-to-session',
    category: 'Navigation',
    label: 'Go to Session...',
    icon: GitBranch,
    keywords: ['branch', 'worktree'],
    hasSubmenu: true,
    submenuId: 'sessions',
    available: () => useAppStore.getState().sessions.filter((s) => !s.archived).length > 0,
    action: () => {},
  },
  {
    id: 'go-to-conversation',
    category: 'Navigation',
    label: 'Go to Conversation...',
    icon: MessageSquare,
    keywords: ['chat', 'message'],
    hasSubmenu: true,
    submenuId: 'conversations',
    available: () => useAppStore.getState().conversations.length > 0,
    action: () => {},
  },
  {
    id: 'open-settings',
    category: 'Navigation',
    label: 'Open Settings',
    icon: Settings,
    keywords: ['preferences', 'config', 'configuration'],
    action: () => window.dispatchEvent(new CustomEvent('open-settings')),
  },
  {
    id: 'open-session-manager',
    category: 'Navigation',
    label: 'Open Session Manager',
    icon: Layers,
    keywords: ['sessions', 'worktrees', 'branches'],
    action: () => useSettingsStore.getState().setContentView({ type: 'session-manager' }),
  },
  {
    id: 'open-pr-dashboard',
    category: 'Navigation',
    label: 'Open PR Dashboard',
    icon: GitPullRequest,
    keywords: ['pull requests', 'prs', 'reviews'],
    action: () => useSettingsStore.getState().setContentView({ type: 'pr-dashboard' }),
  },
  {
    id: 'open-repositories',
    category: 'Navigation',
    label: 'Open Repositories',
    icon: Archive,
    keywords: ['repos', 'workspaces', 'projects'],
    action: () => useSettingsStore.getState().setContentView({ type: 'repositories' }),
  },
  {
    id: 'go-to-dashboard',
    category: 'Navigation',
    label: 'Go to Dashboard',
    icon: LayoutDashboard,
    keywords: ['home', 'overview'],
    action: () => useSettingsStore.getState().setContentView({ type: 'global-dashboard' }),
  },

  // Actions
  {
    id: 'new-session',
    category: 'Actions',
    label: 'New Session',
    icon: Bot,
    shortcutId: 'newSession',
    keywords: ['spawn', 'agent', 'worktree', 'create'],
    available: () => useAppStore.getState().selectedWorkspaceId !== null,
    action: () => window.dispatchEvent(new CustomEvent('spawn-agent')),
  },
  {
    id: 'new-conversation',
    category: 'Actions',
    label: 'New Conversation',
    icon: MessageCirclePlus,
    keywords: ['chat', 'message', 'create'],
    available: () => useAppStore.getState().selectedSessionId !== null,
    action: () => window.dispatchEvent(new CustomEvent('new-conversation')),
  },
  {
    id: 'create-from-pr',
    category: 'Actions',
    label: 'New Session from PR/Branch',
    icon: GitPullRequest,
    shortcutId: 'createFromPR',
    keywords: ['pull request', 'pr', 'branch', 'checkout', 'review'],
    action: () => window.dispatchEvent(new CustomEvent('create-from-pr')),
  },
  {
    id: 'add-repository',
    category: 'Actions',
    label: 'Add Repository',
    icon: Plus,
    shortcutId: 'addWorkspace',
    keywords: ['workspace', 'project', 'clone', 'create'],
    action: () => window.dispatchEvent(new CustomEvent('add-workspace')),
  },
  {
    id: 'toggle-plan-mode',
    category: 'Actions',
    label: 'Toggle Plan Mode',
    icon: FileCode,
    shortcutId: 'togglePlanMode',
    keywords: ['planning', 'architect'],
    available: () => useAppStore.getState().selectedSessionId !== null,
    action: () => window.dispatchEvent(new CustomEvent('toggle-plan-mode')),
  },
  {
    id: 'toggle-thinking-mode',
    category: 'Actions',
    label: 'Toggle Thinking Mode',
    icon: Brain,
    shortcutId: 'toggleThinking',
    keywords: ['extended', 'reasoning', 'deep'],
    action: () => {
      const store = useSettingsStore.getState();
      store.setDefaultThinking(!store.defaultThinking);
    },
  },
  {
    id: 'toggle-zen-mode',
    category: 'Actions',
    label: 'Toggle Zen Mode',
    icon: Sparkles,
    keywords: ['distraction', 'free', 'focus', 'minimal'],
    action: () => {
      const store = useSettingsStore.getState();
      store.setZenMode(!store.zenMode);
    },
  },
  {
    id: 'focus-chat',
    category: 'Actions',
    label: 'Focus Chat Input',
    icon: Focus,
    shortcutId: 'focusChat',
    keywords: ['input', 'message', 'type'],
    action: () => window.dispatchEvent(new CustomEvent('focus-input')),
  },
  {
    id: 'open-file-picker',
    category: 'Actions',
    label: 'Open File Picker',
    icon: FileSearch,
    shortcutId: 'filePicker',
    keywords: ['search', 'find', 'files'],
    available: () => useAppStore.getState().selectedSessionId !== null,
    action: () => window.dispatchEvent(new CustomEvent('open-file-picker')),
  },
  {
    id: 'toggle-bottom-panel',
    category: 'Actions',
    label: 'Toggle Bottom Panel',
    icon: PanelBottom,
    keywords: ['terminal', 'tasks', 'panel'],
    action: () => window.dispatchEvent(new CustomEvent('toggle-bottom-panel')),
  },
  {
    id: 'toggle-left-panel',
    category: 'Actions',
    label: 'Toggle Left Panel',
    icon: PanelLeft,
    keywords: ['sidebar', 'workspaces', 'sessions'],
    action: () => window.dispatchEvent(new CustomEvent('toggle-left-panel')),
  },
  {
    id: 'toggle-right-panel',
    category: 'Actions',
    label: 'Toggle Right Panel',
    icon: PanelRight,
    keywords: ['sidebar', 'changes', 'files'],
    available: () => useAppStore.getState().selectedSessionId !== null,
    action: () => window.dispatchEvent(new CustomEvent('toggle-right-panel')),
  },

  // Git
  {
    id: 'git-commit',
    category: 'Git',
    label: 'Commit Changes',
    icon: GitCommit,
    keywords: ['save', 'stage'],
    available: () => useAppStore.getState().selectedSessionId !== null,
    action: () => window.dispatchEvent(new CustomEvent('git-commit')),
  },
  {
    id: 'git-create-pr',
    category: 'Git',
    label: 'Create Pull Request',
    icon: GitPullRequest,
    keywords: ['pr', 'merge', 'review'],
    available: () => useAppStore.getState().selectedSessionId !== null,
    action: () => window.dispatchEvent(new CustomEvent('git-create-pr')),
  },
  {
    id: 'git-sync',
    category: 'Git',
    label: 'Sync with Main',
    icon: RefreshCw,
    keywords: ['pull', 'rebase', 'update'],
    available: () => useAppStore.getState().selectedSessionId !== null,
    action: () => window.dispatchEvent(new CustomEvent('git-sync')),
  },
  {
    id: 'git-copy-branch',
    category: 'Git',
    label: 'Copy Branch Name',
    icon: Copy,
    keywords: ['clipboard'],
    available: () => {
      const sessionId = useAppStore.getState().selectedSessionId;
      return sessionId !== null;
    },
    action: async () => {
      const { selectedSessionId, sessions } = useAppStore.getState();
      const session = sessions.find((s) => s.id === selectedSessionId);
      if (session?.branch) {
        const success = await copyToClipboard(session.branch);
        if (!success) throw new Error('Failed to copy branch name to clipboard');
      }
    },
  },
  {
    id: 'open-in-vscode',
    category: 'Git',
    label: 'Open in VS Code',
    icon: ExternalLink,
    keywords: ['editor', 'ide', 'code'],
    available: () => useAppStore.getState().selectedSessionId !== null,
    action: () => window.dispatchEvent(new CustomEvent('open-in-vscode')),
  },
  {
    id: 'open-terminal',
    category: 'Git',
    label: 'Open Terminal',
    icon: Terminal,
    keywords: ['shell', 'console', 'cli'],
    available: () => useAppStore.getState().selectedSessionId !== null,
    action: () => window.dispatchEvent(new CustomEvent('show-bottom-panel')),
  },

  // Review
  {
    id: 'start-quick-review',
    category: 'Review',
    label: 'Start Quick Review',
    icon: Search,
    keywords: ['fast', 'basic', 'code review'],
    available: () => useAppStore.getState().selectedSessionId !== null,
    action: () => window.dispatchEvent(new CustomEvent('start-review', { detail: { type: 'quick' } })),
  },
  {
    id: 'start-deep-review',
    category: 'Review',
    label: 'Start Deep Review',
    icon: FileCode,
    keywords: ['thorough', 'comprehensive', 'code review'],
    available: () => useAppStore.getState().selectedSessionId !== null,
    action: () => window.dispatchEvent(new CustomEvent('start-review', { detail: { type: 'deep' } })),
  },
  {
    id: 'start-security-audit',
    category: 'Review',
    label: 'Start Security Audit',
    icon: Shield,
    keywords: ['vulnerability', 'security', 'audit'],
    available: () => useAppStore.getState().selectedSessionId !== null,
    action: () => window.dispatchEvent(new CustomEvent('start-review', { detail: { type: 'security' } })),
  },

  // Settings
  {
    id: 'settings-open',
    category: 'Settings',
    label: 'Preferences',
    icon: Settings,
    keywords: ['settings', 'config'],
    action: () => window.dispatchEvent(new CustomEvent('open-settings')),
  },
  {
    id: 'toggle-theme',
    category: 'Settings',
    label: 'Toggle Theme',
    icon: Moon,
    keywords: ['dark', 'light', 'mode', 'appearance'],
    action: () => window.dispatchEvent(new CustomEvent('toggle-theme')),
  },
  {
    id: 'toggle-sound',
    category: 'Settings',
    label: 'Toggle Sound Effects',
    icon: Volume2,
    keywords: ['audio', 'mute', 'notifications'],
    action: () => {
      const store = useSettingsStore.getState();
      store.setSoundEffects(!store.soundEffects);
    },
  },
];

// ============================================================================
// Submenu Definitions
// ============================================================================

const SUBMENU_PAGES: Record<string, SubmenuPage> = {
  workspaces: {
    title: 'Go to Workspace',
    icon: FolderGit2,
    getItems: () => {
      const { workspaces } = useAppStore.getState();
      return workspaces.map((w) => ({
        id: w.id,
        label: w.name,
        description: w.path,
        icon: FolderGit2,
        action: () =>
          navigate({
            workspaceId: w.id,
            contentView: { type: 'workspace-dashboard', workspaceId: w.id },
          }),
      }));
    },
  },
  sessions: {
    title: 'Go to Session',
    icon: GitBranch,
    getItems: () => {
      const { sessions, workspaces } = useAppStore.getState();
      return sessions
        .filter((s) => !s.archived)
        .map((s) => ({
          id: s.id,
          label: s.name || s.branch,
          description: workspaces.find((w) => w.id === s.workspaceId)?.name,
          icon: GitBranch,
          action: () =>
            navigate({
              workspaceId: s.workspaceId,
              sessionId: s.id,
              contentView: { type: 'conversation' },
            }),
        }));
    },
  },
  conversations: {
    title: 'Go to Conversation',
    icon: MessageSquare,
    getItems: () => {
      const { conversations, sessions } = useAppStore.getState();
      return conversations.slice(0, 20).map((c) => ({
        id: c.id,
        label: c.name,
        description: sessions.find((s) => s.id === c.sessionId)?.name,
        icon: MessageSquare,
        action: () => navigate({ conversationId: c.id }),
      }));
    },
  },
};

// ============================================================================
// Helper Components
// ============================================================================

function ShortcutHint({ shortcutId }: { shortcutId: string }) {
  const shortcut = getShortcutById(shortcutId);
  if (!shortcut) return null;

  const keys = formatShortcutKeys(shortcut);
  return (
    <span className="ml-auto flex gap-0.5 text-xs text-muted-foreground">
      {keys.map((k, i) => (
        <kbd key={i} className="min-w-[20px] px-1.5 py-0.5 text-2xs font-medium rounded bg-muted text-center">
          {k}
        </kbd>
      ))}
    </span>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export function CommandPalette() {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [pages, setPages] = useState<string[]>([]);
  const [search, setSearch] = useState('');

  // Get recent commands from settings store
  const recentCommands = useSettingsStore((state) => state.recentCommands);
  const addRecentCommand = useSettingsStore((state) => state.addRecentCommand);

  // Current submenu page (root if empty)
  const currentPage = pages[pages.length - 1];

  // Subscribe to minimal store state to trigger re-render when command availability may change
  const selectedWorkspaceId = useAppStore((state) => state.selectedWorkspaceId);
  const selectedSessionId = useAppStore((state) => state.selectedSessionId);

  // Register Cmd+K shortcut
  useShortcut(
    'commandPalette',
    useCallback(() => {
      setOpen((prev) => {
        if (!prev) {
          // Close file picker when opening command palette
          window.dispatchEvent(new CustomEvent('close-file-picker'));
        }
        return !prev;
      });
    }, [])
  );

  // Listen for close event (from file picker opening)
  useEffect(() => {
    const handleClose = () => setOpen(false);
    window.addEventListener('close-command-palette', handleClose);
    return () => window.removeEventListener('close-command-palette', handleClose);
  }, []);

  // Filter commands by availability — no memo needed, filtering ~30 items is negligible
  const availableCommands = COMMANDS.filter((c) => c.available?.() ?? true);

  // Get recent commands that are still available
  const recentItems = useMemo(() => {
    return recentCommands
      .map((id) => availableCommands.find((c) => c.id === id))
      .filter((c): c is Command => c !== undefined)
      .slice(0, 5);
  }, [recentCommands, availableCommands]);

  // Group commands by category
  const commandsByCategory = useMemo(() => {
    const grouped: Record<CommandCategory, Command[]> = {
      Recent: [],
      Navigation: [],
      Actions: [],
      Git: [],
      Review: [],
      Settings: [],
    };

    for (const cmd of availableCommands) {
      grouped[cmd.category].push(cmd);
    }

    return grouped;
  }, [availableCommands]);

  // Handle keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Backspace' && !search && pages.length > 0) {
        e.preventDefault();
        setPages((p) => p.slice(0, -1));
      }
    },
    [search, pages.length]
  );

  // Run an action, catching any thrown errors and showing a toast
  const runAction = useCallback(
    (action: () => unknown) => {
      Promise.resolve(action()).catch((err: unknown) => {
        const message = err instanceof Error ? err.message : 'Command failed';
        toast.error(message);
      });
    },
    [toast]
  );

  // Execute command and track in recents
  const executeCommand = useCallback(
    (cmd: Command) => {
      if (cmd.hasSubmenu && cmd.submenuId) {
        setPages((p) => [...p, cmd.submenuId!]);
        setSearch('');
      } else {
        setOpen(false);
        setPages([]);
        setSearch('');
        addRecentCommand(cmd.id);
        // Close any overlays (like settings page) when executing navigation commands
        if (cmd.category === 'Navigation') {
          window.dispatchEvent(new CustomEvent('close-settings'));
        }
        runAction(cmd.action);
      }
    },
    [addRecentCommand, runAction]
  );

  // Execute submenu item
  const executeSubmenuItem = useCallback((item: SubmenuItem) => {
    setOpen(false);
    setPages([]);
    setSearch('');
    // Close any overlays (like settings page) when navigating
    window.dispatchEvent(new CustomEvent('close-settings'));
    runAction(item.action);
  }, [runAction]);

  // Go back to previous page
  const goBack = useCallback(() => {
    setPages((p) => p.slice(0, -1));
    setSearch('');
  }, []);

  // Reset state when dialog closes
  const handleOpenChange = useCallback((isOpen: boolean) => {
    setOpen(isOpen);
    if (!isOpen) {
      setPages([]);
      setSearch('');
    }
  }, []);

  // Render submenu content
  const renderSubmenuContent = () => {
    const page = SUBMENU_PAGES[currentPage];
    if (!page) return null;

    const items = page.getItems();
    const PageIcon = page.icon;

    return (
      <>
        <CommandGroup>
          <CommandItem onSelect={goBack} value="__back__">
            <ChevronLeft className="size-4" />
            <span>Back</span>
          </CommandItem>
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading={page.title}>
          {items.length === 0 ? (
            <div className="py-6 text-center text-sm text-muted-foreground">No items found</div>
          ) : (
            items.map((item) => {
              const ItemIcon = item.icon || PageIcon;
              // Include label and description in value for search filtering
              const searchValue = `${item.label} ${item.description || ''}`.trim();
              return (
                <CommandItem key={item.id} value={searchValue} onSelect={() => executeSubmenuItem(item)}>
                  <ItemIcon className="size-4" />
                  <div className="flex flex-col gap-0.5 min-w-0">
                    <span className="truncate">{item.label}</span>
                    {item.description && (
                      <span className="text-xs text-muted-foreground truncate">{item.description}</span>
                    )}
                  </div>
                </CommandItem>
              );
            })
          )}
        </CommandGroup>
      </>
    );
  };

  // Render root content
  const renderRootContent = () => {
    const categories: CommandCategory[] = ['Navigation', 'Actions', 'Git', 'Review', 'Settings'];

    return (
      <>
        {/* Recent commands */}
        {recentItems.length > 0 && !search && (
          <>
            <CommandGroup heading="Recent">
              {recentItems.map((cmd) => {
                const Icon = cmd.icon;
                return (
                  <CommandItem key={`recent-${cmd.id}`} value={`recent-${cmd.id}`} onSelect={() => executeCommand(cmd)}>
                    <Clock className="size-4 text-muted-foreground" />
                    <Icon className="size-4" />
                    <span className="flex-1">{cmd.label}</span>
                    {cmd.hasSubmenu && <ChevronRight className="size-4 text-muted-foreground" />}
                    {cmd.shortcutId && <ShortcutHint shortcutId={cmd.shortcutId} />}
                  </CommandItem>
                );
              })}
            </CommandGroup>
            <CommandSeparator />
          </>
        )}

        {/* Commands by category */}
        {categories.map((category) => {
          const commands = commandsByCategory[category];
          if (commands.length === 0) return null;

          return (
            <CommandGroup key={category} heading={category}>
              {commands.map((cmd) => {
                const Icon = cmd.icon;
                return (
                  <CommandItem key={cmd.id} value={cmd.id} onSelect={() => executeCommand(cmd)}>
                    <Icon className="size-4" />
                    <span className="flex-1">{cmd.label}</span>
                    {cmd.hasSubmenu && <ChevronRight className="size-4 text-muted-foreground" />}
                    {cmd.shortcutId && <ShortcutHint shortcutId={cmd.shortcutId} />}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          );
        })}
      </>
    );
  };

  return (
    <CommandDialog open={open} onOpenChange={handleOpenChange} variant="spotlight">
      <CommandInput
        placeholder={currentPage ? SUBMENU_PAGES[currentPage]?.title || 'Search...' : 'Type a command or search...'}
        value={search}
        onValueChange={setSearch}
        onKeyDown={handleKeyDown}
      />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        {currentPage ? renderSubmenuContent() : renderRootContent()}
      </CommandList>
    </CommandDialog>
  );
}
