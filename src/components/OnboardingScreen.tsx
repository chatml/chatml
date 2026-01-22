// src/components/OnboardingScreen.tsx
'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { GlassCard } from '@/components/ui/glass-card';
import { Github, Loader2 } from 'lucide-react';
import { startOAuthFlow } from '@/lib/auth';
import { useAuthStore } from '@/stores/authStore';

export function OnboardingScreen() {
  const [isConnecting, setIsConnecting] = useState(false);
  const { error, setError, setAuthenticated } = useAuthStore();

  const handleSignIn = async () => {
    setIsConnecting(true);
    setError(null);

    try {
      await startOAuthFlow();
      // OAuth callback will be handled by listener in page.tsx
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start sign in');
      setIsConnecting(false);
    }
  };

  const handleSkip = () => {
    // Skip authentication for development - sets a placeholder user
    setAuthenticated(true, {
      login: 'local-dev',
      name: 'Local Developer',
      avatar_url: '',
    });
  };

  return (
    <div className="relative flex h-screen w-screen items-center justify-center bg-surface-0 overflow-hidden">
      {/* Animated gradient background */}
      <div className="absolute inset-0 overflow-hidden">
        {/* Large blur orbs */}
        <div
          className="absolute -top-1/4 -left-1/4 w-1/2 h-1/2 bg-primary/20 rounded-full blur-[120px] animate-gradient-shift"
          style={{ backgroundSize: '200% 200%' }}
        />
        <div
          className="absolute -bottom-1/4 -right-1/4 w-1/2 h-1/2 bg-purple-500/15 rounded-full blur-[120px] animate-gradient-shift"
          style={{ backgroundSize: '200% 200%', animationDelay: '-1.5s' }}
        />
        <div
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-1/3 h-1/3 bg-ai-active/10 rounded-full blur-[100px] animate-gradient-shift"
          style={{ backgroundSize: '200% 200%', animationDelay: '-0.75s' }}
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

          {/* Sign in button with gradient */}
          <Button
            size="lg"
            onClick={handleSignIn}
            disabled={isConnecting}
            className="h-12 px-8 text-base bg-gradient-to-r from-primary to-purple-500 hover:from-primary/90 hover:to-purple-500/90 shadow-lg shadow-primary/25 transition-all duration-200 active:scale-[0.98]"
          >
            {isConnecting ? (
              <>
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                Connecting...
              </>
            ) : (
              <>
                <Github className="mr-2 h-5 w-5" />
                Sign in with GitHub
              </>
            )}
          </Button>

          {/* Skip button for development */}
          <Button
            variant="ghost"
            size="sm"
            onClick={handleSkip}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            Skip for now
          </Button>

          {/* Error message */}
          {error && (
            <p className="text-sm text-destructive animate-slide-up-fade">{error}</p>
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
