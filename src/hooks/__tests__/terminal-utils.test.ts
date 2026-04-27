import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  detectPlatform,
  getShellFallbackChain,
  getShellArgs,
  getTerminalTheme,
  darkTerminalTheme,
  lightTerminalTheme,
  TERMINAL_FONT_FAMILY,
} from '../terminal-utils';

// Mock Tauri's invoke — terminal utils use it to query the user's $SHELL.
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

import { invoke } from '@tauri-apps/api/core';
const mockedInvoke = vi.mocked(invoke);

describe('detectPlatform', () => {
  let originalUserAgentData: unknown;
  let originalPlatform: string;

  beforeEach(() => {
    originalUserAgentData = (navigator as Navigator & {
      userAgentData?: { platform?: string };
    }).userAgentData;
    originalPlatform = navigator.platform;
  });

  afterEach(() => {
    Object.defineProperty(navigator, 'userAgentData', {
      value: originalUserAgentData,
      configurable: true,
    });
    Object.defineProperty(navigator, 'platform', {
      value: originalPlatform,
      configurable: true,
    });
  });

  it("returns 'windows' when userAgentData reports a Windows platform", () => {
    Object.defineProperty(navigator, 'userAgentData', {
      value: { platform: 'Windows' },
      configurable: true,
    });
    expect(detectPlatform()).toBe('windows');
  });

  it('falls back to navigator.platform when userAgentData is unavailable', () => {
    Object.defineProperty(navigator, 'userAgentData', {
      value: undefined,
      configurable: true,
    });
    Object.defineProperty(navigator, 'platform', {
      value: 'Win32',
      configurable: true,
    });
    expect(detectPlatform()).toBe('windows');
  });

  it("returns 'unix' for non-Windows platforms (default in jsdom)", () => {
    Object.defineProperty(navigator, 'userAgentData', {
      value: { platform: 'macOS' },
      configurable: true,
    });
    expect(detectPlatform()).toBe('unix');
  });

  it("returns 'unix' when userAgentData.platform is empty", () => {
    Object.defineProperty(navigator, 'userAgentData', {
      value: { platform: '' },
      configurable: true,
    });
    Object.defineProperty(navigator, 'platform', {
      value: 'Linux x86_64',
      configurable: true,
    });
    expect(detectPlatform()).toBe('unix');
  });
});

describe('getShellArgs', () => {
  let originalPlatform: string;

  beforeEach(() => {
    originalPlatform = navigator.platform;
    Object.defineProperty(navigator, 'userAgentData', {
      value: undefined,
      configurable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(navigator, 'platform', {
      value: originalPlatform,
      configurable: true,
    });
  });

  it('returns ["-l"] (login shell) on unix', () => {
    Object.defineProperty(navigator, 'platform', {
      value: 'MacIntel',
      configurable: true,
    });
    expect(getShellArgs()).toEqual(['-l']);
  });

  it('returns [] on windows', () => {
    Object.defineProperty(navigator, 'platform', {
      value: 'Win32',
      configurable: true,
    });
    expect(getShellArgs()).toEqual([]);
  });
});

describe('getShellFallbackChain', () => {
  let originalPlatform: string;

  beforeEach(() => {
    originalPlatform = navigator.platform;
    Object.defineProperty(navigator, 'userAgentData', {
      value: undefined,
      configurable: true,
    });
    mockedInvoke.mockReset();
  });

  afterEach(() => {
    Object.defineProperty(navigator, 'platform', {
      value: originalPlatform,
      configurable: true,
    });
  });

  it("returns unix defaults when not in Tauri (invoke fails) on unix", async () => {
    Object.defineProperty(navigator, 'platform', {
      value: 'MacIntel',
      configurable: true,
    });
    mockedInvoke.mockRejectedValueOnce(new Error('not in Tauri'));

    const chain = await getShellFallbackChain();
    expect(chain).toEqual(['/bin/zsh', '/bin/bash', '/bin/sh']);
  });

  it("returns windows defaults when not in Tauri on windows", async () => {
    Object.defineProperty(navigator, 'platform', {
      value: 'Win32',
      configurable: true,
    });
    mockedInvoke.mockRejectedValueOnce(new Error('not in Tauri'));

    const chain = await getShellFallbackChain();
    expect(chain).toEqual(['powershell.exe', 'pwsh.exe', 'cmd.exe']);
  });

  it("prepends user's $SHELL when invoke succeeds (and dedupes)", async () => {
    Object.defineProperty(navigator, 'platform', {
      value: 'MacIntel',
      configurable: true,
    });
    mockedInvoke.mockResolvedValueOnce('/bin/zsh');

    const chain = await getShellFallbackChain();
    // Dedupes: zsh appears at the front, removed from defaults
    expect(chain[0]).toBe('/bin/zsh');
    expect(chain.filter((s) => s === '/bin/zsh')).toHaveLength(1);
    expect(chain).toContain('/bin/bash');
    expect(chain).toContain('/bin/sh');
  });

  it("prepends a non-default user shell (e.g. /usr/local/bin/fish)", async () => {
    Object.defineProperty(navigator, 'platform', {
      value: 'MacIntel',
      configurable: true,
    });
    mockedInvoke.mockResolvedValueOnce('/usr/local/bin/fish');

    const chain = await getShellFallbackChain();
    expect(chain).toEqual([
      '/usr/local/bin/fish',
      '/bin/zsh',
      '/bin/bash',
      '/bin/sh',
    ]);
  });

  it('falls back to defaults when invoke returns null', async () => {
    Object.defineProperty(navigator, 'platform', {
      value: 'MacIntel',
      configurable: true,
    });
    mockedInvoke.mockResolvedValueOnce(null);

    const chain = await getShellFallbackChain();
    expect(chain).toEqual(['/bin/zsh', '/bin/bash', '/bin/sh']);
  });
});

describe('getTerminalTheme', () => {
  it('returns dark theme for "dark"', () => {
    expect(getTerminalTheme('dark')).toBe(darkTerminalTheme);
  });

  it('returns light theme for "light"', () => {
    expect(getTerminalTheme('light')).toBe(lightTerminalTheme);
  });

  it('dark theme has the project background and green-400 foreground', () => {
    expect(darkTerminalTheme.background).toBe('#0f1111');
    expect(darkTerminalTheme.foreground).toBe('#4ade80');
  });

  it('light theme has white background and dark foreground', () => {
    expect(lightTerminalTheme.background).toBe('#ffffff');
    expect(lightTerminalTheme.foreground).toBe('#1a1a1a');
  });

  it('both themes share the same shape (key set)', () => {
    expect(Object.keys(darkTerminalTheme).sort()).toEqual(
      Object.keys(lightTerminalTheme).sort()
    );
  });
});

describe('TERMINAL_FONT_FAMILY', () => {
  it('starts with the MesloLGS Nerd Font and falls back to monospace', () => {
    expect(TERMINAL_FONT_FAMILY).toMatch(/^"MesloLGS NF"/);
    expect(TERMINAL_FONT_FAMILY).toMatch(/monospace$/);
  });
});
