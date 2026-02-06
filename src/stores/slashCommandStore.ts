import { create } from 'zustand';
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
  Sparkles,
  FileText,
} from 'lucide-react';
import type { SkillDTO, UserCommandDTO } from '@/lib/api';

// ============================================================================
// Types
// ============================================================================

export type SlashCommandSource = 'builtin' | 'skill' | 'user';
export type SlashCommandExecutionType = 'action' | 'prompt' | 'skill';

export interface SlashCommandAvailability {
  hasSession: boolean;
}

export interface SlashCommandContext {
  setMessage: (msg: string) => void;
  sendMessage: (msg: string) => void;
  conversationId: string | null;
  sessionId: string | null;
}

export interface UnifiedSlashCommand {
  id: string;
  trigger: string;
  label: string;
  description: string;
  keywords?: string[];
  icon: LucideIcon;
  source: SlashCommandSource;
  executionType: SlashCommandExecutionType;
  available?: (ctx: SlashCommandAvailability) => boolean;
  execute: (ctx: SlashCommandContext) => void;
}

export interface UserCommandFile {
  name: string;
  description: string;
  filePath: string;
  content: string;
}

// ============================================================================
// Built-in Commands
// ============================================================================

const requiresSession = (ctx: SlashCommandAvailability) => ctx.hasSession;

const BUILTIN_COMMANDS: UnifiedSlashCommand[] = [
  // Agent commands (insert prompt prefixes)
  {
    id: 'builtin:help',
    trigger: 'help',
    label: 'Help',
    description: 'Ask what the agent can help with',
    keywords: ['info', 'commands', 'what'],
    icon: HelpCircle,
    source: 'builtin',
    executionType: 'prompt',
    execute: (ctx) => ctx.setMessage('What can you help me with? Show me your capabilities.'),
  },
  {
    id: 'builtin:fix',
    trigger: 'fix',
    label: 'Fix Issue',
    description: 'Fix a bug or issue in the code',
    keywords: ['bug', 'error', 'debug', 'broken'],
    icon: Wrench,
    source: 'builtin',
    executionType: 'prompt',
    execute: (ctx) => ctx.setMessage('Fix '),
  },
  {
    id: 'builtin:test',
    trigger: 'test',
    label: 'Write Tests',
    description: 'Generate tests for your code',
    keywords: ['unit', 'integration', 'coverage', 'spec'],
    icon: TestTube,
    source: 'builtin',
    executionType: 'prompt',
    execute: (ctx) => ctx.setMessage('Write tests for '),
  },
  {
    id: 'builtin:refactor',
    trigger: 'refactor',
    label: 'Refactor Code',
    description: 'Refactor and improve code quality',
    keywords: ['clean', 'improve', 'simplify', 'restructure'],
    icon: Code,
    source: 'builtin',
    executionType: 'prompt',
    execute: (ctx) => ctx.setMessage('Refactor '),
  },
  {
    id: 'builtin:explain',
    trigger: 'explain',
    label: 'Explain Code',
    description: 'Get an explanation of how code works',
    keywords: ['understand', 'describe', 'how'],
    icon: MessageSquareText,
    source: 'builtin',
    executionType: 'prompt',
    execute: (ctx) => ctx.setMessage('Explain '),
  },

  // Git commands (fire actions)
  {
    id: 'builtin:commit',
    trigger: 'commit',
    label: 'Commit Changes',
    description: 'Stage and commit current changes',
    keywords: ['save', 'stage', 'git'],
    icon: GitCommit,
    source: 'builtin',
    executionType: 'action',
    available: requiresSession,
    execute: () => window.dispatchEvent(new CustomEvent('git-commit')),
  },
  {
    id: 'builtin:pr',
    trigger: 'pr',
    label: 'Create Pull Request',
    description: 'Create a PR from current branch',
    keywords: ['pull request', 'merge', 'github'],
    icon: GitPullRequest,
    source: 'builtin',
    executionType: 'action',
    available: requiresSession,
    execute: () => window.dispatchEvent(new CustomEvent('git-create-pr')),
  },
  {
    id: 'builtin:sync',
    trigger: 'sync',
    label: 'Sync with Main',
    description: 'Pull and rebase from main branch',
    keywords: ['pull', 'rebase', 'update', 'git'],
    icon: RefreshCw,
    source: 'builtin',
    executionType: 'action',
    available: requiresSession,
    execute: () => window.dispatchEvent(new CustomEvent('git-sync')),
  },

  // Review commands (fire actions)
  {
    id: 'builtin:review',
    trigger: 'review',
    label: 'Quick Review',
    description: 'Run a quick code review on changes',
    keywords: ['fast', 'basic', 'check'],
    icon: Search,
    source: 'builtin',
    executionType: 'action',
    available: requiresSession,
    execute: () => window.dispatchEvent(new CustomEvent('start-review', { detail: { type: 'quick' } })),
  },
  {
    id: 'builtin:deep-review',
    trigger: 'deep-review',
    label: 'Deep Review',
    description: 'Run a thorough code review',
    keywords: ['thorough', 'comprehensive', 'detailed'],
    icon: FileCode,
    source: 'builtin',
    executionType: 'action',
    available: requiresSession,
    execute: () => window.dispatchEvent(new CustomEvent('start-review', { detail: { type: 'deep' } })),
  },
  {
    id: 'builtin:security',
    trigger: 'security',
    label: 'Security Audit',
    description: 'Scan for security vulnerabilities',
    keywords: ['vulnerability', 'audit', 'safe'],
    icon: Shield,
    source: 'builtin',
    executionType: 'action',
    available: requiresSession,
    execute: () => window.dispatchEvent(new CustomEvent('start-review', { detail: { type: 'security' } })),
  },

  // Mode toggles (fire actions)
  {
    id: 'builtin:plan',
    trigger: 'plan',
    label: 'Toggle Plan Mode',
    description: 'Plan before implementing changes',
    keywords: ['planning', 'architect', 'design'],
    icon: BookOpen,
    source: 'builtin',
    executionType: 'action',
    execute: () => window.dispatchEvent(new CustomEvent('toggle-plan-mode')),
  },
  {
    id: 'builtin:think',
    trigger: 'think',
    label: 'Toggle Thinking',
    description: 'Enable extended thinking mode',
    keywords: ['reasoning', 'deep', 'extended'],
    icon: Brain,
    source: 'builtin',
    executionType: 'action',
    execute: () => window.dispatchEvent(new CustomEvent('toggle-thinking')),
  },
];

