// src/components/OnboardingScreen.tsx
'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
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
    <div className="flex h-screen w-screen items-center justify-center bg-background">
      <div className="flex flex-col items-center space-y-8 p-8">
        {/* Logo */}
        <div className="flex flex-col items-center space-y-4">
          <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-to-br from-purple-500 to-pink-500">
            <span className="text-4xl font-bold text-white">C</span>
          </div>
          <h1 className="text-3xl font-bold tracking-tight">ChatML</h1>
        </div>

        {/* Tagline */}
        <p className="text-center text-lg text-muted-foreground">
          Your AI coding companion
        </p>

        {/* Sign in button */}
        <Button
          size="lg"
          onClick={handleSignIn}
          disabled={isConnecting}
          className="h-12 px-8 text-base"
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
          className="text-muted-foreground"
        >
          Skip for now
        </Button>

        {/* Error message */}
        {error && (
          <p className="text-sm text-destructive">{error}</p>
        )}

        {/* Footer */}
        <p className="text-xs text-muted-foreground">
          By signing in, you agree to grant ChatML access to your repositories.
        </p>
      </div>
    </div>
  );
}
