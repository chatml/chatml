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
import { openUrlInBrowser } from '@/lib/tauri';
import { useUpdateStore } from '@/stores/updateStore';
import { useToast } from '@/components/ui/toast';

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
  const { info: toastInfo } = useToast();
  const handleSignOut = async () => {
    try {
      await logout();
      reset();
    } catch (error) {
      console.error('Failed to sign out:', error);
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
          <span className="text-sm">Theme</span>
          <div className="flex items-center gap-0.5 rounded-lg border bg-muted/50 p-0.5">
            {[
              { value: 'system', icon: Monitor },
              { value: 'light', icon: Sun },
              { value: 'dark', icon: Moon },
            ].map(({ value, icon: Icon }) => (
              <button
                key={value}
                onClick={() => setTheme(value)}
                aria-label={`${value} theme`}
                className={cn(
                  'rounded-md p-1.5 transition-colors',
                  (theme ?? 'system') === value
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <Icon className="h-3.5 w-3.5" />
              </button>
            ))}
          </div>
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
        <DropdownMenuItem onClick={async () => {
          const result = await useUpdateStore.getState().checkForUpdates();
          if (result === 'up-to-date') {
            toastInfo("You're on the latest version");
          }
        }}>
          <RefreshCw className="size-4" />
          Check for Updates
        </DropdownMenuItem>

        <DropdownMenuItem onClick={() => openUrlInBrowser('https://docs.chatml.com')}>
          <BookOpen className="size-4" />
          Documentation
          <ExternalLink className="h-3 w-3 ml-auto text-muted-foreground" />
        </DropdownMenuItem>

        <DropdownMenuItem onClick={() => openUrlInBrowser('https://chatml.com/changelog')}>
          <FileText className="size-4" />
          Changelog
          <ExternalLink className="h-3 w-3 ml-auto text-muted-foreground" />
        </DropdownMenuItem>

        <DropdownMenuItem onClick={() => openUrlInBrowser('https://github.com/chatml/chatml/issues')}>
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
