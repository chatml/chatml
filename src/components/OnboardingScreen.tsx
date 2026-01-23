// src/components/OnboardingScreen.tsx
'use client';

import { Button } from '@/components/ui/button';
import { GlassCard } from '@/components/ui/glass-card';
import { Github, Loader2, X, RefreshCw } from 'lucide-react';
import { startOAuthFlow, cancelOAuthFlow } from '@/lib/auth';
import { useAuthStore } from '@/stores/authStore';

export function OnboardingScreen() {
  const {
    oauthState,
    oauthError,
    startOAuth,
    cancelOAuth,
    setAuthenticated,
  } = useAuthStore();

  const isConnecting = oauthState === 'pending';
  const hasError = oauthState === 'error';

  const handleSignIn = async () => {
    startOAuth();

    try {
      await startOAuthFlow();
      // OAuth callback will be handled by listener in page.tsx
    } catch (err) {
      // Only fail if we're still in pending state (not cancelled)
      if (useAuthStore.getState().oauthState === 'pending') {
        useAuthStore.getState().failOAuth(
          err instanceof Error ? err.message : 'Failed to start sign in'
        );
      }
    }
  };

  const handleCancel = () => {
    cancelOAuthFlow();
    cancelOAuth();
  };

  const handleRetry = () => {
    // Clear error and start fresh
    cancelOAuth();
    handleSignIn();
  };

  const handleSkip = () => {
    // Skip authentication for development - sets a placeholder user
    cancelOAuthFlow(); // Clear any pending state
    setAuthenticated(true, {
      login: 'local-dev',
      name: 'Local Developer',
      avatar_url: '',
    });
  };

  return (
    <div className="relative flex h-screen w-screen items-center justify-center bg-surface-0 overflow-hidden">
      {/* Gradient background (static for performance) */}
      <div className="absolute inset-0 overflow-hidden">
        {/* Large blur orbs */}
        <div
          className="absolute -top-1/4 -left-1/4 w-1/2 h-1/2 bg-primary/20 rounded-full blur-[120px]"
        />
        <div
          className="absolute -bottom-1/4 -right-1/4 w-1/2 h-1/2 bg-purple-500/15 rounded-full blur-[120px]"
        />
        <div
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-1/3 h-1/3 bg-ai-active/10 rounded-full blur-[100px]"
        />
      </div>

      {/* Content */}
      <GlassCard variant="elevated" hover="none" padding="lg" className="relative z-10 w-full max-w-md animate-scale-in">
        <div className="flex flex-col items-center space-y-8">
          {/* Logo with gradient and glow */}
          <div className="flex flex-col items-center space-y-4">
            <div className="relative">
              {/* Glow effect */}
              <div className="absolute inset-0 bg-gradient-to-br from-primary to-purple-500 rounded-2xl blur-xl opacity-50" />
              {/* Logo */}
              <div className="relative flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-purple-500 shadow-lg">
                <span className="font-display text-4xl font-bold text-white">C</span>
              </div>
            </div>
            <h1 className="font-display text-display-sm tracking-display">ChatML</h1>
          </div>

          {/* Tagline with display typography */}
          <p className="text-center text-lg text-muted-foreground tracking-tight">
            Enterprise AI Orchestration
          </p>

          {/* Action buttons */}
          <div className="flex flex-col items-center gap-3 w-full">
            {/* Error state: show error and retry button */}
            {hasError && (
              <div className="flex flex-col items-center gap-3 w-full animate-slide-up-fade">
                <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 px-4 py-2 rounded-lg">
                  <X className="h-4 w-4 shrink-0" />
                  <span>{oauthError}</span>
                </div>
                <Button
                  size="lg"
                  onClick={handleRetry}
                  className="h-12 px-8 text-base bg-gradient-to-r from-primary to-purple-500 hover:from-primary/90 hover:to-purple-500/90 shadow-lg shadow-primary/25 transition-all duration-200 active:scale-[0.98]"
                >
                  <RefreshCw className="mr-2 h-5 w-5" />
                  Try Again
                </Button>
              </div>
            )}

            {/* Pending state: show spinner and cancel button */}
            {isConnecting && (
              <div className="flex flex-col items-center gap-3 w-full">
                <Button
                  size="lg"
                  disabled
                  className="h-12 px-8 text-base bg-gradient-to-r from-primary to-purple-500 shadow-lg shadow-primary/25"
                >
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                  Waiting for GitHub...
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleCancel}
                  className="text-muted-foreground hover:text-foreground transition-colors"
                >
                  Cancel
                </Button>
                <p className="text-xs text-muted-foreground text-center">
                  Complete authorization in your browser, then return here.
                </p>
              </div>
            )}

            {/* Idle state: show sign in button */}
            {!isConnecting && !hasError && (
              <Button
                size="lg"
                onClick={handleSignIn}
                className="h-12 px-8 text-base bg-gradient-to-r from-primary to-purple-500 hover:from-primary/90 hover:to-purple-500/90 shadow-lg shadow-primary/25 transition-all duration-200 active:scale-[0.98]"
              >
                <Github className="mr-2 h-5 w-5" />
                Sign in with GitHub
              </Button>
            )}
          </div>

          {/* Skip button for development - only show when not connecting */}
          {!isConnecting && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleSkip}
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              Skip for now
            </Button>
          )}

          {/* Footer */}
          <p className="text-xs text-muted-foreground/70 text-center">
            By signing in, you agree to grant ChatML access to your repositories.
          </p>
        </div>
      </GlassCard>
    </div>
  );
}
