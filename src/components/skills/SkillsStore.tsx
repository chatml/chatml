'use client';

import { useEffect, useMemo, useCallback, useState } from 'react';
import { useSkillsStore } from '@/stores/skillsStore';
import { FullContentLayout } from '@/components/layout/FullContentLayout';
import { useMainToolbarContent } from '@/hooks/useMainToolbarContent';
import { useToast } from '@/components/ui/toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Sparkles,
  Search,
  Code,
  FileText,
  GitBranch,
  Download,
  Check,
  RefreshCw,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { SkillDTO, SkillCategory } from '@/lib/api';

const CATEGORY_OPTIONS: { value: SkillCategory | 'all'; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { value: 'all', label: 'All Skills', icon: Sparkles },
  { value: 'development', label: 'Development', icon: Code },
  { value: 'documentation', label: 'Documentation', icon: FileText },
  { value: 'version-control', label: 'Version Control', icon: GitBranch },
];

interface SkillCardProps {
  skill: SkillDTO;
  onInstallToggle: (skillId: string, isInstalled: boolean) => Promise<void>;
}

function SkillCard({ skill, onInstallToggle }: SkillCardProps) {
  const [isUpdating, setIsUpdating] = useState(false);

  const handleToggle = async () => {
    setIsUpdating(true);
    try {
      await onInstallToggle(skill.id, skill.installed);
    } finally {
      setIsUpdating(false);
    }
  };

  const categoryIcon = {
    development: Code,
    documentation: FileText,
    'version-control': GitBranch,
  }[skill.category];
  const CategoryIcon = categoryIcon;

  return (
    <div className="bg-surface-1 rounded-lg p-4 border border-border/50 hover:border-border transition-colors">
      {/* Header */}
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-md bg-amber-500/10">
            <CategoryIcon className="h-4 w-4 text-nav-icon-skills" />
          </div>
          <div>
            <h3 className="font-medium">{skill.name}</h3>
            <p className="text-xs text-muted-foreground">{skill.author}</p>
          </div>
        </div>
        {skill.installed && (
          <Badge variant="secondary" className="shrink-0 gap-1">
            <Check className="h-3 w-3" />
            Installed
          </Badge>
        )}
      </div>

      {/* Description */}
      <p className="text-sm text-muted-foreground mb-3 line-clamp-2">
        {skill.description}
      </p>

      {/* Actions */}
      <Button
        variant={skill.installed ? 'outline' : 'default'}
        size="sm"
        className="w-full"
        onClick={handleToggle}
        disabled={isUpdating}
      >
        {isUpdating ? (
          <RefreshCw className="h-3.5 w-3.5 animate-spin" />
        ) : skill.installed ? (
          'Uninstall'
        ) : (
          <>
            <Download className="h-3.5 w-3.5 mr-1.5" />
            Install
          </>
        )}
      </Button>
    </div>
  );
}

export function SkillsStore() {
  const {
    skills,
    isLoading,
    error,
    selectedCategory,
    searchQuery,
    fetchSkills,
    installSkill,
    uninstallSkill,
    setSelectedCategory,
    setSearchQuery,
    getFilteredSkills,
    getInstalledSkills,
  } = useSkillsStore();

  useEffect(() => {
    fetchSkills();
  }, [fetchSkills]);

  const filteredSkills = getFilteredSkills();
  const installedCount = getInstalledSkills().length;
  const { error: showError } = useToast();

  // Toolbar configuration
  const toolbarConfig = useMemo(() => ({
    titlePosition: 'center' as const,
    title: (
      <span className="flex items-center gap-1.5 shrink-0">
        <Sparkles className="h-4 w-4 text-nav-icon-skills" />
        <h1 className="text-base font-semibold">Skills Store</h1>
      </span>
    ),
    bottom: {
      title: (
        <span className="text-sm text-muted-foreground">
          {filteredSkills.length} {filteredSkills.length === 1 ? 'skill' : 'skills'} available
          {installedCount > 0 && (
            <span className="text-nav-icon-skills ml-2">{installedCount} installed</span>
          )}
        </span>
      ),
      titlePosition: 'left' as const,
      actions: (
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={() => fetchSkills()}
          disabled={isLoading}
          title="Refresh"
        >
          <RefreshCw className={cn('h-3.5 w-3.5', isLoading && 'animate-spin')} />
        </Button>
      ),
    },
  }), [filteredSkills.length, installedCount, isLoading, fetchSkills]);
  useMainToolbarContent(toolbarConfig);

  const handleInstallToggle = useCallback(async (skillId: string, isInstalled: boolean) => {
    try {
      if (isInstalled) {
        await uninstallSkill(skillId);
      } else {
        await installSkill(skillId);
      }
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Failed to update skill');
    }
  }, [installSkill, uninstallSkill, showError]);

  return (
    <FullContentLayout>
      <div className="h-full flex flex-col overflow-hidden">
        {/* Search and Filter Bar */}
        <div className="p-4 border-b border-border/50 space-y-3">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search skills..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>

          {/* Category Filter */}
          <div className="flex items-center gap-2 overflow-x-auto pb-1">
            {CATEGORY_OPTIONS.map((opt) => {
              const isActive = opt.value === 'all'
                ? selectedCategory === null
                : selectedCategory === opt.value;
              const Icon = opt.icon;
              return (
                <Button
                  key={opt.value}
                  variant={isActive ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setSelectedCategory(opt.value === 'all' ? null : opt.value)}
                  className="shrink-0"
                >
                  <Icon className="h-3.5 w-3.5 mr-1.5" />
                  {opt.label}
                </Button>
              );
            })}
          </div>
        </div>

        {/* Skills Grid */}
        <div className="flex-1 overflow-y-auto p-4">
          {isLoading && skills.length === 0 ? (
            <div className="flex items-center justify-center h-full">
              <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <div className="text-center py-12">
              <p className="text-destructive">{error}</p>
              <Button variant="outline" onClick={() => fetchSkills()} className="mt-4">
                Retry
              </Button>
            </div>
          ) : filteredSkills.length === 0 ? (
            <div className="text-center py-12">
              <Sparkles className="h-12 w-12 text-muted-foreground/50 mx-auto mb-4" />
              <p className="text-muted-foreground">No skills found</p>
              {searchQuery && (
                <Button
                  variant="link"
                  onClick={() => setSearchQuery('')}
                  className="mt-2"
                >
                  Clear search
                </Button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredSkills.map((skill) => (
                <SkillCard
                  key={skill.id}
                  skill={skill}
                  onInstallToggle={handleInstallToggle}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </FullContentLayout>
  );
}
