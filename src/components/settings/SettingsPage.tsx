'use client';

import { useState, useMemo } from 'react';
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

interface SettingsPageProps {
  onBack: () => void;
  initialCategory?: SettingsCategory;
}

type SettingsCategory =
  | 'general'
  | 'appearance'
  | 'ai-models'
  | 'instructions'
  | 'git'
  | 'review'
  | 'account'
  | 'advanced'
  | 'about';

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

export function SettingsPage({ onBack, initialCategory = 'general' }: SettingsPageProps) {
  const [selectedCategory, setSelectedCategory] = useState<SettingsCategory>(initialCategory);

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
            {/* Main nav items */}
            <div className="space-y-0.5">
              {mainNavItems.map((item) => (
                <Button
                  key={item.id}
                  variant={selectedCategory === item.id ? 'secondary' : 'ghost'}
                  size="sm"
                  className={cn(
                    'w-full justify-start gap-2 h-7 text-xs',
                    selectedCategory === item.id && 'bg-sidebar-accent'
                  )}
                  onClick={() => setSelectedCategory(item.id)}
                >
                  {item.icon}
                  {item.label}
                </Button>
              ))}
            </div>

            {/* More section */}
            <div className="mt-6">
              <span className="text-2xs font-medium text-muted-foreground px-2 uppercase tracking-wider">More</span>
              <div className="mt-2 space-y-0.5">
                {moreNavItems.map((item) => (
                  <Button
                    key={item.id}
                    variant={selectedCategory === item.id ? 'secondary' : 'ghost'}
                    size="sm"
                    className={cn(
                      'w-full justify-start gap-2 h-7 text-xs',
                      selectedCategory === item.id && 'bg-sidebar-accent'
                    )}
                    onClick={() => setSelectedCategory(item.id)}
                  >
                    {item.icon}
                    {item.label}
                  </Button>
                ))}
              </div>
            </div>
          </div>
        </ScrollArea>
      </div>

      {/* Settings Content */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {/* Spacer to match toolbar height */}
        <div className="h-10 shrink-0" />

        <ScrollArea className="flex-1">
          <div className="max-w-2xl mx-auto py-8 px-8">
            {selectedCategory === 'general' && <GeneralSettings />}
            {selectedCategory === 'appearance' && <AppearanceSettings />}
            {selectedCategory === 'ai-models' && <AIModelSettings />}
            {selectedCategory === 'instructions' && <InstructionsSettings />}
            {selectedCategory === 'git' && <GitSettings />}
            {selectedCategory === 'review' && <ReviewSettings />}
            {selectedCategory === 'account' && <AccountSettings />}
            {selectedCategory === 'advanced' && <AdvancedSettings />}
            {selectedCategory === 'about' && <AboutSettings />}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}
