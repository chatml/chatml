'use client';

import { useEffect, useRef, useCallback } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { invoke } from '@tauri-apps/api/core';
import { spawnPty, startPtyReading, type PtyHandle } from '@/lib/pty';
import { useResolvedThemeType } from '@/hooks/useResolvedThemeType';

// Platform detection with modern API fallback
function detectPlatform(): 'windows' | 'unix' {
  // Modern API (navigator.userAgentData)
  const uaData = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData;
  if (uaData?.platform?.toLowerCase().includes('win')) return 'windows';

  // Fallback to deprecated API
  if (navigator.platform.toLowerCase().includes('win')) return 'windows';

  return 'unix';
}

// Get shell fallback chain based on platform, preferring the user's $SHELL
async function getShellFallbackChain(): Promise<string[]> {
  const defaults =
    detectPlatform() === 'windows'
      ? ['powershell.exe', 'pwsh.exe', 'cmd.exe']
      : ['/bin/zsh', '/bin/bash', '/bin/sh'];

  try {
    const userShell = await invoke<string | null>('get_user_shell');
    if (userShell) {
      return [userShell, ...defaults.filter(s => s !== userShell)];
    }
  } catch {
    // Invoke failed (e.g. running outside Tauri) — use defaults
  }

  return defaults;
}

// On macOS/Linux, spawn shells as login shells so they read profile files
// (e.g. ~/.zprofile, ~/.bash_profile) which set up PATH, Homebrew, etc.
// This matches the behavior of Terminal.app, iTerm2, and other macOS terminals.
function getShellArgs(): string[] {
  return detectPlatform() === 'windows' ? [] : ['-l'];
}

// Terminal font stack — mirrors the --font-terminal CSS variable
const TERMINAL_FONT_FAMILY =
  '"MesloLGS NF", "MesloLGS Nerd Font", ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace';

// Dark terminal theme
const darkTerminalTheme = {
  background: '#0f1111',
  foreground: '#4ade80', // green-400
  cursor: '#4ade80',
  cursorAccent: '#000000',
  selectionBackground: 'rgba(139, 92, 246, 0.3)',
  black: '#000000',
  red: '#ef4444',
  green: '#22c55e',
  yellow: '#eab308',
  blue: '#3b82f6',
  magenta: '#a855f7',
  cyan: '#06b6d4',
  white: '#f5f5f5',
  brightBlack: '#737373',
  brightRed: '#f87171',
  brightGreen: '#4ade80',
  brightYellow: '#facc15',
  brightBlue: '#60a5fa',
  brightMagenta: '#c084fc',
  brightCyan: '#22d3ee',
  brightWhite: '#ffffff',
};

// Light terminal theme (GitHub-style ANSI palette)
const lightTerminalTheme = {
  background: '#ffffff',
  foreground: '#1a1a1a',
  cursor: '#1a1a1a',
  cursorAccent: '#ffffff',
  selectionBackground: 'rgba(139, 92, 246, 0.2)',
  black: '#000000',
  red: '#d73a49',
  green: '#22863a',
  yellow: '#b08800',
  blue: '#005cc5',
  magenta: '#6f42c1',
  cyan: '#0598bc',
  white: '#d1d5db',
  brightBlack: '#6a737d',
  brightRed: '#cb2431',
  brightGreen: '#28a745',
  brightYellow: '#dbab09',
  brightBlue: '#2188ff',
  brightMagenta: '#8a63d2',
  brightCyan: '#3192aa',
  brightWhite: '#fafbfc',
};

function getTerminalTheme(themeType: 'dark' | 'light') {
  return themeType === 'dark' ? darkTerminalTheme : lightTerminalTheme;
}

export interface UseTerminalOptions {
  workspacePath?: string;
  onExit?: (code: number | null) => void;
}

export interface UseTerminalReturn {
  containerRef: React.RefObject<HTMLDivElement | null>;
  terminalRef: React.RefObject<Terminal | null>;
  fitAddon: React.RefObject<FitAddon | null>;
  searchAddon: React.RefObject<SearchAddon | null>;
  fit: () => void;
  search: (term: string) => boolean;
  searchNext: () => boolean;
  searchPrevious: () => boolean;
  clear: () => void;
  write: (data: string) => void;
}

