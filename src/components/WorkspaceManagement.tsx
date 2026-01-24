'use client';

import { useMemo } from 'react';
import { useAppStore } from '@/stores/appStore';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Search,
  ChevronRight,
  Loader2,
  CheckCircle2,
  Circle,
  ArrowRight,
  ArrowLeft,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface WorkspaceManagementProps {
  onSelectSession: (workspaceId: string, sessionId: string) => void;
  onBack?: () => void;
}

export function WorkspaceManagement({ onSelectSession, onBack }: WorkspaceManagementProps) {
  const { workspaces, sessions } = useAppStore();

  // Group sessions by date
  const groupedSessions = useMemo(() => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);

    const groups: { label: string; count: number; sessions: typeof sessions }[] = [];
    const todaySessions: typeof sessions = [];
    const yesterdaySessions: typeof sessions = [];
    const olderByDate: Map<string, typeof sessions> = new Map();

    // Filter out archived sessions and sort by createdAt descending
    const sortedSessions = [...sessions]
      .filter((s) => !s.archived)
      .sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );

    for (const session of sortedSessions) {
      const sessionDate = new Date(session.createdAt);
      const sessionDay = new Date(
        sessionDate.getFullYear(),
        sessionDate.getMonth(),
        sessionDate.getDate()
      );

      if (sessionDay.getTime() === today.getTime()) {
        todaySessions.push(session);
      } else if (sessionDay.getTime() === yesterday.getTime()) {
        yesterdaySessions.push(session);
      } else {
        // Group by month/year for older sessions
        const monthKey = sessionDate.toLocaleDateString('en-US', {
          month: 'long',
          year: 'numeric',
        });
        const existing = olderByDate.get(monthKey) || [];
        existing.push(session);
        olderByDate.set(monthKey, existing);
      }
    }

    if (todaySessions.length > 0) {
      groups.push({ label: 'Today', count: todaySessions.length, sessions: todaySessions });
    }
    if (yesterdaySessions.length > 0) {
      groups.push({ label: 'Yesterday', count: yesterdaySessions.length, sessions: yesterdaySessions });
    }
    for (const [label, groupSessions] of olderByDate) {
      groups.push({ label, count: groupSessions.length, sessions: groupSessions });
    }

    return groups;
  }, [sessions]);

  const getWorkspaceName = (workspaceId: string) => {
    return workspaces.find((w) => w.id === workspaceId)?.name || 'Unknown';
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'active':
        return <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />;
      case 'done':
        return <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />;
      default:
        return <Circle className="w-3.5 h-3.5 text-muted-foreground/50" />;
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  return (
    <div className="h-full flex flex-col bg-background">
      {/* Header */}
      <div className="h-11 flex items-center gap-3 px-4 border-b bg-muted/30 shrink-0">
        {onBack && (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={onBack}
          >
            <ArrowLeft className="w-4 h-4" />
          </Button>
        )}
        <h1 className="text-sm font-semibold">Session History</h1>
        <div className="flex-1" />
        <span className="text-xs text-muted-foreground">
          {sessions.filter(s => !s.archived).length} active sessions
        </span>
      </div>

      {/* Search Bar */}
      <div className="p-4 border-b">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Filter sessions..."
            className="pl-9 bg-muted/50 border-0"
          />
        </div>
      </div>

      {/* Session List */}
      <ScrollArea className="flex-1">
        <div className="p-4 space-y-6">
          {groupedSessions.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <p className="text-sm">No sessions yet</p>
              <p className="text-xs mt-1">Create a session from the sidebar to get started</p>
            </div>
          ) : (
            groupedSessions.map((group) => (
              <div key={group.label}>
                {/* Group Header */}
                <div className="flex items-center gap-2 mb-2">
                  <h3 className="text-sm font-medium text-foreground">{group.label}</h3>
                  <span className="text-xs text-muted-foreground">{group.count}</span>
                </div>

                {/* Sessions */}
                <div className="space-y-1">
                  {group.sessions.map((session) => (
                    <div
                      key={session.id}
                      className="group flex items-center gap-3 px-3 py-2 rounded-md hover:bg-surface-2 cursor-pointer transition-colors"
                      onClick={() => onSelectSession(session.workspaceId, session.id)}
                    >
                      {/* Status Icon */}
                      {getStatusIcon(session.status)}

                      {/* Workspace Name */}
                      <span className="text-sm text-muted-foreground shrink-0">
                        {getWorkspaceName(session.workspaceId)}
                      </span>

                      {/* Chevron */}
                      <ChevronRight className="w-3 h-3 text-muted-foreground/50 shrink-0" />

                      {/* Session/Branch Name */}
                      <span className="text-sm font-medium text-foreground truncate flex-1">
                        {session.branch || session.name}
                      </span>

                      {/* Status Badge (if active) */}
                      {session.status === 'active' && (
                        <span className="text-xs text-muted-foreground">Working...</span>
                      )}

                      {/* Stats Badge */}
                      {session.stats && (session.stats.additions > 0 || session.stats.deletions > 0) && (
                        <span className="text-xs font-mono px-1.5 py-0.5 rounded bg-green-500/20 text-green-600 dark:text-green-400">
                          +{session.stats.additions}
                        </span>
                      )}

                      {/* Date */}
                      <span className="text-xs text-muted-foreground shrink-0">
                        {formatDate(session.createdAt)}
                      </span>

                      {/* Go to button (visible on hover) */}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectSession(session.workspaceId, session.id);
                        }}
                      >
                        Go to
                        <ArrowRight className="w-3 h-3 ml-1" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
