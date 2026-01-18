'use client';

import { useState } from 'react';
import { useAppStore } from '@/stores/appStore';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import {
  History,
  Search,
  MessageSquare,
  GitBranch,
  Calendar,
  Trash2,
  ExternalLink,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

interface HistoryItem {
  id: string;
  type: 'conversation' | 'session';
  title: string;
  workspace: string;
  branch?: string;
  date: string;
  preview: string;
}

export function HistoryPanel() {
  const { conversations, sessions, workspaces } = useAppStore();
  const [filter, setFilter] = useState('');

  // Build history from conversations and sessions
  const historyItems: HistoryItem[] = conversations.map((conv) => {
    const session = sessions.find((s) => s.id === conv.sessionId);
    const workspace = workspaces.find((w) => w.id === session?.workspaceId);
    return {
      id: conv.id,
      type: 'conversation',
      title: conv.title,
      workspace: workspace?.name || 'Unknown',
      branch: session?.branch,
      date: conv.updatedAt,
      preview: 'Conversation...',
    };
  });

  const formatDate = (date: string) => {
    const d = new Date(date);
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const filteredItems = historyItems.filter(
    (item) =>
      item.title.toLowerCase().includes(filter.toLowerCase()) ||
      item.workspace.toLowerCase().includes(filter.toLowerCase())
  );

  // Group by date
  const groupedItems = filteredItems.reduce((acc, item) => {
    const dateKey = formatDate(item.date);
    if (!acc[dateKey]) acc[dateKey] = [];
    acc[dateKey].push(item);
    return acc;
  }, {} as Record<string, HistoryItem[]>);

  return (
    <div className="flex flex-col h-full bg-sidebar text-sidebar-foreground">
      {/* Header */}
      <div className="h-11 flex items-center gap-2 px-3 border-b border-sidebar-border shrink-0">
        <History className="w-4 h-4 text-muted-foreground" />
        <span className="text-sm font-semibold">History</span>
      </div>

      {/* Search */}
      <div className="p-2 border-b border-sidebar-border">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            placeholder="Filter history..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="pl-8 h-8 text-sm bg-sidebar-accent border-sidebar-border"
          />
        </div>
      </div>

      {/* History List */}
      <ScrollArea className="flex-1">
        {Object.keys(groupedItems).length === 0 ? (
          <div className="px-3 py-12 text-center">
            <div className="w-12 h-12 rounded-full bg-muted/50 flex items-center justify-center mx-auto mb-3">
              <History className="w-6 h-6 text-muted-foreground/50" />
            </div>
            <p className="text-sm text-muted-foreground">No history yet</p>
            <p className="text-xs text-muted-foreground/70 mt-1">
              Your past conversations will appear here
            </p>
          </div>
        ) : (
          <div className="py-1">
            {Object.entries(groupedItems).map(([date, items]) => (
              <div key={date}>
                <div className="px-3 py-1.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                  <Calendar className="w-3 h-3" />
                  {date}
                </div>
                {items.map((item) => (
                  <div
                    key={item.id}
                    className="group flex items-start gap-2 px-3 py-2 hover:bg-sidebar-accent cursor-pointer"
                  >
                    <MessageSquare className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{item.title}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[10px] text-muted-foreground">
                          {item.workspace}
                        </span>
                        {item.branch && (
                          <>
                            <span className="text-muted-foreground/50">·</span>
                            <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                              <GitBranch className="w-2.5 h-2.5" />
                              {item.branch}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <ExternalLink className="h-3 w-3" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem>Open</DropdownMenuItem>
                        <DropdownMenuItem>Copy link</DropdownMenuItem>
                        <DropdownMenuItem className="text-destructive">
                          <Trash2 className="h-3.5 w-3.5 mr-2" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