export function useTerminal(options: UseTerminalOptions = {}): UseTerminalReturn {
  const { workspacePath, onExit } = options;
  const themeType = useResolvedThemeType();

  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const searchAddonRef = useRef<SearchAddon | null>(null);
  const ptyRef = useRef<PtyHandle | null>(null);
  const stopReadingRef = useRef<(() => void) | null>(null);
  const isInitializedRef = useRef(false);

  // Use refs to avoid effect reruns when props change
  const onExitRef = useRef(onExit);
  // eslint-disable-next-line react-hooks/refs -- intentional: keep ref in sync with latest callback
  onExitRef.current = onExit;

  const themeTypeRef = useRef(themeType);
  themeTypeRef.current = themeType;

  // Capture initial workspacePath - we don't want to reinit if it changes
  const initialWorkspacePathRef = useRef(workspacePath);

  // Initialize terminal and PTY using ResizeObserver to wait for dimensions
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let resizeObserver: ResizeObserver | null = null;
    let cleanupCalled = false;

    const initTerminal = () => {
      if (isInitializedRef.current || cleanupCalled) return;

      // Check dimensions
      if (container.offsetWidth === 0 || container.offsetHeight === 0) {
        return; // ResizeObserver will call us again when dimensions change
      }

      isInitializedRef.current = true;

      // Create xterm.js terminal
      const terminal = new Terminal({
        theme: getTerminalTheme(themeTypeRef.current),
        fontFamily: TERMINAL_FONT_FAMILY,
        fontSize: 11,
        lineHeight: 1.2,
        cursorBlink: true,
        cursorStyle: 'bar',
        allowTransparency: true,
        scrollback: 10000,
      });

      // Load addons
      const fitAddon = new FitAddon();
      const searchAddon = new SearchAddon();
      terminal.loadAddon(fitAddon);
      terminal.loadAddon(searchAddon);

      // Store refs
      terminalRef.current = terminal;
      fitAddonRef.current = fitAddon;
      searchAddonRef.current = searchAddon;

      // Open terminal in container
      terminal.open(container);

      // Handle Cmd+K to clear terminal (macOS standard)
      terminal.attachCustomKeyEventHandler((event) => {
        if (event.type === 'keydown' && event.key === 'k' && event.metaKey && !event.shiftKey && !event.altKey) {
          event.preventDefault();
          terminal.clear();
          return false;
        }
        return true;
      });

      // Initial fit after a brief delay to ensure DOM is ready
      requestAnimationFrame(() => {
        if (!cleanupCalled) {
          fitAddon.fit();
        }
      });

      // Spawn PTY with shell fallback chain
      const initPty = async () => {
        if (cleanupCalled) return;

        const shellChain = await getShellFallbackChain();
        const shellArgs = getShellArgs();
        let cwd = initialWorkspacePathRef.current || undefined;
        let lastError: unknown = null;

        // Validate CWD exists — if not, fall back to no CWD (inherits parent process CWD).
        // A non-existent CWD would cause ALL shell fallbacks to fail.
        if (cwd) {
          try {
            const meta = await invoke<{ isDirectory: boolean }>('read_file_metadata', { path: cwd });
            if (!meta.isDirectory) {
              console.warn(`[PTY] CWD "${cwd}" is not a directory, falling back`);
              cwd = undefined;
            }
          } catch {
            console.warn(`[PTY] CWD "${cwd}" does not exist or is inaccessible, falling back`);
            cwd = undefined;
          }
        }

        for (const shell of shellChain) {
          if (cleanupCalled) return;

          try {
            // spawnPty is truly async — rejects if spawn fails,
            // enabling the fallback chain to catch and try the next shell
            const pty = await spawnPty(shell, shellArgs, {
              cols: terminal.cols || 80,
              rows: terminal.rows || 24,
              cwd,
            });

            if (cleanupCalled) {
              pty.kill();
              return;
            }

            ptyRef.current = pty;

            // Start read + wait loops
            stopReadingRef.current = startPtyReading(pty, {
              onData: (data) => {
                if (!cleanupCalled) {
                  terminal.write(data);
                }
              },
              onExit: (exitCode) => {
                if (!cleanupCalled) {
                  terminal.write('\r\n[Process exited]\r\n');
                  onExitRef.current?.(exitCode);
                }
              },
            });

            // Terminal input -> PTY
            terminal.onData((data: string) => {
              if (!cleanupCalled && ptyRef.current) {
                pty.write(data).catch((e) => {
                  console.warn('PTY write error:', e);
                });
              }
            });

            // Handle terminal resize
            terminal.onResize(({ cols, rows }) => {
              if (!cleanupCalled && ptyRef.current) {
                pty.resize(cols, rows).catch((e) => {
                  console.warn('PTY resize error:', e);
                });
              }
            });

            return; // Success - exit loop
          } catch (err) {
            lastError = err;
            console.warn(`Failed to spawn shell "${shell}":`, err);
            // Continue to next shell in fallback chain
          }
        }

        // All shells failed
        console.error('All shell fallbacks failed:', lastError);
        if (!cleanupCalled) {
          terminal.write(`\r\nError: Failed to spawn terminal.\r\n`);
          terminal.write(`Tried: ${shellChain.join(', ')}\r\n`);
          if (lastError instanceof Error) {
            terminal.write(`Error: ${lastError.message}\r\n`);
          }
        }
      };

      initPty();
    };

    // Use ResizeObserver to detect when container has dimensions
    resizeObserver = new ResizeObserver(() => {
      if (!isInitializedRef.current) {
        initTerminal();
      }
    });
    resizeObserver.observe(container);

    // Try immediately in case container already has dimensions
    initTerminal();

    // Cleanup
    return () => {
      cleanupCalled = true;
      resizeObserver?.disconnect();
      // Stop the read loop first
      stopReadingRef.current?.();
      stopReadingRef.current = null;
      // PTY might already be dead (user typed 'exit'), so kill() handles that gracefully
      ptyRef.current?.kill();
      ptyRef.current = null;
      if (terminalRef.current) {
        terminalRef.current.dispose();
        terminalRef.current = null;
      }
      fitAddonRef.current = null;
      searchAddonRef.current = null;
      isInitializedRef.current = false;
    };
  }, []);

  // Sync terminal theme when app theme changes
  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.options.theme = getTerminalTheme(themeType);
    }
  }, [themeType]);

  // Fit terminal to container (skip when container has 0 dimensions to avoid resizing PTY to 0x0)
  const fit = useCallback(() => {
    const container = containerRef.current;
    if (!container || container.offsetWidth === 0 || container.offsetHeight === 0) return;
    if (fitAddonRef.current && terminalRef.current) {
      fitAddonRef.current.fit();
    }
  }, []);

  // Search functions
  const search = useCallback((term: string) => {
    return searchAddonRef.current?.findNext(term) ?? false;
  }, []);

  const searchNext = useCallback(() => {
    return searchAddonRef.current?.findNext('') ?? false;
  }, []);

  const searchPrevious = useCallback(() => {
    return searchAddonRef.current?.findPrevious('') ?? false;
  }, []);

  // Clear terminal
  const clear = useCallback(() => {
    terminalRef.current?.clear();
  }, []);

  // Write to terminal (for external use)
  const write = useCallback((data: string) => {
    terminalRef.current?.write(data);
  }, []);

  return {
    containerRef,
    terminalRef,
    fitAddon: fitAddonRef,
    searchAddon: searchAddonRef,
    fit,
    search,
    searchNext,
    searchPrevious,
    clear,
    write,
  };
}

