'use client';

import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  FolderGit2,
  Search,
  History,
  HelpCircle,
  Settings,
} from 'lucide-react';
import { cn } from '@/lib/utils';

export type ActivityView = 'workspaces' | 'search' | 'history';

interface ActivityBarProps {
  activeView: ActivityView;
  onViewChange: (view: ActivityView) => void;
}

const activities: { id: ActivityView; icon: React.ElementType; label: string; shortcut: string }[] = [
  { id: 'workspaces', icon: FolderGit2, label: 'Workspaces', shortcut: '⌘ 1' },
  { id: 'search', icon: Search, label: 'Search', shortcut: '⌘ 2' },
  { id: 'history', icon: History, label: 'History', shortcut: '⌘ 3' },
];

export function ActivityBar({ activeView, onViewChange }: ActivityBarProps) {
  return (
    <div className="flex flex-col h-full w-12 bg-sidebar border-r border-sidebar-border">
      {/* Top activities - pt-10 adds space for macOS traffic lights */}
      <div className="flex-1 flex flex-col items-center pt-10 pb-2 gap-1">
        {activities.map((activity) => {
          const Icon = activity.icon;
          const isActive = activeView === activity.id;

          return (
            <Tooltip key={activity.id} delayDuration={0}>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn(
                    'h-10 w-10 relative group transition-all duration-200',
                    isActive
                      ? 'text-foreground bg-sidebar-accent'
                      : 'text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/50'
                  )}
                  onClick={() => onViewChange(activity.id)}
                >
                  {isActive && (
                    <div className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-6 bg-gradient-to-b from-primary to-purple-500 rounded-r" />
                  )}
                  <Icon className="h-5 w-5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">
                {activity.label} <span className="ml-2 px-1.5 py-0.5 bg-background/20 rounded text-[13px]">{activity.shortcut}</span>
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>

      {/* Bottom - Help & Settings */}
      <div className="flex flex-col items-center py-2 gap-1 border-t border-sidebar-border">
        <Tooltip delayDuration={0}>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-10 w-10 text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/50"
            >
              <HelpCircle className="h-5 w-5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">Help</TooltipContent>
        </Tooltip>
        <Tooltip delayDuration={0}>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-10 w-10 text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/50"
            >
              <Settings className="h-5 w-5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">Settings</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}
