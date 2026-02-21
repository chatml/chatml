'use client';

import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { CheckCircle2, LogOut, Loader2 } from 'lucide-react';
import { useSettingsStore, SETTINGS_DEFAULTS } from '@/stores/settingsStore';
import { useAuthStore } from '@/stores/authStore';
import { useLinearAuthStore } from '@/stores/linearAuthStore';
import { logout } from '@/lib/auth';
import { startLinearOAuthFlow, linearLogout, cancelLinearOAuthFlow } from '@/lib/linearAuth';
import { SettingsRow } from '../shared/SettingsRow';
import { SettingsGroup } from '../shared/SettingsGroup';

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

      <SettingsGroup label="Profile">
        {/* User profile */}
        {user ? (
          <div className="flex items-center gap-4 py-3 border-b border-border/50">
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
          <div className="py-3 border-b border-border/50">
            <p className="text-sm text-muted-foreground">Not signed in</p>
          </div>
        )}

        <SettingsRow title="Sign out">
          <Button variant="outline" size="sm" className="gap-1.5" onClick={handleSignOut}>
            <LogOut className="w-4 h-4" />
            Sign out
          </Button>
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup label="Integrations">
        {/* Linear Integration */}
        <SettingsRow
          settingId="linearIntegration"
          title="Linear"
          description={
            linearOAuthState === 'pending'
              ? 'Connecting...'
              : linearAuthenticated && linearUser
                ? `Connected as ${linearUser.displayName || linearUser.name}${linearUser.email ? ` (${linearUser.email})` : ''}`
                : 'Connect Linear to import issues and track work.'
          }
          badge={linearAuthenticated ? <CheckCircle2 className="w-4 h-4 text-text-success" /> : undefined}
        >
          {linearOAuthState === 'pending' ? (
            <div className="flex items-center gap-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
              <Button variant="outline" size="sm" onClick={() => { cancelLinearOAuth(); cancelLinearOAuthFlow(); }}>
                Cancel
              </Button>
            </div>
          ) : linearAuthenticated ? (
            <Button variant="outline" size="sm" onClick={handleDisconnectLinear}>
              Disconnect
            </Button>
          ) : (
            <div>
              <Button variant="outline" size="sm" onClick={handleConnectLinear}>
                Connect
              </Button>
              {linearOAuthState === 'error' && linearOAuthError && (
                <p className="text-xs text-destructive mt-1">{linearOAuthError}</p>
              )}
            </div>
          )}
        </SettingsRow>

        {/* GitHub CLI Integration */}
        <SettingsRow
          settingId="githubCli"
          title="GitHub CLI"
          description={
            user
              ? `Authenticated as @${user.login}`
              : 'Not connected. Sign in to enable GitHub integration.'
          }
          badge={user ? <CheckCircle2 className="w-4 h-4 text-text-success" /> : undefined}
        >
          <span />
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup label="Privacy & Data">
        <SettingsRow
          settingId="strictPrivacy"
          title="Strict data privacy"
          description="Disable features requiring external AI providers, such as AI-generated chat titles."
          isModified={strictPrivacy !== SETTINGS_DEFAULTS.strictPrivacy}
          onReset={() => setStrictPrivacy(SETTINGS_DEFAULTS.strictPrivacy)}
        >
          <Switch
            checked={strictPrivacy}
            onCheckedChange={setStrictPrivacy}
            aria-label="Strict data privacy"
          />
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup label="Onboarding">
        <SettingsRow
          settingId="welcomeTour"
          title="Welcome tour"
          description="Replay the onboarding wizard and guided tour."
        >
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
        </SettingsRow>
      </SettingsGroup>
    </div>
  );
}
