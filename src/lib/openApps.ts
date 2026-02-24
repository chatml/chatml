import { getPlatformKey, type PlatformKey } from './platform';

export type AppCategory = 'editor' | 'terminal' | 'file-manager';

export interface PlatformAppDef {
  /** Paths to check for app installation */
  paths: string[];
  /** CLI command name (if available in PATH) */
  cli?: string;
  /** Display name for the app (used in fallback app-open commands) */
  appName?: string;
}

export interface AppDefinition {
  id: string;
  name: string;
  category: AppCategory;
  platforms: Partial<Record<PlatformKey, PlatformAppDef>>;
}

export const APP_REGISTRY: AppDefinition[] = [
  // Editors
  {
    id: 'vscode',
    name: 'VS Code',
    category: 'editor',
    platforms: {
      darwin: {
        paths: ['/Applications/Visual Studio Code.app'],
        cli: 'code',
        appName: 'Visual Studio Code',
      },
      linux: {
        paths: ['/usr/bin/code', '/usr/share/code/code', '/snap/bin/code'],
        cli: 'code',
      },
      windows: {
        paths: ['C:\\Program Files\\Microsoft VS Code\\Code.exe'],
        cli: 'code',
      },
    },
  },
  {
    id: 'cursor',
    name: 'Cursor',
    category: 'editor',
    platforms: {
      darwin: {
        paths: ['/Applications/Cursor.app'],
        cli: 'cursor',
        appName: 'Cursor',
      },
      linux: {
        paths: ['/usr/bin/cursor', '/opt/Cursor/cursor'],
        cli: 'cursor',
      },
      windows: {
        paths: ['C:\\Program Files\\Cursor\\Cursor.exe'],
        cli: 'cursor',
      },
    },
  },
  {
    id: 'zed',
    name: 'Zed',
    category: 'editor',
    platforms: {
      darwin: {
        paths: ['/Applications/Zed.app'],
        cli: 'zed',
        appName: 'Zed',
      },
      linux: {
        paths: ['/usr/bin/zed', '/usr/local/bin/zed'],
        cli: 'zed',
      },
    },
  },
  {
    id: 'windsurf',
    name: 'Windsurf',
    category: 'editor',
    platforms: {
      darwin: {
        paths: ['/Applications/Windsurf.app'],
        cli: 'windsurf',
        appName: 'Windsurf',
      },
      linux: {
        paths: ['/usr/bin/windsurf'],
        cli: 'windsurf',
      },
      windows: {
        paths: ['C:\\Program Files\\Windsurf\\Windsurf.exe'],
        cli: 'windsurf',
      },
    },
  },
  {
    id: 'antigravity',
    name: 'Antigravity',
    category: 'editor',
    platforms: {
      darwin: {
        paths: ['/Applications/Antigravity.app'],
        appName: 'Antigravity',
      },
    },
  },
  {
    id: 'xcode',
    name: 'Xcode',
    category: 'editor',
    platforms: {
      darwin: {
        paths: ['/Applications/Xcode.app'],
        appName: 'Xcode',
      },
    },
  },
  {
    id: 'sublime',
    name: 'Sublime Text',
    category: 'editor',
    platforms: {
      darwin: {
        paths: ['/Applications/Sublime Text.app'],
        cli: 'subl',
        appName: 'Sublime Text',
      },
      linux: {
        paths: ['/usr/bin/subl', '/opt/sublime_text/sublime_text'],
        cli: 'subl',
      },
      windows: {
        paths: ['C:\\Program Files\\Sublime Text\\sublime_text.exe'],
        cli: 'subl',
      },
    },
  },
  // Terminals
  {
    id: 'terminal',
    name: 'Terminal',
    category: 'terminal',
    platforms: {
      darwin: {
        paths: ['/System/Applications/Utilities/Terminal.app'],
        appName: 'Terminal',
      },
      linux: {
        paths: ['/usr/bin/gnome-terminal', '/usr/bin/konsole', '/usr/bin/xfce4-terminal'],
      },
      windows: {
        paths: ['C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'],
        appName: 'PowerShell',
      },
    },
  },
  {
    id: 'iterm2',
    name: 'iTerm2',
    category: 'terminal',
    platforms: {
      darwin: {
        paths: ['/Applications/iTerm.app'],
        appName: 'iTerm',
      },
    },
  },
  {
    id: 'warp',
    name: 'Warp',
    category: 'terminal',
    platforms: {
      darwin: {
        paths: ['/Applications/Warp.app'],
        appName: 'Warp',
      },
    },
  },
  // File Managers
  {
    id: 'finder',
    name: 'Finder',
    category: 'file-manager',
    platforms: {
      darwin: {
        paths: ['/System/Library/CoreServices/Finder.app'],
        appName: 'Finder',
      },
    },
  },
  {
    id: 'explorer',
    name: 'File Explorer',
    category: 'file-manager',
    platforms: {
      windows: {
        paths: ['C:\\Windows\\explorer.exe'],
        appName: 'Explorer',
      },
    },
  },
  {
    id: 'nautilus',
    name: 'Files',
    category: 'file-manager',
    platforms: {
      linux: {
        paths: ['/usr/bin/nautilus', '/usr/bin/dolphin', '/usr/bin/thunar'],
      },
    },
  },
];

export const CATEGORY_LABELS: Record<AppCategory, string> = {
  'editor': 'Editors',
  'terminal': 'Terminals',
  'file-manager': 'File Managers',
};

export function getAppById(id: string): AppDefinition | undefined {
  return APP_REGISTRY.find((app) => app.id === id);
}

/**
 * Get the platform-specific definition for an app on the current platform.
 */
export function getAppPlatformDef(app: AppDefinition): PlatformAppDef | undefined {
  return app.platforms[getPlatformKey()];
}

/**
 * Get the display name for an app on the current platform.
 */
export function getAppName(app: AppDefinition): string | undefined {
  return getAppPlatformDef(app)?.appName;
}

/**
 * Build the (appId, paths[]) pairs to send to the Rust detection command.
 * Only includes apps that have definitions for the current platform.
 */
export function getDetectionPairs(): [string, string[]][] {
  const platform = getPlatformKey();
  return APP_REGISTRY
    .map((app) => {
      const def = app.platforms[platform];
      const paths = def?.paths ?? [];
      return [app.id, paths] as [string, string[]];
    })
    .filter(([, paths]) => paths.length > 0);
}
