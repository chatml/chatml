import { invoke } from '@tauri-apps/api/core';

/** Detect platform from `navigator.userAgentData` (modern) with `navigator.platform` fallback. */
export function detectPlatform(): 'windows' | 'unix' {
  const uaData = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData;
  if (uaData?.platform?.toLowerCase().includes('win')) return 'windows';
  if (navigator.platform.toLowerCase().includes('win')) return 'windows';
  return 'unix';
}

/**
 * Build a shell fallback chain (most-preferred first) for the current platform.
 * The user's `$SHELL` (queried via Tauri `get_user_shell`) is prepended when available.
 * Falls back to platform defaults if `invoke` fails (e.g. running outside Tauri).
 */
export async function getShellFallbackChain(): Promise<string[]> {
  const defaults =
    detectPlatform() === 'windows'
      ? ['powershell.exe', 'pwsh.exe', 'cmd.exe']
      : ['/bin/zsh', '/bin/bash', '/bin/sh'];

  try {
    const userShell = await invoke<string | null>('get_user_shell');
    if (userShell) {
      return [userShell, ...defaults.filter((s) => s !== userShell)];
    }
  } catch {
    // invoke failed — use defaults
  }

  return defaults;
}

/**
 * Spawn shells as login shells on macOS/Linux so they read profile files
 * (e.g. ~/.zprofile, ~/.bash_profile) which set up PATH, Homebrew, etc.
 * Mirrors Terminal.app / iTerm2 behavior.
 */
export function getShellArgs(): string[] {
  return detectPlatform() === 'windows' ? [] : ['-l'];
}

/** Terminal font stack — mirrors the --font-terminal CSS variable. */
export const TERMINAL_FONT_FAMILY =
  '"MesloLGS NF", "MesloLGS Nerd Font", ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace';

/** Dark terminal theme. */
export const darkTerminalTheme = {
  background: '#0f1111',
  foreground: '#4ade80',
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

/** Light terminal theme (GitHub-style ANSI palette). */
export const lightTerminalTheme = {
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

/** Pick the right theme by themeType. */
export function getTerminalTheme(themeType: 'dark' | 'light') {
  return themeType === 'dark' ? darkTerminalTheme : lightTerminalTheme;
}
