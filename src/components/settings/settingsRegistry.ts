export type SettingsCategory =
  | 'general'
  | 'appearance'
  | 'ai-models'
  | 'instructions'
  | 'git'
  | 'review'
  | 'actions'
  | 'account'
  | 'advanced'
  | 'about';

export type WorkspaceSettingsSection = 'repository' | 'review' | 'actions' | 'agents' | 'memory';

export type SettingsView =
  | { type: 'app'; category: SettingsCategory }
  | { type: 'workspace'; workspaceId: string; section: WorkspaceSettingsSection };

export interface SettingMeta {
  id: string;
  title: string;
  description: string;
  keywords: string[];
  category: SettingsCategory;
  categoryLabel: string;
}

export const SETTINGS_REGISTRY: SettingMeta[] = [
  // ── General: Input & Chat ──
  {
    id: 'sendWithEnter',
    title: 'Send messages with',
    description: 'Choose which key combination sends messages',
    keywords: ['enter', 'cmd', 'keyboard', 'send', 'message', 'shortcut', 'key'],
    category: 'general',
    categoryLabel: 'General',
  },
  {
    id: 'suggestionsEnabled',
    title: 'Input suggestions',
    description: 'Show AI-suggested prompts after each assistant turn',
    keywords: ['suggestions', 'prompts', 'ai', 'autocomplete'],
    category: 'general',
    categoryLabel: 'General',
  },
  {
    id: 'autoSubmitPillSuggestion',
    title: 'Auto-submit pill suggestions',
    description: 'Automatically send the message when clicking a suggestion pill',
    keywords: ['auto', 'submit', 'pill', 'suggestion', 'click'],
    category: 'general',
    categoryLabel: 'General',
  },
  {
    id: 'autoConvertLongText',
    title: 'Auto-convert long text',
    description: 'Convert pasted text over 5,000 characters into text attachments',
    keywords: ['paste', 'long', 'text', 'convert', 'attachment', 'characters'],
    category: 'general',
    categoryLabel: 'General',
  },

  // ── General: Editor ──
  {
    id: 'defaultOpenApp',
    title: 'Default editor',
    description: 'App used by the toolbar Open button',
    keywords: ['editor', 'vscode', 'cursor', 'open', 'app', 'ide'],
    category: 'general',
    categoryLabel: 'General',
  },

  // ── General: Notifications ──
  {
    id: 'desktopNotifications',
    title: 'Desktop notifications',
    description: 'Notify when an agent finishes working',
    keywords: ['notification', 'notify', 'alert', 'desktop', 'agent', 'done'],
    category: 'general',
    categoryLabel: 'General',
  },
  {
    id: 'soundEffects',
    title: 'Sound effects',
    description: 'Play a sound when an agent finishes working',
    keywords: ['sound', 'audio', 'chime', 'ding', 'pop', 'notification'],
    category: 'general',
    categoryLabel: 'General',
  },

  // ── General: Confirmations ──
  {
    id: 'confirmCloseActiveTab',
    title: 'Confirm before closing active conversations',
    description: 'Ask for confirmation when closing a conversation with messages',
    keywords: ['confirm', 'close', 'tab', 'conversation', 'dialog'],
    category: 'general',
    categoryLabel: 'General',
  },
  {
    id: 'confirmArchiveDirtySession',
    title: 'Confirm archive with uncommitted changes',
    description: 'Show a confirmation dialog when archiving a session that has uncommitted or unpushed changes',
    keywords: ['confirm', 'archive', 'uncommitted', 'changes', 'dirty', 'dialog'],
    category: 'general',
    categoryLabel: 'General',
  },

  // ── Appearance: Theme ──
  {
    id: 'theme',
    title: 'Color scheme',
    description: 'Choose your preferred color scheme',
    keywords: ['theme', 'dark', 'light', 'system', 'color', 'mode', 'appearance'],
    category: 'appearance',
    categoryLabel: 'Appearance',
  },

  // ── Appearance: Typography ──
  {
    id: 'fontSize',
    title: 'Font size',
    description: 'Adjust the interface font size',
    keywords: ['font', 'size', 'small', 'medium', 'large', 'text', 'zoom'],
    category: 'appearance',
    categoryLabel: 'Appearance',
  },

  // ── Appearance: Layout ──
  {
    id: 'zenMode',
    title: 'Zen mode',
    description: 'Hide sidebars for a distraction-free experience',
    keywords: ['zen', 'focus', 'distraction', 'sidebar', 'hide', 'layout', 'minimal'],
    category: 'appearance',
    categoryLabel: 'Appearance',
  },

  // ── Appearance: Display ──
  {
    id: 'showTokenUsage',
    title: 'Show token usage',
    description: 'Display token counts and cost breakdown in run summaries',
    keywords: ['token', 'usage', 'count', 'display', 'summary'],
    category: 'appearance',
    categoryLabel: 'Appearance',
  },
  {
    id: 'showChatCost',
    title: 'Show cost',
    description: 'Display cost in run summaries',
    keywords: ['cost', 'price', 'money', 'display', 'summary', 'billing'],
    category: 'appearance',
    categoryLabel: 'Appearance',
  },

  // ── AI & Models: Models ──
  {
    id: 'defaultModel',
    title: 'Default model',
    description: 'Model for new conversations',
    keywords: ['model', 'claude', 'opus', 'sonnet', 'haiku', 'default', 'ai'],
    category: 'ai-models',
    categoryLabel: 'AI & Models',
  },
  {
    id: 'reviewModel',
    title: 'Review model',
    description: 'Model for code reviews',
    keywords: ['model', 'review', 'claude', 'opus', 'sonnet', 'haiku', 'code'],
    category: 'ai-models',
    categoryLabel: 'AI & Models',
  },

  // ── AI & Models: Reasoning ──
  {
    id: 'defaultThinkingLevel',
    title: 'Default thinking',
    description: 'Controls reasoning depth for new conversations',
    keywords: ['thinking', 'reasoning', 'depth', 'extended', 'off', 'low', 'medium', 'high', 'max'],
    category: 'ai-models',
    categoryLabel: 'AI & Models',
  },
  {
    id: 'defaultPlanMode',
    title: 'Default to plan mode',
    description: 'Start new conversations in plan mode',
    keywords: ['plan', 'mode', 'default', 'conversation', 'planning'],
    category: 'ai-models',
    categoryLabel: 'AI & Models',
  },
  {
    id: 'maxThinkingTokens',
    title: 'Max thinking budget',
    description: 'Token budget cap for Sonnet & Haiku (Opus uses adaptive thinking)',
    keywords: ['thinking', 'budget', 'tokens', 'max', 'limit', 'cap'],
    category: 'ai-models',
    categoryLabel: 'AI & Models',
  },

  // ── AI & Models: Authentication ──
  {
    id: 'anthropicApiKey',
    title: 'Anthropic API Key',
    description: 'Set an API key to bypass OAuth authentication',
    keywords: ['api', 'key', 'anthropic', 'auth', 'token', 'oauth'],
    category: 'ai-models',
    categoryLabel: 'AI & Models',
  },

  // ── Instructions ──
  {
    id: 'customInstructions',
    title: 'Custom Instructions',
    description: 'Instructions included in the system prompt for every new conversation',
    keywords: ['instructions', 'system', 'prompt', 'rules', 'custom', 'behavior', 'coding', 'standards'],
    category: 'instructions',
    categoryLabel: 'Instructions',
  },

  // ── Git: Sync ──
  {
    id: 'branchSyncBanner',
    title: 'Branch sync notifications',
    description: 'Show a banner when your branch is behind the base branch',
    keywords: ['branch', 'sync', 'rebase', 'merge', 'banner', 'notification', 'behind'],
    category: 'git',
    categoryLabel: 'Git',
  },

  // ── Git: Branches ──
  {
    id: 'branchPrefixType',
    title: 'Branch name prefix',
    description: 'Prefix for new session branch names, followed by a slash',
    keywords: ['branch', 'prefix', 'name', 'git', 'github', 'username'],
    category: 'git',
    categoryLabel: 'Git',
  },

  // ── Git: Archiving ──
  {
    id: 'deleteBranchOnArchive',
    title: 'Delete branch on archive',
    description: 'Delete the local branch when archiving a session',
    keywords: ['delete', 'branch', 'archive', 'cleanup', 'git'],
    category: 'git',
    categoryLabel: 'Git',
  },
  {
    id: 'archiveOnMerge',
    title: 'Archive on merge',
    description: 'Automatically archive a session after merging its pull request',
    keywords: ['archive', 'merge', 'pr', 'pull request', 'auto'],
    category: 'git',
    categoryLabel: 'Git',
  },

  // ── Review & PRs ──
  {
    id: 'reviewPrompts',
    title: 'Review prompts',
    description: 'Custom instructions appended to each review type\'s default prompt',
    keywords: ['review', 'prompt', 'custom', 'instructions', 'quick', 'deep', 'security', 'performance', 'architecture'],
    category: 'review',
    categoryLabel: 'Review & PRs',
  },
  {
    id: 'reviewActionableOnly',
    title: 'Actionable feedback only',
    description: 'Only include actionable review comments (errors, warnings, suggestions). Hides informational and positive feedback.',
    keywords: ['review', 'feedback', 'actionable', 'info', 'informational', 'positive', 'noise', 'filter', 'severity'],
    category: 'review',
    categoryLabel: 'Review & PRs',
  },
  {
    id: 'prTemplate',
    title: 'PR Description Prompt',
    description: 'Custom instructions for AI-generated PR descriptions',
    keywords: ['pr', 'pull request', 'description', 'template', 'prompt'],
    category: 'review',
    categoryLabel: 'Review & PRs',
  },

  // ── Actions ──
  {
    id: 'actionTemplates',
    title: 'Action templates',
    description: 'Customize instructions sent to the agent for toolbar actions like merge, sync, and resolve conflicts',
    keywords: ['action', 'template', 'merge', 'sync', 'resolve', 'conflicts', 'fix', 'issues', 'instructions', 'primary', 'button'],
    category: 'actions',
    categoryLabel: 'Actions',
  },

  // ── Account: Integrations ──
  {
    id: 'linearIntegration',
    title: 'Linear',
    description: 'Connect Linear to import issues and track work',
    keywords: ['linear', 'integration', 'issues', 'connect', 'oauth'],
    category: 'account',
    categoryLabel: 'Account',
  },
  {
    id: 'githubCli',
    title: 'GitHub CLI',
    description: 'GitHub CLI authentication status',
    keywords: ['github', 'cli', 'auth', 'integration', 'connect'],
    category: 'account',
    categoryLabel: 'Account',
  },

  // ── Account: Privacy ──
  {
    id: 'strictPrivacy',
    title: 'Strict data privacy',
    description: 'Disable features requiring external AI providers',
    keywords: ['privacy', 'data', 'strict', 'external', 'ai', 'providers', 'disable'],
    category: 'account',
    categoryLabel: 'Account',
  },

  // ── Account: Onboarding ──
  {
    id: 'welcomeTour',
    title: 'Welcome tour',
    description: 'Replay the onboarding wizard and guided tour',
    keywords: ['welcome', 'tour', 'onboarding', 'wizard', 'replay', 'guide'],
    category: 'account',
    categoryLabel: 'Account',
  },

  // ── Advanced: Storage ──
  {
    id: 'workspacesBasePath',
    title: 'ChatML root directory',
    description: 'Where ChatML stores repositories and sessions',
    keywords: ['root', 'directory', 'path', 'storage', 'workspace', 'location', 'folder'],
    category: 'advanced',
    categoryLabel: 'Advanced',
  },

  // ── Advanced: Environment ──
  {
    id: 'envVars',
    title: 'Environment variables',
    description: 'Environment variables for third-party providers like Bedrock or Vertex',
    keywords: ['environment', 'variables', 'env', 'bedrock', 'vertex', 'provider', 'config'],
    category: 'advanced',
    categoryLabel: 'Advanced',
  },

  // ── Advanced: Security ──
  {
    id: 'neverLoadDotMcp',
    title: 'Block workspace MCP configs',
    description: 'Never auto-load .mcp.json from workspace repositories. Prevents repo-provided MCP servers from running commands.',
    keywords: ['mcp', 'trust', 'security', 'workspace', 'block', 'json', 'server', 'untrusted'],
    category: 'advanced',
    categoryLabel: 'Advanced',
  },

  // ── Advanced: Configuration ──
  {
    id: 'exportSettings',
    title: 'Export settings',
    description: 'Download your preferences as a JSON file',
    keywords: ['export', 'settings', 'backup', 'json', 'download', 'preferences'],
    category: 'advanced',
    categoryLabel: 'Advanced',
  },
  {
    id: 'importSettings',
    title: 'Import settings',
    description: 'Restore preferences from a previously exported JSON file',
    keywords: ['import', 'settings', 'restore', 'json', 'upload', 'preferences', 'backup'],
    category: 'advanced',
    categoryLabel: 'Advanced',
  },

  // ── Advanced: Maintenance ──
  {
    id: 'clearCache',
    title: 'Clear cache',
    description: 'Clear cached data and temporary files',
    keywords: ['clear', 'cache', 'temp', 'temporary', 'clean', 'reset'],
    category: 'advanced',
    categoryLabel: 'Advanced',
  },
  {
    id: 'resetAllSettings',
    title: 'Reset all settings',
    description: 'Restore all preferences to their default values',
    keywords: ['reset', 'default', 'restore', 'factory', 'settings', 'preferences'],
    category: 'advanced',
    categoryLabel: 'Advanced',
  },

  // ── About ──
  {
    id: 'version',
    title: 'Version',
    description: 'Check for updates',
    keywords: ['version', 'update', 'about', 'check'],
    category: 'about',
    categoryLabel: 'About',
  },
];

/**
 * Search settings by query string. Matches against title, description, and keywords.
 * Returns matching settings sorted by relevance.
 */
export function searchSettings(query: string): SettingMeta[] {
  const q = query.toLowerCase().trim();
  if (!q) return [];

  const terms = q.split(/\s+/);

  const scored = SETTINGS_REGISTRY.map((setting) => {
    const titleLower = setting.title.toLowerCase();
    const descLower = setting.description.toLowerCase();
    const keywordsJoined = setting.keywords.join(' ');

    let score = 0;

    for (const term of terms) {
      // Title scoring (mutually exclusive — best match wins)
      if (titleLower === term) score += 100;
      else if (titleLower.startsWith(term)) score += 50;
      else if (titleLower.includes(term)) score += 30;

      // Keyword scoring (mutually exclusive — best match wins)
      if (setting.keywords.some((kw) => kw === term)) score += 25;
      else if (keywordsJoined.includes(term)) score += 15;

      // Description scoring (always additive)
      if (descLower.includes(term)) score += 10;
    }

    return { setting, score };
  });

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((s) => s.setting);
}
