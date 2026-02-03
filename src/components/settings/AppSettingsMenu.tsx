'use client';

import { useTheme } from 'next-themes';
import { useAuthStore } from '@/stores/authStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuLabel,
} from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Settings,
  Keyboard,
  RefreshCw,
  BookOpen,
  FileText,
  MessageCircle,
  LogOut,
  ExternalLink,
  Sun,
  Moon,
  Monitor,
  Sparkles,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { logout } from '@/lib/auth';

interface AppSettingsMenuProps {
  onOpenSettings: () => void;
  onOpenShortcuts: () => void;
  className?: string;
}

export function AppSettingsMenu({
  onOpenSettings,
  onOpenShortcuts,
  className,
}: AppSettingsMenuProps) {
  const user = useAuthStore((s) => s.user);
  const reset = useAuthStore((s) => s.reset);
  const { theme, setTheme } = useTheme();
  const zenMode = useSettingsStore((s) => s.zenMode);
  const setZenMode = useSettingsStore((s) => s.setZenMode);
  const handleSignOut = async () => {
    try {
      await logout();
      reset();
    } catch (error) {
      console.error('Failed to sign out:', error);
    }
  };

  const getThemeIcon = () => {
    switch (theme) {
      case 'light':
        return <Sun className="h-3.5 w-3.5" />;
      case 'dark':
        return <Moon className="h-3.5 w-3.5" />;
      default:
        return <Monitor className="h-3.5 w-3.5" />;
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn('h-7 w-7', className)}
        >
          <Settings className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        {/* User Profile Section */}
        {user && (
          <>
            <div className="flex items-center gap-3 px-2 py-2">
              {user.avatar_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={user.avatar_url}
                  alt={user.name || user.login}
                  className="h-8 w-8 rounded-full"
                />
              ) : (
                <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center">
                  <span className="text-xs font-medium">
                    {(user.name || user.login || '?')[0].toUpperCase()}
                  </span>
                </div>
              )}
              <div className="flex flex-col min-w-0">
                <span className="text-sm font-medium truncate">
                  {user.name || user.login}
                </span>
                <span className="text-xs text-muted-foreground truncate">
                  @{user.login}
                </span>
              </div>
            </div>
            <DropdownMenuSeparator />
          </>
        )}

        {/* Quick Toggles */}
        <DropdownMenuLabel className="text-2xs font-normal text-muted-foreground uppercase tracking-wider">
          Quick Settings
        </DropdownMenuLabel>

        {/* Theme Selector */}
        <div className="flex items-center justify-between px-2 py-1.5">
          <div className="flex items-center gap-2">
            {getThemeIcon()}
            <span className="text-sm">Theme</span>
          </div>
          <Select value={theme || 'system'} onValueChange={setTheme}>
            <SelectTrigger className="h-7 w-24 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="system">System</SelectItem>
              <SelectItem value="light">Light</SelectItem>
              <SelectItem value="dark">Dark</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Zen Mode Toggle */}
        <div className="flex items-center justify-between px-2 py-1.5">
          <div className="flex items-center gap-2">
            <Sparkles className="h-3.5 w-3.5" />
            <span className="text-sm">Zen Mode</span>
          </div>
          <Switch
            checked={zenMode}
            onCheckedChange={setZenMode}
            className="scale-90"
          />
        </div>

        <DropdownMenuSeparator />

        {/* Navigation Items */}
        <DropdownMenuItem onClick={onOpenShortcuts}>
          <Keyboard className="size-4" />
          Keyboard Shortcuts
          <span className="ml-auto text-xs text-muted-foreground">⌘/</span>
        </DropdownMenuItem>

        <DropdownMenuItem onClick={onOpenSettings}>
          <Settings className="size-4" />
          Settings
          <span className="ml-auto text-xs text-muted-foreground">⌘,</span>
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        {/* Updates & Help */}
        <DropdownMenuItem>
          <RefreshCw className="size-4" />
          Check for Updates
        </DropdownMenuItem>

        <DropdownMenuItem onClick={() => window.open('https://docs.chatml.dev', '_blank')}>
          <BookOpen className="size-4" />
          Documentation
          <ExternalLink className="h-3 w-3 ml-auto text-muted-foreground" />
        </DropdownMenuItem>

        <DropdownMenuItem onClick={() => window.open('https://chatml.dev/changelog', '_blank')}>
          <FileText className="size-4" />
          Changelog
          <ExternalLink className="h-3 w-3 ml-auto text-muted-foreground" />
        </DropdownMenuItem>

        <DropdownMenuItem onClick={() => window.open('https://github.com/chatml/chatml/issues', '_blank')}>
          <MessageCircle className="size-4" />
          Send Feedback
          <ExternalLink className="h-3 w-3 ml-auto text-muted-foreground" />
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        {/* Sign Out */}
        <DropdownMenuItem onClick={handleSignOut} className="text-destructive focus:text-destructive">
          <LogOut className="size-4" />
          Sign Out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
