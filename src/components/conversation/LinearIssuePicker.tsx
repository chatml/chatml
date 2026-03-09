'use client';

import { useState, useEffect, useRef } from 'react';
import { Link, Check, Search, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { listMyLinearIssues, searchLinearIssues, type LinearIssueDTO } from '@/lib/api';
import { useLinearAuthStore } from '@/stores/linearAuthStore';
import { startLinearOAuthFlow, isLinearConfigured } from '@/lib/linearAuth';

interface LinearIssuePickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedIssue: LinearIssueDTO | null;
  onIssueChange: (issue: LinearIssueDTO | null) => void;
}

export function LinearIssuePicker({
  open,
  onOpenChange,
  selectedIssue,
  onIssueChange,
}: LinearIssuePickerProps) {
  const [issues, setIssues] = useState<LinearIssueDTO[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { isAuthenticated } = useLinearAuthStore();

  useEffect(() => {
    if (!open || !isAuthenticated) return;
    let cancelled = false;

    const fetchIssues = async (query?: string) => {
      setLoading(true);
      setError(null);
      try {
        const data = query
          ? await searchLinearIssues(query)
          : await listMyLinearIssues();
        if (!cancelled) setIssues(data);
      } catch (err) {
        if (cancelled) return;
        // 401 means not authenticated — don't show as error
        if (err instanceof Error && err.message.includes('401')) {
          setIssues([]);
        } else {
          setError('Failed to load issues');
          console.error('Failed to fetch Linear issues:', err);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }
    if (searchQuery.trim() === '') {
      fetchIssues();
    } else {
      searchTimeoutRef.current = setTimeout(() => {
        fetchIssues(searchQuery.trim());
      }, 300);
    }
    return () => {
      cancelled = true;
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [searchQuery, open, isAuthenticated]);

  const handleSelect = (issue: LinearIssueDTO) => {
    if (selectedIssue?.id === issue.id) {
      onIssueChange(null);
    } else {
      onIssueChange(issue);
    }
  };

  const handleConnectLinear = async () => {
    try {
      useLinearAuthStore.getState().startOAuth();
      await startLinearOAuthFlow();
    } catch (err) {
      console.error('Failed to start Linear OAuth:', err);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Link Linear Issue</DialogTitle>
        </DialogHeader>

        {!isAuthenticated ? (
          <div className="flex flex-col items-center gap-3 py-8">
            <Link className="size-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground text-center">
              {isLinearConfigured
                ? 'Connect your Linear account to link issues to conversations.'
                : 'Linear integration is not configured for this build.'}
            </p>
            {isLinearConfigured && (
              <Button onClick={handleConnectLinear} size="sm">
                <ExternalLink className="size-3.5 mr-1.5" />
                Connect Linear
              </Button>
            )}
          </div>
        ) : (
          <>
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
              <Input
                placeholder="Search issues..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>

            <div className="max-h-[300px] overflow-y-auto space-y-2">
              {loading ? (
                <div className="text-sm text-muted-foreground text-center py-8">Loading issues...</div>
              ) : error ? (
                <div className="text-sm text-destructive text-center py-8">{error}</div>
              ) : issues.length === 0 ? (
                <div className="text-sm text-muted-foreground text-center py-8">
                  {searchQuery ? 'No issues found.' : 'No active issues assigned to you.'}
                </div>
              ) : (
                issues.map((issue) => {
                  const isSelected = selectedIssue?.id === issue.id;
                  return (
                    <button
                      key={issue.id}
                      type="button"
                      onClick={() => handleSelect(issue)}
                      className={cn(
                        'w-full text-left p-3 rounded-lg border transition-colors',
                        isSelected
                          ? 'border-brand bg-brand/5'
                          : 'border-border hover:border-brand/50 hover:bg-muted/50'
                      )}
                    >
                      <div className="flex items-start gap-2">
                        <div className={cn(
                          'mt-0.5 size-4 rounded border flex items-center justify-center shrink-0',
                          isSelected ? 'bg-primary border-primary' : 'border-muted-foreground/30'
                        )}>
                          {isSelected && <Check className="size-3 text-primary-foreground" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-mono text-muted-foreground shrink-0">
                              {issue.identifier}
                            </span>
                            <span className="text-sm font-medium truncate">
                              {issue.title}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 mt-1 flex-wrap">
                            <span className="text-xs text-muted-foreground">
                              {issue.stateName}
                            </span>
                            {issue.labels.map((label) => (
                              <span
                                key={label}
                                className="text-xs bg-muted px-1.5 py-0.5 rounded"
                              >
                                {label}
                              </span>
                            ))}
                            {issue.project && (
                              <span className="text-xs text-muted-foreground">
                                {issue.project}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => onOpenChange(false)}>
            {selectedIssue ? `Link ${selectedIssue.identifier}` : 'Done'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
