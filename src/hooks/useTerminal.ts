'use client';

import { useEffect, useRef, useCallback } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { spawn, type IPty } from 'tauri-pty';

// Terminal theme matching the app's dark theme
const terminalTheme = {
  background: 'rgba(0, 0, 0, 0.9)',
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

  // Initialize terminal and PTY
  useEffect(() => {
    if (!containerRef.current || isInitializedRef.current) return;
    isInitializedRef.current = true;

    // Create xterm.js terminal
    const terminal = new Terminal({
      theme: terminalTheme,
      fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
      fontSize: 13,
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
    terminal.open(containerRef.current);

    // Initial fit
    setTimeout(() => {
      fitAddon.fit();
    }, 0);

    // Determine shell based on platform
    const isWindows = navigator.platform.toLowerCase().includes('win');
    const shell = isWindows ? 'powershell.exe' : process.env.SHELL || '/bin/zsh';

    // Spawn PTY
    const initPty = async () => {
      try {
        const pty = await spawn(shell, [], {
          cols: terminal.cols,
          rows: terminal.rows,
          cwd: workspacePath || undefined,
        });

        ptyRef.current = pty;

        // PTY output -> Terminal
        pty.onData((data: string) => {
          terminal.write(data);
        });

        // PTY exit event
        pty.onExit((event: { exitCode: number }) => {
          terminal.write('\r\n[Process exited]\r\n');
          onExit?.(event.exitCode);
        });

        // Terminal input -> PTY
        terminal.onData((data: string) => {
          pty.write(data);
        });

        // Handle terminal resize
        terminal.onResize(({ cols, rows }) => {
          pty.resize(cols, rows);
        });
      } catch (err) {
        console.error('Failed to spawn PTY:', err);
        terminal.write(`\r\nError: Failed to spawn terminal: ${err}\r\n`);
      }
    };

    initPty();

    // Cleanup
    return () => {
      ptyRef.current?.kill();
      terminal.dispose();
      isInitializedRef.current = false;
    };
  }, [workspacePath, onExit]);

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
      fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
      fontSize: 13,
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
