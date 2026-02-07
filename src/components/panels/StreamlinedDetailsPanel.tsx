'use client';

import { useState, useMemo, type ReactNode } from 'react';
import { ChevronDown, ChevronRight, MoreHorizontal } from 'lucide-react';
import { useSelectedIds } from '@/stores/selectors';
import { useAppStore } from '@/stores/appStore';
import { TodoPanel } from '@/components/panels/TodoPanel';
import { PlansPanel } from '@/components/panels/PlansPanel';
import { ReviewPanel } from '@/components/panels/ReviewPanel';
import { ChecksPanel } from '@/components/panels/ChecksPanel';
import { CheckpointTimeline } from '@/components/panels/CheckpointTimeline';
import { BudgetStatusPanel } from '@/components/panels/BudgetStatusPanel';
import { McpServersPanel } from '@/components/panels/McpServersPanel';
import { FileHistoryPanel } from '@/components/panels/FileHistoryPanel';
import { ScriptsPanel } from '@/components/panels/ScriptsPanel';
import { SessionInfoPanel } from '@/components/panels/SessionInfoPanel';
import { Button } from '@/components/ui/button';
import { ErrorBoundary } from '@/components/shared/ErrorBoundary';

// ─── Types ───────────────────────────────────────────────────────────────────

interface SectionConfig {
  id: string;
  label: string;
  render: () => ReactNode;
  tier: 'default' | 'contextual' | 'advanced';
  isRelevant?: () => boolean;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function StreamlinedDetailsPanel() {
  const { selectedSessionId, selectedWorkspaceId } = useSelectedIds();
  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    new Set(['tasks', 'plans'])
  );
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Check for contextual relevance
  const hasReview = useAppStore(
    (s) => {
      if (!selectedSessionId) return false;
      return s.conversations.some((c) => c.sessionId === selectedSessionId && c.type === 'review');
    }
  );
  const hasChecks = useAppStore(
    (s) => {
      if (!selectedSessionId) return false;
      const session = s.sessions.find((ss) => ss.id === selectedSessionId);
      return !!(session?.hasCheckFailures);
    }
  );

  const sections: SectionConfig[] = useMemo(
    () => [
      { id: 'tasks', label: 'Tasks', render: () => <TodoPanel />, tier: 'default' },
      { id: 'plans', label: 'Plans', render: () => <PlansPanel />, tier: 'default' },
      {
        id: 'review', label: 'Review', tier: 'contextual', isRelevant: () => hasReview,
        render: () => <ReviewPanel workspaceId={selectedWorkspaceId} sessionId={selectedSessionId} />,
      },
      {
        id: 'checks', label: 'Checks', tier: 'contextual', isRelevant: () => hasChecks,
        render: () => <ChecksPanel />,
      },
      { id: 'checkpoints', label: 'Checkpoints', render: () => <CheckpointTimeline />, tier: 'advanced' },
      { id: 'file-history', label: 'File History', render: () => <FileHistoryPanel />, tier: 'advanced' },
      { id: 'budget', label: 'Budget', render: () => <BudgetStatusPanel />, tier: 'advanced' },
      { id: 'mcp', label: 'MCP Servers', render: () => <McpServersPanel />, tier: 'advanced' },
      { id: 'scripts', label: 'Scripts', render: () => <ScriptsPanel />, tier: 'advanced' },
      { id: 'info', label: 'Session Info', render: () => <SessionInfoPanel />, tier: 'advanced' },
    ],
    [hasReview, hasChecks, selectedWorkspaceId, selectedSessionId]
  );

  const visibleSections = useMemo(() => {
    return sections.filter((s) => {
      if (s.tier === 'default') return true;
      if (s.tier === 'contextual') return s.isRelevant?.() ?? false;
      if (s.tier === 'advanced') return showAdvanced;
      return false;
    });
  }, [sections, showAdvanced]);

  const toggleSection = (id: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  if (!selectedSessionId) return null;

  return (
    <div className="flex flex-col h-full bg-content-background">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border/50">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Details
        </span>
      </div>

      {/* Sections */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {visibleSections.map((section) => {
          const isExpanded = expandedSections.has(section.id);

          return (
            <div key={section.id} className="border-b border-border/30">
              <button
                onClick={() => toggleSection(section.id)}
                className="flex items-center gap-1.5 w-full px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
              >
                {isExpanded ? (
                  <ChevronDown className="h-3 w-3 shrink-0" />
                ) : (
                  <ChevronRight className="h-3 w-3 shrink-0" />
                )}
                {section.label}
              </button>
              {isExpanded && (
                <div className="pb-2">
                  <ErrorBoundary section={section.label}>
                    {section.render()}
                  </ErrorBoundary>
                </div>
              )}
            </div>
          );
        })}

        {/* Show More / Less toggle */}
        <div className="px-3 py-2">
          <Button
            variant="ghost"
            size="sm"
            className="w-full h-7 text-xs text-muted-foreground hover:text-foreground"
            onClick={() => setShowAdvanced(!showAdvanced)}
          >
            <MoreHorizontal className="h-3.5 w-3.5 mr-1.5" />
            {showAdvanced ? 'Show Less' : 'Show More'}
          </Button>
        </div>
      </div>
    </div>
  );
}
