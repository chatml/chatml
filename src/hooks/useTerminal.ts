'use client';

import { useEffect, useRef, useCallback } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { spawn, type IPty } from 'tauri-pty';

// Platform detection with modern API fallback
function detectPlatform(): 'windows' | 'unix' {
  // Modern API (navigator.userAgentData)
  const uaData = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData;
  if (uaData?.platform?.toLowerCase().includes('win')) return 'windows';

  // Fallback to deprecated API
  if (navigator.platform.toLowerCase().includes('win')) return 'windows';

  return 'unix';
}

// Get shell fallback chain based on platform
function getShellFallbackChain(): string[] {
  if (detectPlatform() === 'windows') {
    return ['powershell.exe', 'pwsh.exe', 'cmd.exe'];
  }

  // Unix (macOS/Linux): /bin/zsh -> /bin/bash -> /bin/sh
  // Note: process.env.SHELL isn't available in browser/Tauri context,
  // so we rely on a fixed fallback chain starting with common defaults.
  return ['/bin/zsh', '/bin/bash', '/bin/sh'];
}

// Terminal theme matching the app's dark theme
const terminalTheme = {
  background: '#141414', // matches --background in dark mode
  foreground: '#4ade80', // green-400
  cursor: '#4ade80',
  cursorAccent: '#000000',
  selectionBackground: 'rgba(74, 222, 128, 0.3)',
  // Standard 16 ANSI colors
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

  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const searchAddonRef = useRef<SearchAddon | null>(null);
  const ptyRef = useRef<IPty | null>(null);
  const isInitializedRef = useRef(false);

  // Use refs to avoid effect reruns when props change
  const onExitRef = useRef(onExit);
  // eslint-disable-next-line react-hooks/refs -- intentional: keep ref in sync with latest callback
  onExitRef.current = onExit;

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
        theme: terminalTheme,
        fontFamily: '"MesloLGS NF", "MesloLGS Nerd Font", ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
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

        const shellChain = getShellFallbackChain();
        let lastError: unknown = null;

        for (const shell of shellChain) {
          if (cleanupCalled) return;

          try {
            const pty = await spawn(shell, [], {
              cols: terminal.cols || 80,
              rows: terminal.rows || 24,
              cwd: initialWorkspacePathRef.current || undefined,
            });

            if (cleanupCalled) {
              pty.kill();
              return;
            }

            ptyRef.current = pty;

            // PTY output -> Terminal
            pty.onData((data) => {
              if (!cleanupCalled) {
                terminal.write(data);
              }
            });

            // PTY exit event
            pty.onExit((event: { exitCode: number }) => {
              if (!cleanupCalled) {
                terminal.write('\r\n[Process exited]\r\n');
                onExitRef.current?.(event.exitCode);
              }
            });

            // Terminal input -> PTY
            terminal.onData((data: string) => {
              if (!cleanupCalled && ptyRef.current) {
                pty.write(data);
              }
            });

            // Handle terminal resize
            terminal.onResize(({ cols, rows }) => {
              if (!cleanupCalled && ptyRef.current) {
                pty.resize(cols, rows);
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
      // PTY might already be dead (user typed 'exit'), so wrap in try-catch
      try {
        ptyRef.current?.kill();
      } catch {
        // Ignore "No such process" errors - PTY already exited
      }
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

  // Fit terminal to container
  const fit = useCallback(() => {
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

  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const searchAddonRef = useRef<SearchAddon | null>(null);
  const isInitializedRef = useRef(false);

  // Initialize read-only terminal
  useEffect(() => {
    if (!containerRef.current || isInitializedRef.current) return;
    isInitializedRef.current = true;

    const terminal = new Terminal({
      theme: terminalTheme,
      fontFamily: '"MesloLGS NF", "MesloLGS Nerd Font", ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
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
