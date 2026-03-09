'use client';

import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from '@/components/ui/collapsible';
import {
  ArrowLeft,
  Settings2,
  Palette,
  Bot,
  GitBranch,
  Eye,
  Zap,
  User,
  Wrench,
  Info,
  ScrollText,
  Search,
  X,
  ChevronDown,
  FolderOpen,
  Brain,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { isMacOS } from '@/lib/platform';
import { useMainToolbarContent } from '@/hooks/useMainToolbarContent';
import { useAppStore } from '@/stores/appStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { resolveWorkspaceColor } from '@/lib/workspace-colors';
import { GeneralSettings } from './sections/GeneralSettings';
import { AppearanceSettings } from './sections/AppearanceSettings';
import { AIModelSettings } from './sections/AIModelSettings';
import { GitSettings } from './sections/GitSettings';
import { ReviewSettings } from './sections/ReviewSettings';
import { AccountSettings } from './sections/AccountSettings';
import { AdvancedSettings } from './sections/AdvancedSettings';
import { AboutSettings } from './sections/AboutSettings';
import { InstructionsSettings } from './sections/InstructionsSettings';
import { ActionSettings } from './sections/ActionSettings';
import { SettingsSearchResults } from './SettingsSearchResults';
import { WorkspaceSettingsContent } from './WorkspaceSettings';
import {
  searchSettings,
  type SettingsCategory,
  type SettingsView,
  type WorkspaceSettingsSection,
} from './settingsRegistry';

interface SettingsPageProps {
  onBack: () => void;
  initialCategory?: SettingsCategory;
  initialWorkspaceId?: string;
  initialWorkspaceSection?: WorkspaceSettingsSection;
}

interface NavItem {
  id: SettingsCategory;
  label: string;
  icon: React.ReactNode;
}

interface WorkspaceSubPage {
  id: WorkspaceSettingsSection;
  label: string;
  icon: React.ReactNode;
}

const mainNavItems: NavItem[] = [
  { id: 'general', label: 'General', icon: <Settings2 className="w-3.5 h-3.5" /> },
  { id: 'appearance', label: 'Appearance', icon: <Palette className="w-3.5 h-3.5" /> },
  { id: 'ai-models', label: 'AI & Models', icon: <Bot className="w-3.5 h-3.5" /> },
  { id: 'instructions', label: 'Instructions', icon: <ScrollText className="w-3.5 h-3.5" /> },
  { id: 'git', label: 'Git', icon: <GitBranch className="w-3.5 h-3.5" /> },
  { id: 'review', label: 'Review & PRs', icon: <Eye className="w-3.5 h-3.5" /> },
  { id: 'actions', label: 'Actions', icon: <Zap className="w-3.5 h-3.5" /> },
  { id: 'account', label: 'Account', icon: <User className="w-3.5 h-3.5" /> },
];

const moreNavItems: NavItem[] = [
  { id: 'advanced', label: 'Advanced', icon: <Wrench className="w-3.5 h-3.5" /> },
  { id: 'about', label: 'About', icon: <Info className="w-3.5 h-3.5" /> },
];

const workspaceSubPages: WorkspaceSubPage[] = [
  { id: 'repository', label: 'Repository', icon: <FolderOpen className="w-3.5 h-3.5" /> },
  { id: 'review', label: 'Review', icon: <Eye className="w-3.5 h-3.5" /> },
  { id: 'actions', label: 'Actions', icon: <Zap className="w-3.5 h-3.5" /> },
  { id: 'agents', label: 'AI Agents', icon: <Bot className="w-3.5 h-3.5" /> },
  { id: 'memory', label: 'Memory', icon: <Brain className="w-3.5 h-3.5" /> },
];

export function SettingsPage({
  onBack,
  initialCategory = 'general',
  initialWorkspaceId,
  initialWorkspaceSection,
}: SettingsPageProps) {
  const [selectedView, setSelectedView] = useState<SettingsView>(() => {
    if (initialWorkspaceId) {
      return {
        type: 'workspace',
        workspaceId: initialWorkspaceId,
        section: initialWorkspaceSection ?? 'repository',
      };
    }
    return { type: 'app', category: initialCategory };
  });
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedWorkspaces, setExpandedWorkspaces] = useState<Set<string>>(() => {
    if (initialWorkspaceId) return new Set([initialWorkspaceId]);
    return new Set();
  });
  const searchInputRef = useRef<HTMLInputElement>(null);
  const contentRef = useRef<HTMLHeadingElement>(null);
  const navItemRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const onBackRef = useRef(onBack);
  useEffect(() => { onBackRef.current = onBack; }, [onBack]);

  const workspaces = useAppStore((s) => s.workspaces);
  const workspaceColors = useSettingsStore((s) => s.workspaceColors);

  const isSearching = searchQuery.trim().length > 0;

  const searchResults = useMemo(
    () => (isSearching ? searchSettings(searchQuery) : []),
    [searchQuery, isSearching],
  );

  // Toggle workspace expansion in sidebar
  const toggleWorkspace = useCallback((workspaceId: string) => {
    setExpandedWorkspaces((prev) => {
      const next = new Set(prev);
      if (next.has(workspaceId)) {
        next.delete(workspaceId);
      } else {
        next.add(workspaceId);
      }
      return next;
    });
  }, []);

  // Navigate to an app settings category
  const handleNavigateApp = useCallback((category: SettingsCategory, settingId?: string) => {
    setSelectedView({ type: 'app', category });
    setSearchQuery('');
    requestAnimationFrame(() => {
      if (settingId) {
        const el = document.querySelector(`[data-setting-id="${settingId}"]`);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          el.classList.add('bg-brand/5');
          setTimeout(() => el.classList.remove('bg-brand/5'), 1500);
          return;
        }
      }
      contentRef.current?.focus();
    });
  }, []);

  // Navigate to a workspace settings section
  const handleNavigateWorkspace = useCallback((workspaceId: string, section: WorkspaceSettingsSection) => {
    setSelectedView({ type: 'workspace', workspaceId, section });
    setSearchQuery('');
    // Ensure the workspace is expanded
    setExpandedWorkspaces((prev) => {
      if (prev.has(workspaceId)) return prev;
      const next = new Set(prev);
      next.add(workspaceId);
      return next;
    });
    requestAnimationFrame(() => {
      contentRef.current?.focus();
    });
  }, []);

  // Build flat navigation list for keyboard navigation.
  // Nav keys use '//' as delimiter (e.g. 'app//general', 'ws//id', 'ws//id//section')
  // to avoid collisions with workspace IDs that could theoretically contain colons.
  const flatNavKeys = useMemo(() => {
    const keys: string[] = [];
    for (const item of mainNavItems) keys.push(`app//${item.id}`);
    for (const item of moreNavItems) keys.push(`app//${item.id}`);
    for (const workspace of workspaces) {
      keys.push(`ws//${workspace.id}`);
      if (expandedWorkspaces.has(workspace.id)) {
        for (const sub of workspaceSubPages) {
          keys.push(`ws//${workspace.id}//${sub.id}`);
        }
      }
    }
    return keys;
  }, [workspaces, expandedWorkspaces]);

  // Parse a navKey into its parts: ['app', category] or ['ws', workspaceId] or ['ws', workspaceId, section]
  const parseNavKey = useCallback((key: string) => key.split('//'), []);

  // Keyboard navigation for sidebar
  const handleNavKeyDown = useCallback((e: React.KeyboardEvent, navKey: string) => {
    const currentIndex = flatNavKeys.indexOf(navKey);
    if (currentIndex === -1) return;

    const parts = parseNavKey(navKey);
    const isWsHeader = parts[0] === 'ws' && parts.length === 2;
    const isWsSub = parts[0] === 'ws' && parts.length === 3;

    let nextIndex: number | null = null;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      nextIndex = (currentIndex + 1) % flatNavKeys.length;
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      nextIndex = (currentIndex - 1 + flatNavKeys.length) % flatNavKeys.length;
    } else if (e.key === 'Home') {
      e.preventDefault();
      nextIndex = 0;
    } else if (e.key === 'End') {
      e.preventDefault();
      nextIndex = flatNavKeys.length - 1;
    } else if (e.key === 'ArrowRight' && isWsHeader) {
      // Expand workspace
      e.preventDefault();
      setExpandedWorkspaces((prev) => {
        const next = new Set(prev);
        next.add(parts[1]);
        return next;
      });
      return;
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      if (isWsSub) {
        // On a sub-item — move focus to parent workspace header
        const parentKey = `ws//${parts[1]}`;
        navItemRefs.current.get(parentKey)?.focus();
        return;
      } else if (isWsHeader) {
        // On workspace header — collapse it
        setExpandedWorkspaces((prev) => {
          const next = new Set(prev);
          next.delete(parts[1]);
          return next;
        });
        return;
      }
    }

    if (nextIndex !== null) {
      const nextKey = flatNavKeys[nextIndex];
      const nextParts = parseNavKey(nextKey);
      navItemRefs.current.get(nextKey)?.focus();
      // Navigate to the item
      if (nextParts[0] === 'app') {
        handleNavigateApp(nextParts[1] as SettingsCategory);
      } else if (nextParts[0] === 'ws' && nextParts.length === 3) {
        handleNavigateWorkspace(nextParts[1], nextParts[2] as WorkspaceSettingsSection);
      } else if (nextParts[0] === 'ws' && nextParts.length === 2) {
        // Workspace header — auto-navigate to first sub-section so content stays in sync
        handleNavigateWorkspace(nextParts[1], 'repository');
      }
    }
  }, [flatNavKeys, parseNavKey, handleNavigateApp, handleNavigateWorkspace]);

  // Cmd+F focuses search, Escape closes settings or clears search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
      if (e.key === 'Escape') {
        if (isSearching) {
          setSearchQuery('');
          searchInputRef.current?.blur();
        } else {
          onBackRef.current();
        }
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isSearching]);

  const toolbarConfig = useMemo(() => ({
    titlePosition: 'center' as const,
    title: (
      <span className="flex items-center gap-1.5">
        <Settings2 className="h-4 w-4 text-muted-foreground" />
        <h1 className="text-base font-semibold">Settings</h1>
      </span>
    ),
  }), []);
  useMainToolbarContent(toolbarConfig);

  // Helper to check active state
  const isAppCategoryActive = (id: SettingsCategory) =>
    !isSearching && selectedView.type === 'app' && selectedView.category === id;

  const isWorkspaceSubActive = (workspaceId: string, section: WorkspaceSettingsSection) =>
    !isSearching && selectedView.type === 'workspace'
    && selectedView.workspaceId === workspaceId
    && selectedView.section === section;

  const isWorkspaceActive = (workspaceId: string) =>
    !isSearching && selectedView.type === 'workspace'
    && selectedView.workspaceId === workspaceId;

  // Content area label for accessibility
  const contentLabel = useMemo(() => {
    if (isSearching) return 'Search results';
    if (selectedView.type === 'workspace') {
      const ws = workspaces.find((w) => w.id === selectedView.workspaceId);
      return `${ws?.name ?? 'Workspace'} ${selectedView.section} settings`;
    }
    return `${selectedView.category} settings`;
  }, [isSearching, selectedView, workspaces]);

  return (
    <div className="flex h-full bg-content-background">
      {/* Settings Sidebar */}
      <nav className="w-56 border-r bg-sidebar flex flex-col" role="navigation" aria-label="Settings">
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

        <ScrollArea className="flex-1 min-h-0">
          <div className="py-2 px-2">
            {/* Sidebar Title */}
            <div className="px-1 pt-1 pb-2">
              <h2 className="text-sm font-semibold text-foreground">Settings</h2>
            </div>

            {/* Search */}
            <div className="relative mb-3">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search settings..."
                aria-label="Search settings"
                className="w-full h-7 pl-8 pr-7 text-xs bg-sidebar-accent/50 border border-border/50 rounded-md focus:outline-none focus:ring-1 focus:ring-ring/30 focus:border-border placeholder:text-muted-foreground/60"
              />
              {isSearching && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery('');
                    searchInputRef.current?.focus();
                  }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  aria-label="Clear search"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>

            {/* App Settings Section */}
            <div role="tablist" aria-label="Settings categories" aria-orientation="vertical" className="space-y-0.5">
              <div className="pb-1" role="presentation">
                <span className="text-2xs font-medium text-muted-foreground px-2 uppercase tracking-wider">App</span>
              </div>

              {mainNavItems.map((item) => {
                const isActive = isAppCategoryActive(item.id);
                const navKey = `app//${item.id}`;
                return (
                  <Button
                    key={item.id}
                    ref={(el) => {
                      if (el) navItemRefs.current.set(navKey, el);
                    }}
                    role="tab"
                    aria-selected={isActive}
                    tabIndex={isActive ? 0 : -1}
                    variant={isActive ? 'secondary' : 'ghost'}
                    size="sm"
                    className={cn(
                      'w-full justify-start gap-2 h-7 text-xs',
                      isActive && 'bg-sidebar-accent'
                    )}
                    onClick={() => handleNavigateApp(item.id)}
                    onKeyDown={(e) => handleNavKeyDown(e, navKey)}
                  >
                    {item.icon}
                    {item.label}
                  </Button>
                );
              })}

              {/* More section divider */}
              <div className="pt-5 pb-1" role="presentation">
                <span className="text-2xs font-medium text-muted-foreground px-2 uppercase tracking-wider">More</span>
              </div>

              {moreNavItems.map((item) => {
                const isActive = isAppCategoryActive(item.id);
                const navKey = `app//${item.id}`;
                return (
                  <Button
                    key={item.id}
                    ref={(el) => {
                      if (el) navItemRefs.current.set(navKey, el);
                    }}
                    role="tab"
                    aria-selected={isActive}
                    tabIndex={isActive ? 0 : -1}
                    variant={isActive ? 'secondary' : 'ghost'}
                    size="sm"
                    className={cn(
                      'w-full justify-start gap-2 h-7 text-xs',
                      isActive && 'bg-sidebar-accent'
                    )}
                    onClick={() => handleNavigateApp(item.id)}
                    onKeyDown={(e) => handleNavKeyDown(e, navKey)}
                  >
                    {item.icon}
                    {item.label}
                  </Button>
                );
              })}
            </div>

            {/* Workspaces Section */}
            {workspaces.length > 0 && (
              <div className="space-y-0.5">
                <div className="pt-5 pb-1" role="presentation">
                  <span className="text-2xs font-medium text-muted-foreground px-2 uppercase tracking-wider">Workspaces</span>
                </div>

                {workspaces.map((workspace) => {
                  const color = resolveWorkspaceColor(workspace.id, workspaceColors);
                  const isExpanded = expandedWorkspaces.has(workspace.id);
                  const wsActive = isWorkspaceActive(workspace.id);
                  const wsNavKey = `ws//${workspace.id}`;

                  return (
                    <Collapsible key={workspace.id} open={isExpanded} onOpenChange={() => {
                      toggleWorkspace(workspace.id);
                      // Also navigate to repository section so content panel stays in sync
                      if (!isExpanded) {
                        handleNavigateWorkspace(workspace.id, 'repository');
                      }
                    }}>
                      <CollapsibleTrigger asChild>
                        <Button
                          ref={(el) => {
                            if (el) navItemRefs.current.set(wsNavKey, el);
                          }}
                          variant="ghost"
                          size="sm"
                          className={cn(
                            'w-full justify-start gap-2 h-7 text-xs group/ws',
                            wsActive && 'bg-sidebar-accent'
                          )}
                          onKeyDown={(e) => handleNavKeyDown(e, wsNavKey)}
                        >
                          <div
                            className="w-2.5 h-2.5 rounded-full shrink-0"
                            style={{ backgroundColor: color }}
                          />
                          <span className="truncate flex-1 text-left">{workspace.name}</span>
                          <ChevronDown className={cn(
                            'h-3 w-3 text-muted-foreground transition-transform shrink-0',
                            !isExpanded && '-rotate-90'
                          )} />
                        </Button>
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <div className="ml-5 space-y-0.5">
                          {workspaceSubPages.map((subPage) => {
                            const isSubActive = isWorkspaceSubActive(workspace.id, subPage.id);
                            const subNavKey = `ws//${workspace.id}//${subPage.id}`;
                            return (
                              <Button
                                key={subPage.id}
                                ref={(el) => {
                                  if (el) navItemRefs.current.set(subNavKey, el);
                                }}
                                variant={isSubActive ? 'secondary' : 'ghost'}
                                size="sm"
                                className={cn(
                                  'w-full justify-start gap-2 h-7 text-xs',
                                  isSubActive && 'bg-sidebar-accent'
                                )}
                                onClick={() => handleNavigateWorkspace(workspace.id, subPage.id)}
                                onKeyDown={(e) => handleNavKeyDown(e, subNavKey)}
                              >
                                {subPage.icon}
                                {subPage.label}
                              </Button>
                            );
                          })}
                        </div>
                      </CollapsibleContent>
                    </Collapsible>
                  );
                })}
              </div>
            )}
          </div>
        </ScrollArea>
      </nav>

      {/* Settings Content */}
      <div
        className="flex-1 overflow-hidden flex flex-col"
        role="tabpanel"
        aria-label={contentLabel}
      >
        {/* Spacer to match toolbar height */}
        <div className="h-10 shrink-0" />

        <ScrollArea className="flex-1 min-h-0">
          <div className="max-w-2xl mx-auto py-8 px-8">
            {/* Hidden focusable element for keyboard focus management */}
            <h2 ref={contentRef} tabIndex={-1} className="sr-only">
              {contentLabel}
            </h2>
            {isSearching ? (
              <SettingsSearchResults
                results={searchResults}
                query={searchQuery.trim()}
                onNavigate={handleNavigateApp}
              />
            ) : selectedView.type === 'app' ? (
              <>
                {selectedView.category === 'general' && <GeneralSettings />}
                {selectedView.category === 'appearance' && <AppearanceSettings />}
                {selectedView.category === 'ai-models' && <AIModelSettings />}
                {selectedView.category === 'instructions' && <InstructionsSettings />}
                {selectedView.category === 'git' && <GitSettings />}
                {selectedView.category === 'review' && <ReviewSettings />}
                {selectedView.category === 'actions' && <ActionSettings />}
                {selectedView.category === 'account' && <AccountSettings />}
                {selectedView.category === 'advanced' && <AdvancedSettings />}
                {selectedView.category === 'about' && <AboutSettings />}
              </>
            ) : (
              <WorkspaceSettingsContent
                key={selectedView.workspaceId}
                workspaceId={selectedView.workspaceId}
                section={selectedView.section}
              />
            )}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}
