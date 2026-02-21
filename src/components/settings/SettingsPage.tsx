'use client';

import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  ArrowLeft,
  Settings2,
  Palette,
  Bot,
  GitBranch,
  Eye,
  User,
  Wrench,
  Info,
  ScrollText,
  Search,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useMainToolbarContent } from '@/hooks/useMainToolbarContent';
import { GeneralSettings } from './sections/GeneralSettings';
import { AppearanceSettings } from './sections/AppearanceSettings';
import { AIModelSettings } from './sections/AIModelSettings';
import { GitSettings } from './sections/GitSettings';
import { ReviewSettings } from './sections/ReviewSettings';
import { AccountSettings } from './sections/AccountSettings';
import { AdvancedSettings } from './sections/AdvancedSettings';
import { AboutSettings } from './sections/AboutSettings';
import { InstructionsSettings } from './sections/InstructionsSettings';
import { SettingsSearchResults } from './SettingsSearchResults';
import { searchSettings, type SettingsCategory } from './settingsRegistry';

interface SettingsPageProps {
  onBack: () => void;
  initialCategory?: SettingsCategory;
}

interface NavItem {
  id: SettingsCategory;
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
  { id: 'account', label: 'Account', icon: <User className="w-3.5 h-3.5" /> },
];

const moreNavItems: NavItem[] = [
  { id: 'advanced', label: 'Advanced', icon: <Wrench className="w-3.5 h-3.5" /> },
  { id: 'about', label: 'About', icon: <Info className="w-3.5 h-3.5" /> },
];

const allNavItems = [...mainNavItems, ...moreNavItems];

export function SettingsPage({ onBack, initialCategory = 'general' }: SettingsPageProps) {
  const [selectedCategory, setSelectedCategory] = useState<SettingsCategory>(initialCategory);
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);
  const contentRef = useRef<HTMLHeadingElement>(null);
  const navItemRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const onBackRef = useRef(onBack);
  useEffect(() => { onBackRef.current = onBack; }, [onBack]);

  const isSearching = searchQuery.trim().length > 0;

  const searchResults = useMemo(
    () => (isSearching ? searchSettings(searchQuery) : []),
    [searchQuery, isSearching],
  );

  const handleNavigate = useCallback((category: SettingsCategory, settingId?: string) => {
    setSelectedCategory(category);
    setSearchQuery('');
    // After React renders the new category, scroll to the specific setting if provided
    requestAnimationFrame(() => {
      if (settingId) {
        const el = document.querySelector(`[data-setting-id="${settingId}"]`);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          // Brief highlight to draw attention
          el.classList.add('bg-primary/5');
          setTimeout(() => el.classList.remove('bg-primary/5'), 1500);
          return;
        }
      }
      contentRef.current?.focus();
    });
  }, []);

  // Keyboard navigation for sidebar
  const handleNavKeyDown = useCallback((e: React.KeyboardEvent, currentId: SettingsCategory) => {
    const currentIndex = allNavItems.findIndex((item) => item.id === currentId);
    if (currentIndex === -1) return;

    let nextIndex: number | null = null;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      nextIndex = (currentIndex + 1) % allNavItems.length;
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      nextIndex = (currentIndex - 1 + allNavItems.length) % allNavItems.length;
    } else if (e.key === 'Home') {
      e.preventDefault();
      nextIndex = 0;
    } else if (e.key === 'End') {
      e.preventDefault();
      nextIndex = allNavItems.length - 1;
    }

    if (nextIndex !== null) {
      const nextId = allNavItems[nextIndex].id;
      handleNavigate(nextId);
      navItemRefs.current.get(nextId)?.focus();
    }
  }, [handleNavigate]);

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

  return (
    <div className="flex h-full bg-content-background">
      {/* Settings Sidebar */}
      <nav className="w-56 border-r bg-sidebar flex flex-col" role="navigation" aria-label="Settings">
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
            {/* Search */}
            <div className="relative mb-2">
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

            {/* Single tablist for all categories */}
            <div role="tablist" aria-label="Settings categories" aria-orientation="vertical" className="space-y-0.5">
              {mainNavItems.map((item) => {
                const isActive = !isSearching && selectedCategory === item.id;
                return (
                  <Button
                    key={item.id}
                    ref={(el) => {
                      if (el) navItemRefs.current.set(item.id, el);
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
                    onClick={() => handleNavigate(item.id)}
                    onKeyDown={(e) => handleNavKeyDown(e, item.id)}
                  >
                    {item.icon}
                    {item.label}
                  </Button>
                );
              })}

              {/* Visual-only "More" divider (not a separate tablist) */}
              <div className="pt-5 pb-1" role="presentation">
                <span className="text-2xs font-medium text-muted-foreground px-2 uppercase tracking-wider">More</span>
              </div>

              {moreNavItems.map((item) => {
                const isActive = !isSearching && selectedCategory === item.id;
                return (
                  <Button
                    key={item.id}
                    ref={(el) => {
                      if (el) navItemRefs.current.set(item.id, el);
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
                    onClick={() => handleNavigate(item.id)}
                    onKeyDown={(e) => handleNavKeyDown(e, item.id)}
                  >
                    {item.icon}
                    {item.label}
                  </Button>
                );
              })}
            </div>
          </div>
        </ScrollArea>
      </nav>

      {/* Settings Content */}
      <div
        className="flex-1 overflow-hidden flex flex-col"
        role="tabpanel"
        aria-label={isSearching ? 'Search results' : `${selectedCategory} settings`}
      >
        {/* Spacer to match toolbar height */}
        <div className="h-10 shrink-0" />

        <ScrollArea className="flex-1">
          <div className="max-w-2xl mx-auto py-8 px-8">
            {/* Hidden focusable element for keyboard focus management */}
            <h2 ref={contentRef} tabIndex={-1} className="sr-only">
              {isSearching ? 'Search results' : `${selectedCategory} settings`}
            </h2>
            {isSearching ? (
              <SettingsSearchResults
                results={searchResults}
                query={searchQuery.trim()}
                onNavigate={handleNavigate}
              />
            ) : (
              <>
                {selectedCategory === 'general' && <GeneralSettings />}
                {selectedCategory === 'appearance' && <AppearanceSettings />}
                {selectedCategory === 'ai-models' && <AIModelSettings />}
                {selectedCategory === 'instructions' && <InstructionsSettings />}
                {selectedCategory === 'git' && <GitSettings />}
                {selectedCategory === 'review' && <ReviewSettings />}
                {selectedCategory === 'account' && <AccountSettings />}
                {selectedCategory === 'advanced' && <AdvancedSettings />}
                {selectedCategory === 'about' && <AboutSettings />}
              </>
            )}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}
