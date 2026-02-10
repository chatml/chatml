// src/components/OnboardingScreen.tsx
'use client';

import { useState } from 'react';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { Github, Loader2, X, RefreshCw, ClipboardPaste } from 'lucide-react';
import { startOAuthFlow, cancelOAuthFlow, handleOAuthCallback, storeToken } from '@/lib/auth';
import { useAuthStore } from '@/stores/authStore';

export function OnboardingScreen() {
  const {
    oauthState,
    oauthError,
    startOAuth,
    cancelOAuth,
    completeOAuth,
    failOAuth,
    setAuthenticated,
  } = useAuthStore();

  // Dev mode paste feature state
  const [showDevPaste, setShowDevPaste] = useState(false);
  const [devCallbackUrl, setDevCallbackUrl] = useState('');
  const [devProcessing, setDevProcessing] = useState(false);

  const isConnecting = oauthState === 'pending';
  const hasError = oauthState === 'error';
  const isDev = process.env.NODE_ENV === 'development';

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

  // Dev mode: manually process OAuth callback URL
  const handleDevPaste = async () => {
    if (!devCallbackUrl.trim()) return;
    setDevProcessing(true);
    try {
      const result = await handleOAuthCallback(devCallbackUrl.trim());
      await storeToken(result.token);
      completeOAuth();
      setAuthenticated(true, result.user);
    } catch (err) {
      failOAuth(err instanceof Error ? err.message : 'Failed to process callback');
    } finally {
      setDevProcessing(false);
      setDevCallbackUrl('');
      setShowDevPaste(false);
    }
  };

  return (
    <div className="relative flex h-screen w-screen items-center justify-center bg-background overflow-hidden">
      {/* Draggable region for window management */}
      <div data-tauri-drag-region className="absolute top-0 left-0 right-0 h-11 z-50" />

      {/* Subtle ambient glow behind mascot — very muted */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-[58%] w-[500px] h-[500px] rounded-full bg-primary/10 blur-[150px] pointer-events-none" />

      {/* Content */}
      <div className="relative z-10 flex flex-col items-center w-full max-w-sm animate-scale-in">
        {/* Mascot — circular with purple ring, matching website brand */}
        <div className="mb-8">
          <div className="w-32 h-32 rounded-full ring-[3px] ring-primary/50 ring-offset-4 ring-offset-background overflow-hidden shadow-2xl shadow-primary/20">
            <Image
              src="/mascot.png"
              alt="ChatML mascot"
              width={128}
              height={128}
              className="w-full h-full object-cover"
              priority
            />
          </div>
        </div>

        {/* Brand wordmark — monospace: gray "chat" + purple "ml" */}
        <h1 className="font-mono font-bold text-4xl tracking-[-0.05em]">
          <span className="text-foreground/60">chat</span><span className="text-primary">ml</span>
        </h1>

        {/* Tagline — matching website hero */}
        <div className="mt-10 flex flex-col items-center gap-1 text-center">
          <span className="text-4xl font-extrabold tracking-[-0.03em] leading-none text-foreground">
            Run Multiple
          </span>
          <span className="text-4xl font-extrabold tracking-[-0.03em] leading-none hero-gradient-text">
            Coding Agents
          </span>
          <span className="text-2xl font-extrabold tracking-[-0.03em] leading-none text-muted-foreground mt-1">
            that do the work for you
          </span>
        </div>

        {/* Action area */}
        <div className="mt-10 flex flex-col items-center gap-3 w-full">
          {/* Error state */}
          {hasError && (
            <div className="flex flex-col items-center gap-3 w-full animate-slide-up-fade">
              <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 px-4 py-2.5 rounded-lg border border-destructive/20">
                <X className="h-4 w-4 shrink-0" />
                <span>{oauthError}</span>
              </div>
              <Button
                size="lg"
                onClick={handleRetry}
                className="h-12 w-full text-lg bg-foreground text-background hover:bg-foreground/90 font-medium rounded-xl transition-colors"
              >
                <RefreshCw className="mr-2 h-4 w-4" />
                Try Again
              </Button>
            </div>
          )}

          {/* Pending state */}
          {isConnecting && (
            <div className="flex flex-col items-center gap-3 w-full">
              <Button
                size="lg"
                disabled
                className="h-12 w-full text-lg bg-foreground/10 text-muted-foreground border border-foreground/10 font-medium rounded-xl"
              >
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Waiting for GitHub...
              </Button>
              <button
                onClick={handleCancel}
                className="text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                Cancel
              </button>
              <p className="text-xs text-muted-foreground/70 text-center mt-1">
                Complete authorization in your browser, then return here.
              </p>

              {/* Dev mode: manual callback URL paste */}
              {isDev && (
                <div className="mt-4 w-full border-t border-border pt-4">
                  {!showDevPaste ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setShowDevPaste(true)}
                      className="w-full text-xs text-muted-foreground border-border hover:bg-accent"
                    >
                      <ClipboardPaste className="mr-2 h-3 w-3" />
                      Dev: Paste callback URL manually
                    </Button>
                  ) : (
                    <div className="flex flex-col gap-2">
                      <input
                        type="text"
                        value={devCallbackUrl}
                        onChange={(e) => setDevCallbackUrl(e.target.value)}
                        placeholder="chatml://oauth/callback?code=...&state=..."
                        className="w-full px-3 py-2 text-xs bg-muted/50 border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-ring/30 text-foreground placeholder:text-muted-foreground/50"
                        disabled={devProcessing}
                      />
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          onClick={handleDevPaste}
                          disabled={!devCallbackUrl.trim() || devProcessing}
                          className="flex-1 text-xs text-foreground bg-foreground/10 hover:bg-foreground/15"
                        >
                          {devProcessing ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            'Process'
                          )}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setShowDevPaste(false);
                            setDevCallbackUrl('');
                          }}
                          disabled={devProcessing}
                          className="text-xs text-muted-foreground hover:text-foreground"
                        >
                          Cancel
                        </Button>
                      </div>
                      <p className="text-2xs text-muted-foreground/70">
                        Deep links don&apos;t work in dev mode. Copy the redirect URL from your browser.
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Idle state: sign in button */}
          {!isConnecting && !hasError && (
            <Button
              size="lg"
              onClick={handleSignIn}
              className="h-12 w-full text-lg bg-foreground text-background hover:bg-foreground/90 font-medium rounded-xl transition-colors"
            >
              <Github className="mr-2 h-5 w-5" />
              Sign in with GitHub
            </Button>
          )}
        </div>

        {/* Footer */}
        <p className="mt-8 text-xs text-muted-foreground/50 text-center leading-relaxed">
          By signing in, you agree to grant ChatML<br />access to your repositories.
        </p>
      </div>
    </div>
  );
}
