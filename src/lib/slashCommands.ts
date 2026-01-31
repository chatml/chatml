import type { LucideIcon } from 'lucide-react';
import {
  GitCommit,
  GitPullRequest,
  RefreshCw,
  Search,
  FileCode,
  Shield,
  BookOpen,
  Brain,
  HelpCircle,
  Wrench,
  TestTube,
  Code,
  MessageSquareText,
} from 'lucide-react';
// ============================================================================
// Types
// ============================================================================

export type SlashCommandCategory = 'Agent' | 'Git' | 'Review' | 'Mode';
export type SlashCommandExecutionType = 'insert' | 'action';

export interface SlashCommandAvailability {
  hasSession: boolean;
}

export interface SlashCommandContext {
  setMessage: (msg: string) => void;
  conversationId: string | null;
  sessionId: string | null;
}

export interface SlashCommand {
  id: string;
  trigger: string;
  label: string;
  description: string;
  icon: LucideIcon;
  category: SlashCommandCategory;
  keywords?: string[];
  executionType: SlashCommandExecutionType;
  available?: (ctx: SlashCommandAvailability) => boolean;
  execute: (ctx: SlashCommandContext) => void;
}

// ============================================================================
// Command Registry
// ============================================================================

const requiresSession = (ctx: SlashCommandAvailability) => ctx.hasSession;

export const SLASH_COMMANDS: SlashCommand[] = [
  // Agent commands (insert prompt prefixes)
  {
    id: 'help',
    trigger: 'help',
    label: 'Help',
    description: 'Ask what the agent can help with',
    icon: HelpCircle,
    category: 'Agent',
    keywords: ['info', 'commands', 'what'],
    executionType: 'insert',
    execute: (ctx) => ctx.setMessage('What can you help me with? Show me your capabilities.'),
  },
  {
    id: 'fix',
    trigger: 'fix',
    label: 'Fix Issue',
    description: 'Fix a bug or issue in the code',
    icon: Wrench,
    category: 'Agent',
    keywords: ['bug', 'error', 'debug', 'broken'],
    executionType: 'insert',
    execute: (ctx) => ctx.setMessage('Fix '),
  },
  {
    id: 'test',
    trigger: 'test',
    label: 'Write Tests',
    description: 'Generate tests for your code',
    icon: TestTube,
    category: 'Agent',
    keywords: ['unit', 'integration', 'coverage', 'spec'],
    executionType: 'insert',
    execute: (ctx) => ctx.setMessage('Write tests for '),
  },
  {
    id: 'refactor',
    trigger: 'refactor',
    label: 'Refactor Code',
    description: 'Refactor and improve code quality',
    icon: Code,
    category: 'Agent',
    keywords: ['clean', 'improve', 'simplify', 'restructure'],
    executionType: 'insert',
    execute: (ctx) => ctx.setMessage('Refactor '),
  },
  {
    id: 'explain',
    trigger: 'explain',
    label: 'Explain Code',
    description: 'Get an explanation of how code works',
    icon: MessageSquareText,
    category: 'Agent',
    keywords: ['understand', 'describe', 'what', 'how'],
    executionType: 'insert',
    execute: (ctx) => ctx.setMessage('Explain '),
  },

  // Git commands (fire actions)
  {
    id: 'commit',
    trigger: 'commit',
    label: 'Commit Changes',
    description: 'Stage and commit current changes',
    icon: GitCommit,
    category: 'Git',
    keywords: ['save', 'stage', 'git'],
    executionType: 'action',
    available: requiresSession,
    execute: () => window.dispatchEvent(new CustomEvent('git-commit')),
  },
  {
    id: 'pr',
    trigger: 'pr',
    label: 'Create Pull Request',
    description: 'Create a PR from current branch',
    icon: GitPullRequest,
    category: 'Git',
    keywords: ['pull request', 'merge', 'review', 'github'],
    executionType: 'action',
    available: requiresSession,
    execute: () => window.dispatchEvent(new CustomEvent('git-create-pr')),
  },
  {
    id: 'sync',
    trigger: 'sync',
    label: 'Sync with Main',
    description: 'Pull and rebase from main branch',
    icon: RefreshCw,
    category: 'Git',
    keywords: ['pull', 'rebase', 'update', 'git'],
    executionType: 'action',
    available: requiresSession,
    execute: () => window.dispatchEvent(new CustomEvent('git-sync')),
  },

  // Review commands (fire actions)
  {
    id: 'review',
    trigger: 'review',
    label: 'Quick Review',
    description: 'Run a quick code review on changes',
    icon: Search,
    category: 'Review',
    keywords: ['fast', 'basic', 'check'],
    executionType: 'action',
    available: requiresSession,
    execute: () => window.dispatchEvent(new CustomEvent('start-review', { detail: { type: 'quick' } })),
  },
  {
    id: 'deep-review',
    trigger: 'deep-review',
    label: 'Deep Review',
    description: 'Run a thorough code review',
    icon: FileCode,
    category: 'Review',
    keywords: ['thorough', 'comprehensive', 'detailed'],
    executionType: 'action',
    available: requiresSession,
    execute: () => window.dispatchEvent(new CustomEvent('start-review', { detail: { type: 'deep' } })),
  },
  {
    id: 'security',
    trigger: 'security',
    label: 'Security Audit',
    description: 'Scan for security vulnerabilities',
    icon: Shield,
    category: 'Review',
    keywords: ['vulnerability', 'audit', 'safe'],
    executionType: 'action',
    available: requiresSession,
    execute: () => window.dispatchEvent(new CustomEvent('start-review', { detail: { type: 'security' } })),
  },

  // Mode toggles (fire actions)
  {
    id: 'plan',
    trigger: 'plan',
    label: 'Toggle Plan Mode',
    description: 'Plan before implementing changes',
    icon: BookOpen,
    category: 'Mode',
    keywords: ['planning', 'architect', 'design'],
    executionType: 'action',
    execute: () => window.dispatchEvent(new CustomEvent('toggle-plan-mode')),
  },
  {
    id: 'think',
    trigger: 'think',
    label: 'Toggle Thinking',
    description: 'Enable extended thinking mode',
    icon: Brain,
    category: 'Mode',
    keywords: ['reasoning', 'deep', 'extended'],
    executionType: 'action',
    execute: () => window.dispatchEvent(new CustomEvent('toggle-thinking')),
  },
];

// ============================================================================
// Filtering
// ============================================================================

export function getAvailableSlashCommands(availability: SlashCommandAvailability): SlashCommand[] {
  return SLASH_COMMANDS.filter((cmd) => cmd.available?.(availability) ?? true);
}

export function filterSlashCommands(commands: SlashCommand[], query: string): SlashCommand[] {
  if (!query) return commands;

  const lowerQuery = query.toLowerCase();

  return commands.filter((cmd) => {
    if (cmd.trigger.toLowerCase().includes(lowerQuery)) return true;
    if (cmd.label.toLowerCase().includes(lowerQuery)) return true;
    if (cmd.description.toLowerCase().includes(lowerQuery)) return true;
    if (cmd.keywords?.some((kw) => kw.toLowerCase().includes(lowerQuery))) return true;
    return false;
  });
}
