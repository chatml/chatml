'use client';

import { useState, useEffect, useCallback } from 'react';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { CheckCircle2, LogOut, Loader2, Eye, EyeOff } from 'lucide-react';
import { useSettingsStore, SETTINGS_DEFAULTS } from '@/stores/settingsStore';
import { useAuthStore } from '@/stores/authStore';
import { useLinearAuthStore } from '@/stores/linearAuthStore';
import { logout } from '@/lib/auth';
import { startLinearOAuthFlow, linearLogout, cancelLinearOAuthFlow } from '@/lib/linearAuth';
import { checkGhAuthStatus, openUrlInBrowser, type GhCliStatus } from '@/lib/tauri';
import { getGitHubPersonalToken, setGitHubPersonalToken } from '@/lib/api';
import { useToast } from '@/components/ui/toast';
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
      useLinearAuthStore.getState().failOAuth(
        error instanceof Error ? error.message : 'Failed to connect'
      );
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

  // GitHub CLI status
  const [ghStatus, setGhStatus] = useState<GhCliStatus | null>(null);
  const [ghLoading, setGhLoading] = useState(true);
  const [ghError, setGhError] = useState(false);

  const recheckGhStatus = useCallback(async () => {
    setGhLoading(true);
    setGhError(false);
    try {
      const status = await checkGhAuthStatus();
      if (status === null) {
        setGhError(true);
      }
      setGhStatus(status);
    } finally {
      setGhLoading(false);
    }
  }, []);

  useEffect(() => {
    recheckGhStatus();
  }, [recheckGhStatus]);

  const ghDescription = ghLoading
    ? 'Checking...'
    : ghError
      ? 'Unable to check GitHub CLI status.'
      : !ghStatus?.installed
        ? 'GitHub CLI is not installed.'
        : ghStatus.authenticated && ghStatus.username
          ? `Authenticated as @${ghStatus.username}`
          : `Installed${ghStatus.version ? ` (v${ghStatus.version})` : ''} but not authenticated.`;

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
        {/* GitHub CLI Integration */}
        <SettingsRow
          settingId="githubCli"
          title="GitHub CLI"
          description={ghDescription}
          badge={
            ghLoading
              ? <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
              : ghStatus?.authenticated
                ? <CheckCircle2 className="w-4 h-4 text-text-success" />
                : undefined
          }
        >
          {ghLoading ? (
            <span />
          ) : ghError ? (
            <Button variant="ghost" size="sm" onClick={recheckGhStatus}>
              Re-check
            </Button>
          ) : !ghStatus?.installed ? (
            <Button variant="outline" size="sm" onClick={() => openUrlInBrowser('https://cli.github.com')}>
              Install
            </Button>
          ) : !ghStatus.authenticated ? (
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => openUrlInBrowser('https://cli.github.com/manual/gh_auth_login')}>
                How to authenticate
              </Button>
              <Button variant="ghost" size="sm" onClick={recheckGhStatus}>
                Re-check
              </Button>
            </div>
          ) : (
            <Button variant="ghost" size="sm" onClick={recheckGhStatus}>
              Re-check
            </Button>
          )}
        </SettingsRow>

        {/* GitHub Personal Access Token */}
        <GitHubPatSection />

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

function GitHubPatSection() {
  const [tokenInput, setTokenInput] = useState('');
  const [configured, setConfigured] = useState(false);
  const [maskedToken, setMaskedToken] = useState('');
  const [username, setUsername] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const toasts = useToast();

  useEffect(() => {
    let cancelled = false;
    getGitHubPersonalToken().then((data) => {
      if (cancelled) return;
      setConfigured(data.configured);
      setMaskedToken(data.maskedToken);
      setUsername(data.username);
    }).catch(() => {
      // ignore -- settings page should still render
    });
    return () => { cancelled = true; };
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      const result = await setGitHubPersonalToken(tokenInput);
      setConfigured(result.configured);
      setMaskedToken(result.maskedToken);
      setUsername(result.username);
      setTokenInput('');
      toasts.success('New sessions will use this token.', 'GitHub token saved');
    } catch (err) {
      // ApiError already extracts JSON error messages into err.message
      const msg = err instanceof Error ? err.message : 'Failed to save token';
      setError(msg);
      toasts.error(msg);
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async () => {
    setSaving(true);
    setError('');
    try {
      await setGitHubPersonalToken('');
      setConfigured(false);
      setMaskedToken('');
      setUsername('');
      toasts.success('GitHub token removed');
    } catch {
      toasts.error('Failed to remove token');
    } finally {
      setSaving(false);
    }
  };

  const description = configured && username
    ? `Authenticated as @${username}`
    : 'Optional. Used as GITHUB_TOKEN for agent operations.';

  return (
    <SettingsRow
      settingId="githubPersonalToken"
      variant="stacked"
      title="Personal access token"
      description={description}
      badge={configured ? <CheckCircle2 className="w-4 h-4 text-text-success" /> : undefined}
    >
      {configured && (
        <p className="text-xs text-muted-foreground mb-2">
          Current token: <code className="text-xs bg-muted px-1 py-0.5 rounded">{maskedToken}</code>
        </p>
      )}

      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-xs">
          <input
            type={showToken ? 'text' : 'password'}
            value={tokenInput}
            onChange={(e) => { setTokenInput(e.target.value); setError(''); }}
            placeholder={configured ? 'Enter new token to replace' : 'ghp_xxxxxxxxxxxx'}
            aria-label="GitHub Personal Access Token"
            className="w-full px-3 py-1.5 pr-8 text-sm bg-background border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <button
            type="button"
            onClick={() => setShowToken(!showToken)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            aria-label={showToken ? 'Hide token' : 'Show token'}
          >
            {showToken ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
          </button>
        </div>
        <Button
          size="sm"
          disabled={!tokenInput.trim() || saving}
          onClick={handleSave}
        >
          {saving ? 'Validating...' : 'Save'}
        </Button>
        {configured && (
          <Button
            size="sm"
            variant="outline"
            disabled={saving}
            onClick={handleRemove}
          >
            Remove
          </Button>
        )}
      </div>
      {error && (
        <p className="text-xs text-destructive mt-1">{error}</p>
      )}
    </SettingsRow>
  );
}