// Read-only terminal hook (for Setup/Run output tabs)
export interface UseTerminalOutputOptions {
  initialContent?: string;
}

export function useTerminalOutput(options: UseTerminalOutputOptions = {}) {
  const { initialContent } = options;
  const themeType = useResolvedThemeType();

  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const searchAddonRef = useRef<SearchAddon | null>(null);
  const isInitializedRef = useRef(false);

  const themeTypeRef = useRef(themeType);
  themeTypeRef.current = themeType;

  // Initialize read-only terminal
  useEffect(() => {
    if (!containerRef.current || isInitializedRef.current) return;
    isInitializedRef.current = true;

    const terminal = new Terminal({
      theme: getTerminalTheme(themeTypeRef.current),
      fontFamily: TERMINAL_FONT_FAMILY,
      fontSize: 11,
      lineHeight: 1.2,
      cursorBlink: false,
      cursorStyle: 'bar',
      allowTransparency: true,
      scrollback: 10000,
      disableStdin: true, // Read-only
    });

    const fitAddon = new FitAddon();
    const searchAddon = new SearchAddon();
    terminal.loadAddon(fitAddon);
    terminal.loadAddon(searchAddon);

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;
    searchAddonRef.current = searchAddon;

    terminal.open(containerRef.current);

    setTimeout(() => {
      fitAddon.fit();
      if (initialContent) {
        terminal.write(initialContent);
      }
    }, 0);

    return () => {
      terminal.dispose();
      isInitializedRef.current = false;
    };
  }, [initialContent]);

  // Sync terminal theme when app theme changes
  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.options.theme = getTerminalTheme(themeType);
    }
  }, [themeType]);

  const fit = useCallback(() => {
    fitAddonRef.current?.fit();
  }, []);

  const write = useCallback((data: string) => {
    terminalRef.current?.write(data);
  }, []);

  const clear = useCallback(() => {
    terminalRef.current?.clear();
  }, []);

  return {
    containerRef,
    terminalRef,
    fitAddon: fitAddonRef,
    searchAddon: searchAddonRef,
    fit,
    write,
    clear,
  };
}
