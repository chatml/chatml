'use client';

import { useEffect, useMemo, useCallback, useState, type ComponentType } from 'react';
import { useSkillsStore } from '@/stores/skillsStore';
import { FullContentLayout } from '@/components/layout/FullContentLayout';
import { useMainToolbarContent } from '@/hooks/useMainToolbarContent';
import { useToast } from '@/components/ui/toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Sparkles,
  Search,
  Code,
  FileText,
  GitBranch,
  Plus,
  Check,
  RefreshCw,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { SkillDetailDialog } from './SkillDetailDialog';
import type { SkillDTO, SkillCategory } from '@/lib/api';

export const CATEGORY_ICON_MAP: Record<SkillCategory, ComponentType<{ className?: string }>> = {
  'development': Code,
  'documentation': FileText,
  'version-control': GitBranch,
};

interface SkillRowProps {
  skill: SkillDTO;
  onInstallToggle: (skillId: string, isInstalled: boolean) => Promise<void>;
  onSelect: (skill: SkillDTO) => void;
}

function SkillRow({ skill, onInstallToggle, onSelect }: SkillRowProps) {
  const [isUpdating, setIsUpdating] = useState(false);
  const CategoryIcon = CATEGORY_ICON_MAP[skill.category];

  const handleInstall = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsUpdating(true);
    try {
      await onInstallToggle(skill.id, skill.installed);
    } finally {
      setIsUpdating(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect(skill);
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect(skill)}
      onKeyDown={handleKeyDown}
      className="flex items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-accent/50 cursor-pointer transition-colors group"
    >
      <div className="flex items-center justify-center h-9 w-9 rounded-full bg-amber-500/10 shrink-0">
        <CategoryIcon className="h-4 w-4 text-nav-icon-skills" />
      </div>
      <div className="flex-1 min-w-0">
        <span className="text-sm font-medium">{skill.name}</span>
        <p className="text-xs text-muted-foreground truncate">{skill.description}</p>
      </div>
      {skill.installed ? (
        <div className="shrink-0">
          <Check className="h-4 w-4 text-green-500" />
        </div>
      ) : (
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={handleInstall}
          disabled={isUpdating}
          title="Install"
        >
          {isUpdating ? (
            <RefreshCw className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Plus className="h-4 w-4" />
          )}
        </Button>
      )}
    </div>
  );
}

export function SkillsStore() {
  const {
    skills,
    isLoading,
    error,
    searchQuery,
    fetchSkills,
    installSkill,
    uninstallSkill,
    setSearchQuery,
  } = useSkillsStore();

  const [selectedSkill, setSelectedSkill] = useState<SkillDTO | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  useEffect(() => {
    fetchSkills();
  }, [fetchSkills]);

  const filteredSkills = useMemo(() => {
    return skills.filter((skill) => {
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        return (
          skill.name.toLowerCase().includes(q) ||
          skill.description.toLowerCase().includes(q) ||
          skill.author.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [skills, searchQuery]);

  const installedSkills = useMemo(
    () => filteredSkills.filter((s) => s.installed),
    [filteredSkills]
  );
  const availableSkills = useMemo(
    () => filteredSkills.filter((s) => !s.installed),
    [filteredSkills]
  );

  // Keep selectedSkill synced with store state
  const syncedSelectedSkill = useMemo(() => {
    if (!selectedSkill) return null;
    return skills.find((s) => s.id === selectedSkill.id) ?? selectedSkill;
  }, [skills, selectedSkill]);

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
    actions: (
      <div className="flex items-center gap-1.5">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
          <Input
            placeholder="Search..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-7 w-40 text-xs pl-7"
          />
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => fetchSkills()}
          disabled={isLoading}
          title="Refresh"
        >
          <RefreshCw className={cn('h-3.5 w-3.5', isLoading && 'animate-spin')} />
        </Button>
      </div>
    ),
  }), [searchQuery, isLoading, fetchSkills, setSearchQuery]);
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

  const handleSelectSkill = useCallback((skill: SkillDTO) => {
    setSelectedSkill(skill);
    setDialogOpen(true);
  }, []);

  return (
    <FullContentLayout>
      <div className="h-full flex flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto">
          {/* Page Header */}
          <div className="px-6 pt-6 pb-4">
            <h2 className="text-2xl font-bold">Skills</h2>
            <p className="text-muted-foreground mt-1">Give ChatML superpowers.</p>
          </div>

          {isLoading && skills.length === 0 ? (
            <div className="flex items-center justify-center py-20">
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
            <div className="px-4 pb-6 space-y-6">
              {/* Installed Section */}
              {installedSkills.length > 0 && (
                <section>
                  <h2 className="text-xs font-semibold uppercase text-muted-foreground tracking-wider px-3 mb-1">
                    Installed
                  </h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-0.5">
                    {installedSkills.map((skill) => (
                      <SkillRow
                        key={skill.id}
                        skill={skill}
                        onInstallToggle={handleInstallToggle}
                        onSelect={handleSelectSkill}
                      />
                    ))}
                  </div>
                </section>
              )}

              {/* Available Section */}
              {availableSkills.length > 0 && (
                <section>
                  <h2 className="text-xs font-semibold uppercase text-muted-foreground tracking-wider px-3 mb-1">
                    Available
                  </h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-0.5">
                    {availableSkills.map((skill) => (
                      <SkillRow
                        key={skill.id}
                        skill={skill}
                        onInstallToggle={handleInstallToggle}
                        onSelect={handleSelectSkill}
                      />
                    ))}
                  </div>
                </section>
              )}
            </div>
          )}
        </div>
      </div>

      <SkillDetailDialog
        skill={syncedSelectedSkill}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onInstallToggle={handleInstallToggle}
      />
    </FullContentLayout>
  );
}