// ============================================================================
// Store
// ============================================================================

interface SlashCommandStoreState {
  // Sources
  installedSkills: SkillDTO[];
  userCommands: UserCommandFile[];

  // Actions
  setInstalledSkills: (skills: SkillDTO[]) => void;
  setUserCommands: (commands: UserCommandFile[]) => void;
  fetchUserCommands: (workspaceId: string, sessionId: string) => Promise<void>;

  // Computed
  getAllCommands: (availability: SlashCommandAvailability) => UnifiedSlashCommand[];
}

/**
 * Convert an installed skill into a slash command.
 * The command sends the skill name as a message so the SDK's Skill tool handles it.
 */
function skillToCommand(skill: SkillDTO): UnifiedSlashCommand {
  return {
    id: `skill:${skill.id}`,
    trigger: skill.id,
    label: skill.name,
    description: skill.description,
    icon: Sparkles,
    source: 'skill',
    executionType: 'skill',
    available: requiresSession,
    execute: (ctx) => ctx.sendMessage(`/${skill.id}`),
  };
}

/**
 * Convert a user command file (.claude/commands/*.md) into a slash command.
 */
function userCommandToCommand(cmd: UserCommandFile): UnifiedSlashCommand {
  const hasArguments = cmd.content.includes('$ARGUMENTS');

  return {
    id: `user:${cmd.name}`,
    trigger: cmd.name,
    label: cmd.name.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
    description: cmd.description,
    icon: FileText,
    source: 'user',
    executionType: hasArguments ? 'prompt' : 'skill',
    available: requiresSession,
    execute: (ctx) => {
      if (hasArguments) {
        // Set prompt prefix so user can type arguments
        ctx.setMessage(`/${cmd.name} `);
      } else {
        // Send the full content as a message
        ctx.sendMessage(cmd.content);
      }
    },
  };
}

export const useSlashCommandStore = create<SlashCommandStoreState>((set, get) => ({
  installedSkills: [],
  userCommands: [],

  setInstalledSkills: (skills) => set({ installedSkills: skills }),
  setUserCommands: (commands) => set({ userCommands: commands }),

  fetchUserCommands: async (workspaceId, sessionId) => {
    try {
      const { listUserCommands } = await import('@/lib/api');
      const commands = await listUserCommands(workspaceId, sessionId);
      set({
        userCommands: commands.map((c) => ({
          name: c.name,
          description: c.description,
          filePath: c.filePath,
          content: c.content,
        })),
      });
    } catch {
      // Silently fail — user commands are optional
    }
  },

  getAllCommands: (availability) => {
    const { installedSkills, userCommands } = get();

    // Start with built-in commands
    const commands: UnifiedSlashCommand[] = BUILTIN_COMMANDS.filter(
      (cmd) => cmd.available?.(availability) ?? true
    );

    // Add installed skills
    for (const skill of installedSkills) {
      // Don't add if a built-in command already has this trigger
      const exists = commands.some((c) => c.trigger === skill.id);
      if (!exists) {
        const cmd = skillToCommand(skill);
        if (cmd.available?.(availability) ?? true) {
          commands.push(cmd);
        }
      }
    }

    // Add user commands
    for (const userCmd of userCommands) {
      const exists = commands.some((c) => c.trigger === userCmd.name);
      if (!exists) {
        const cmd = userCommandToCommand(userCmd);
        if (cmd.available?.(availability) ?? true) {
          commands.push(cmd);
        }
      }
    }

    return commands;
  },
}));
