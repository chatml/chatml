export type AppCategory = 'editor' | 'terminal' | 'file-manager';

export interface AppDefinition {
  id: string;
  name: string;
  category: AppCategory;
  platforms: {
    darwin?: {
      bundlePaths: string[];
      cli?: string;
      appName?: string;
    };
  };
}

export const APP_REGISTRY: AppDefinition[] = [
  // Editors
  {
    id: 'vscode',
    name: 'VS Code',
    category: 'editor',
    platforms: {
      darwin: {
        bundlePaths: ['/Applications/Visual Studio Code.app'],
        cli: 'code',
        appName: 'Visual Studio Code',
      },
    },
  },
  {
    id: 'cursor',
    name: 'Cursor',
    category: 'editor',
    platforms: {
      darwin: {
        bundlePaths: ['/Applications/Cursor.app'],
        cli: 'cursor',
        appName: 'Cursor',
      },
    },
  },
  {
    id: 'zed',
    name: 'Zed',
    category: 'editor',
    platforms: {
      darwin: {
        bundlePaths: ['/Applications/Zed.app'],
        cli: 'zed',
        appName: 'Zed',
      },
    },
  },
  {
    id: 'windsurf',
    name: 'Windsurf',
    category: 'editor',
    platforms: {
      darwin: {
        bundlePaths: ['/Applications/Windsurf.app'],
        cli: 'windsurf',
        appName: 'Windsurf',
      },
    },
  },
  {
    id: 'antigravity',
    name: 'Antigravity',
    category: 'editor',
    platforms: {
      darwin: {
        bundlePaths: ['/Applications/Antigravity.app'],
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
        bundlePaths: ['/Applications/Xcode.app'],
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
        bundlePaths: ['/Applications/Sublime Text.app'],
        cli: 'subl',
        appName: 'Sublime Text',
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
        bundlePaths: ['/System/Applications/Utilities/Terminal.app'],
        appName: 'Terminal',
      },
    },
  },
  {
    id: 'iterm2',
    name: 'iTerm2',
    category: 'terminal',
    platforms: {
      darwin: {
        bundlePaths: ['/Applications/iTerm.app'],
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
        bundlePaths: ['/Applications/Warp.app'],
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
        bundlePaths: ['/System/Library/CoreServices/Finder.app'],
        appName: 'Finder',
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
 * Build the (appId, paths[]) pairs to send to the Rust detection command.
 */
export function getDetectionPairs(): [string, string[]][] {
  return APP_REGISTRY.map((app) => {
    const paths = app.platforms.darwin?.bundlePaths ?? [];
    return [app.id, paths];
  });
}
