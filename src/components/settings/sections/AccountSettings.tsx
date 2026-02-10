'use client';

import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { CheckCircle2, LogOut, Loader2 } from 'lucide-react';
import { useSettingsStore } from '@/stores/settingsStore';
import { useAuthStore } from '@/stores/authStore';
import { useLinearAuthStore } from '@/stores/linearAuthStore';
import { logout } from '@/lib/auth';
import { startLinearOAuthFlow, linearLogout, cancelLinearOAuthFlow } from '@/lib/linearAuth';

export function AccountSettings() {
  const user = useAuthStore((s) => s.user);
  const reset = useAuthStore((s) => s.reset);
  const strictPrivacy = useSettingsStore((s) => s.strictPrivacy);
  const setStrictPrivacy = useSettingsStore((s) => s.setStrictPrivacy);

  const linearUser = useLinearAuthStore((s) => s.user);
  const linearAuthenticated = useLinearAuthStore((s) => s.isAuthenticated);
  const linearOAuthState = useLinearAuthStore((s) => s.oauthState);
  const linearOAuthError = useLinearAuthStore((s) => s.oauthError);
  const startLinearOAuth = useLinearAuthStore((s) => s.startOAuth);
  const cancelLinearOAuth = useLinearAuthStore((s) => s.cancelOAuth);
  const resetLinearAuth = useLinearAuthStore((s) => s.reset);

  const handleSignOut = async () => {
    try {
      await logout();
      reset();
    } catch (error) {
      console.error('Failed to sign out:', error);
    }
  };

  const handleConnectLinear = async () => {
    try {
      startLinearOAuth();
      await startLinearOAuthFlow();
    } catch (error) {
      console.error('Failed to start Linear OAuth:', error);
      cancelLinearOAuth();
      cancelLinearOAuthFlow();
    }
  };

  const handleDisconnectLinear = async () => {
    try {
      await linearLogout();
      resetLinearAuth();
    } catch (error) {
      console.error('Failed to disconnect Linear:', error);
    }
  };

  return (
    <div>
      <h2 className="text-xl font-semibold mb-5">Account</h2>

      {/* User profile */}
      {user ? (
        <div className="flex items-center gap-4 pb-6 border-b border-border/50">
          {user.avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={user.avatar_url}
              alt={user.name || user.login}
              className="w-16 h-16 rounded-full"
            />
          ) : (
            <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center">
              <span className="text-lg font-medium">
                {(user.name || user.login || '?')[0].toUpperCase()}
              </span>
            </div>
          )}
          <div>
            <h3 className="text-lg font-semibold">{user.name || user.login}</h3>
            <div className="flex items-center gap-1.5 mt-1 text-sm text-muted-foreground">
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
              </svg>
              @{user.login}
            </div>
          </div>
        </div>
      ) : (
        <div className="pb-6 border-b border-border/50">
          <p className="text-sm text-muted-foreground">Not signed in</p>
        </div>
      )}

      {/* Linear Integration */}
      <div className="flex items-start justify-between py-6 border-b border-border/50">
        <div>
          <div className="flex items-center gap-2">
            <h4 className="text-sm font-medium">Linear Integration</h4>
            {linearAuthenticated && <CheckCircle2 className="w-4 h-4 text-text-success" />}
          </div>
          {linearOAuthState === 'pending' ? (
            <div className="flex items-center gap-2 mt-1">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Connecting...</p>
            </div>
          ) : linearAuthenticated && linearUser ? (
            <p className="text-sm text-muted-foreground mt-1">
              Connected as {linearUser.displayName || linearUser.name}
              {linearUser.email && ` (${linearUser.email})`}
            </p>
          ) : (
            <>
              <p className="text-sm text-muted-foreground mt-1">
                Connect Linear to import issues and track work.
              </p>
              {linearOAuthState === 'error' && linearOAuthError && (
                <p className="text-sm text-destructive mt-1">{linearOAuthError}</p>
              )}
            </>
          )}
        </div>
        {linearOAuthState === 'pending' ? (
          <Button variant="outline" size="sm" onClick={() => { cancelLinearOAuth(); cancelLinearOAuthFlow(); }}>
            Cancel
          </Button>
        ) : linearAuthenticated ? (
          <Button variant="outline" size="sm" onClick={handleDisconnectLinear}>
            Disconnect
          </Button>
        ) : (
          <Button variant="outline" size="sm" onClick={handleConnectLinear}>
            Connect
          </Button>
        )}
      </div>

      {/* GitHub CLI Integration */}
      <div className="py-6 border-b border-border/50">
        <div className="flex items-center gap-2">
          <h4 className="text-sm font-medium">GitHub CLI Integration</h4>
          {user && <CheckCircle2 className="w-4 h-4 text-text-success" />}
        </div>
        {user ? (
          <>
            <p className="text-sm text-muted-foreground mt-1">
              GitHub CLI is authenticated and ready.
            </p>
            <p className="text-sm text-muted-foreground">
              Signed in as @{user.login}
            </p>
          </>
        ) : (
          <p className="text-sm text-muted-foreground mt-1">
            Not connected. Sign in to enable GitHub integration.
          </p>
        )}
      </div>

      {/* Strict data privacy */}
      <div className="flex items-start justify-between py-6 border-b border-border/50">
        <div className="flex-1 pr-4">
          <h4 className="text-sm font-medium">Strict data privacy</h4>
          <p className="text-sm text-muted-foreground mt-1">
            Disable features requiring external AI providers, such as AI-generated chat titles.
          </p>
        </div>
        <div className="shrink-0 pt-1">
          <Switch
            checked={strictPrivacy}
            onCheckedChange={setStrictPrivacy}
          />
        </div>
      </div>

      {/* Replay Welcome Tour */}
      <div className="flex items-start justify-between py-6 border-b border-border/50">
        <div className="flex-1 pr-4">
          <h4 className="text-sm font-medium">Welcome tour</h4>
          <p className="text-sm text-muted-foreground mt-1">
            Replay the onboarding wizard and guided tour.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            useSettingsStore.getState().resetOnboarding();
            window.dispatchEvent(new CustomEvent('close-settings'));
          }}
        >
          Replay Tour
        </Button>
      </div>

      {/* Sign out */}
      <div className="flex items-center justify-between py-6">
        <h4 className="text-sm font-medium">Sign out</h4>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={handleSignOut}>
          <LogOut className="w-4 h-4" />
          Sign out
        </Button>
      </div>
    </div>
  );
}
