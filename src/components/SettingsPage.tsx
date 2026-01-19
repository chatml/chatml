'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  ArrowLeft,
  MessageSquare,
  Palette,
  GitBranch,
  FileCode,
  Bot,
  User,
  Beaker,
  MessageCircle,
  RefreshCw,
  FileText,
  BookOpen,
  Settings2,
  ExternalLink,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface SettingsPageProps {
  onBack: () => void;
}

type SettingsCategory =
  | 'chat'
  | 'appearance'
  | 'git'
  | 'env'
  | 'claude-code'
  | 'account'
  | 'experimental'
  | 'feedback'
  | 'updates'
  | 'advanced';

interface NavItem {
  id: SettingsCategory;
  label: string;
  icon: React.ReactNode;
  external?: boolean;
}

const mainNavItems: NavItem[] = [
  { id: 'chat', label: 'Chat', icon: <MessageSquare className="w-4 h-4" /> },
  { id: 'appearance', label: 'Appearance', icon: <Palette className="w-4 h-4" /> },
  { id: 'git', label: 'Git', icon: <GitBranch className="w-4 h-4" /> },
  { id: 'env', label: 'Env', icon: <FileCode className="w-4 h-4" /> },
  { id: 'claude-code', label: 'Claude Code', icon: <Bot className="w-4 h-4" /> },
  { id: 'account', label: 'Account', icon: <User className="w-4 h-4" /> },
];

const moreNavItems: NavItem[] = [
  { id: 'experimental', label: 'Experimental', icon: <Beaker className="w-4 h-4" /> },
  { id: 'feedback', label: 'Feedback', icon: <MessageCircle className="w-4 h-4" /> },
  { id: 'updates', label: 'Check for updates', icon: <RefreshCw className="w-4 h-4" /> },
  { id: 'advanced', label: 'Advanced', icon: <Settings2 className="w-4 h-4" /> },
];

const externalLinks = [
  { label: 'Changelog', icon: <FileText className="w-4 h-4" />, url: '#' },
  { label: 'Docs', icon: <BookOpen className="w-4 h-4" />, url: '#' },
];

export function SettingsPage({ onBack }: SettingsPageProps) {
  const [selectedCategory, setSelectedCategory] = useState<SettingsCategory>('chat');

  return (
    <div className="flex h-full bg-background">
      {/* Settings Sidebar */}
      <div className="w-56 border-r bg-sidebar flex flex-col">
        {/* Back button - with padding for macOS traffic lights */}
        <div data-tauri-drag-region className="h-11 pl-20 pr-3 flex items-center border-b shrink-0">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 -ml-2 text-muted-foreground hover:text-foreground"
            onClick={onBack}
          >
            <ArrowLeft className="w-4 h-4" />
            Back to app
          </Button>
        </div>

        <ScrollArea className="flex-1">
          <div className="py-2 px-2">
            {/* Main nav items */}
            <div className="space-y-0.5">
              {mainNavItems.map((item) => (
                <Button
                  key={item.id}
                  variant={selectedCategory === item.id ? 'secondary' : 'ghost'}
                  size="sm"
                  className={cn(
                    'w-full justify-start gap-2 h-8',
                    selectedCategory === item.id && 'bg-sidebar-accent'
                  )}
                  onClick={() => setSelectedCategory(item.id)}
                >
                  {item.icon}
                  {item.label}
                </Button>
              ))}
            </div>

            {/* More section */}
            <div className="mt-6">
              <span className="text-xs font-medium text-muted-foreground px-2">More</span>
              <div className="mt-2 space-y-0.5">
                {moreNavItems.map((item) => (
                  <Button
                    key={item.id}
                    variant={selectedCategory === item.id ? 'secondary' : 'ghost'}
                    size="sm"
                    className={cn(
                      'w-full justify-start gap-2 h-8',
                      selectedCategory === item.id && 'bg-sidebar-accent'
                    )}
                    onClick={() => setSelectedCategory(item.id)}
                  >
                    {item.icon}
                    {item.label}
                  </Button>
                ))}
                {externalLinks.map((link) => (
                  <Button
                    key={link.label}
                    variant="ghost"
                    size="sm"
                    className="w-full justify-start gap-2 h-8"
                    onClick={() => window.open(link.url, '_blank')}
                  >
                    {link.icon}
                    {link.label}
                    <ExternalLink className="w-3 h-3 ml-auto text-muted-foreground" />
                  </Button>
                ))}
              </div>
            </div>
          </div>
        </ScrollArea>
      </div>

      {/* Settings Content */}
      <div className="flex-1 overflow-hidden">
        <ScrollArea className="h-full">
          <div className="max-w-2xl mx-auto py-8 px-8">
            {selectedCategory === 'chat' && <ChatSettings />}
            {selectedCategory === 'appearance' && <AppearanceSettings />}
            {selectedCategory === 'git' && <GitSettings />}
            {selectedCategory === 'env' && <EnvSettings />}
            {selectedCategory === 'claude-code' && <ClaudeCodeSettings />}
            {selectedCategory === 'account' && <AccountSettings />}
            {selectedCategory === 'experimental' && <ExperimentalSettings />}
            {selectedCategory === 'feedback' && <FeedbackSettings />}
            {selectedCategory === 'updates' && <UpdatesSettings />}
            {selectedCategory === 'advanced' && <AdvancedSettings />}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}

// Settings Row Component
function SettingsRow({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between py-4 border-b border-border/50">
      <div className="flex-1 pr-4">
        <h4 className="text-sm font-medium">{title}</h4>
        {description && (
          <p className="text-sm text-muted-foreground mt-0.5">{description}</p>
        )}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

// Chat Settings
function ChatSettings() {
  return (
    <div>
      <h2 className="text-2xl font-semibold mb-6">Chat</h2>

      <SettingsRow title="Default model" description="Model for new chats">
        <div className="flex gap-2">
          <Select defaultValue="opus-4.5">
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="opus-4.5">Opus 4.5</SelectItem>
              <SelectItem value="sonnet-4">Sonnet 4</SelectItem>
              <SelectItem value="haiku-3.5">Haiku 3.5</SelectItem>
            </SelectContent>
          </Select>
          <Select defaultValue="thinking-on">
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="thinking-on">Thinking on</SelectItem>
              <SelectItem value="thinking-off">Thinking off</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </SettingsRow>

      <SettingsRow title="Review model" description="Model for code reviews">
        <div className="flex gap-2">
          <Select defaultValue="opus-4.5">
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="opus-4.5">Opus 4.5</SelectItem>
              <SelectItem value="sonnet-4">Sonnet 4</SelectItem>
              <SelectItem value="haiku-3.5">Haiku 3.5</SelectItem>
            </SelectContent>
          </Select>
          <Select defaultValue="thinking-on">
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="thinking-on">Thinking on</SelectItem>
              <SelectItem value="thinking-off">Thinking off</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </SettingsRow>

      <SettingsRow
        title="Default to plan mode"
        description="Start new chats in plan mode (Claude only)"
      >
        <Switch />
      </SettingsRow>

      <SettingsRow
        title="Desktop notifications"
        description="Get notified when AI finishes working in a chat"
      >
        <Switch defaultChecked />
      </SettingsRow>

      <SettingsRow
        title="Sound effects"
        description="Play a sound when AI finishes working in a chat"
      >
        <div className="flex items-center gap-2">
          <Select defaultValue="chime">
            <SelectTrigger className="w-24">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="chime">Chime</SelectItem>
              <SelectItem value="ding">Ding</SelectItem>
              <SelectItem value="pop">Pop</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm">
            Test
          </Button>
          <Switch />
        </div>
      </SettingsRow>

      <SettingsRow
        title="Send messages with"
        description="Choose which key combination sends messages. Use ⇧↵ for new lines"
      >
        <Select defaultValue="enter">
          <SelectTrigger className="w-28">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="enter">Enter</SelectItem>
            <SelectItem value="cmd-enter">⌘ Enter</SelectItem>
          </SelectContent>
        </Select>
      </SettingsRow>

      <SettingsRow
        title="Auto-convert long text"
        description="Convert pasted text over 5000 characters into text attachments"
      >
        <Switch defaultChecked />
      </SettingsRow>

      <SettingsRow
        title="Show chat cost"
        description="Display chat cost in the top bar"
      >
        <Switch defaultChecked />
      </SettingsRow>
    </div>
  );
}

// Placeholder settings components
function AppearanceSettings() {
  return (
    <div>
      <h2 className="text-2xl font-semibold mb-6">Appearance</h2>
      <SettingsRow title="Theme" description="Choose your preferred theme">
        <Select defaultValue="system">
          <SelectTrigger className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="system">System</SelectItem>
            <SelectItem value="light">Light</SelectItem>
            <SelectItem value="dark">Dark</SelectItem>
          </SelectContent>
        </Select>
      </SettingsRow>
      <SettingsRow title="Font size" description="Adjust the interface font size">
        <Select defaultValue="medium">
          <SelectTrigger className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="small">Small</SelectItem>
            <SelectItem value="medium">Medium</SelectItem>
            <SelectItem value="large">Large</SelectItem>
          </SelectContent>
        </Select>
      </SettingsRow>
    </div>
  );
}

function GitSettings() {
  const [branchPrefixType, setBranchPrefixType] = useState<'github' | 'custom' | 'none'>('github');
  const [customPrefix, setCustomPrefix] = useState('');
  const [deleteBranchOnArchive, setDeleteBranchOnArchive] = useState(false);
  const [archiveOnMerge, setArchiveOnMerge] = useState(false);

  // TODO: Get actual GitHub username from git config or API
  const githubUsername = 'mcastilho';

  return (
    <div>
      <h2 className="text-2xl font-semibold mb-6">Git</h2>

      {/* Branch name prefix */}
      <div className="py-4 border-b border-border/50">
        <h4 className="text-sm font-medium">Branch name prefix</h4>
        <p className="text-sm text-muted-foreground mt-0.5">
          Prefix for new workspace branch names. Will be followed by a slash.
        </p>

        <div className="mt-4 space-y-2">
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="radio"
              name="branchPrefix"
              checked={branchPrefixType === 'github'}
              onChange={() => setBranchPrefixType('github')}
              className="w-4 h-4 text-primary border-muted-foreground/50 focus:ring-primary"
            />
            <span className="text-sm">GitHub username ({githubUsername})</span>
          </label>

          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="radio"
              name="branchPrefix"
              checked={branchPrefixType === 'custom'}
              onChange={() => setBranchPrefixType('custom')}
              className="w-4 h-4 text-primary border-muted-foreground/50 focus:ring-primary"
            />
            <span className="text-sm">Custom</span>
          </label>

          {branchPrefixType === 'custom' && (
            <div className="ml-7">
              <input
                type="text"
                value={customPrefix}
                onChange={(e) => setCustomPrefix(e.target.value)}
                placeholder="Enter custom prefix"
                className="w-48 px-3 py-1.5 text-sm bg-background border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
          )}

          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="radio"
              name="branchPrefix"
              checked={branchPrefixType === 'none'}
              onChange={() => setBranchPrefixType('none')}
              className="w-4 h-4 text-primary border-muted-foreground/50 focus:ring-primary"
            />
            <span className="text-sm">None</span>
          </label>
        </div>
      </div>

      {/* Delete branch on archive */}
      <div className="flex items-start justify-between py-4 border-b border-border/50">
        <div className="flex-1 pr-4">
          <h4 className="text-sm font-medium">Delete branch on archive</h4>
          <p className="text-sm text-muted-foreground mt-0.5">
            Delete the local branch when archiving a workspace.
            <br />
            To delete the remote branch,{' '}
            <a
              href="https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-the-automatic-deletion-of-branches"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              configure it on GitHub
            </a>
            .
          </p>
        </div>
        <div className="shrink-0 pt-1">
          <Switch
            checked={deleteBranchOnArchive}
            onCheckedChange={setDeleteBranchOnArchive}
          />
        </div>
      </div>

      {/* Archive on merge */}
      <div className="flex items-start justify-between py-4 border-b border-border/50">
        <div className="flex-1 pr-4">
          <h4 className="text-sm font-medium">Archive on merge</h4>
          <p className="text-sm text-muted-foreground mt-0.5">
            Automatically archive a workspace after merging its PR in ChatML
          </p>
        </div>
        <div className="shrink-0 pt-1">
          <Switch
            checked={archiveOnMerge}
            onCheckedChange={setArchiveOnMerge}
          />
        </div>
      </div>
    </div>
  );
}

function EnvSettings() {
  return (
    <div>
      <h2 className="text-2xl font-semibold mb-6">Environment Variables</h2>
      <p className="text-sm text-muted-foreground">
        Configure environment variables for your sessions.
      </p>
    </div>
  );
}

function ClaudeCodeSettings() {
  return (
    <div>
      <h2 className="text-2xl font-semibold mb-6">Claude Code</h2>
      <SettingsRow
        title="Auto-approve safe commands"
        description="Automatically approve read-only commands"
      >
        <Switch defaultChecked />
      </SettingsRow>
      <SettingsRow
        title="Max thinking tokens"
        description="Maximum tokens for extended thinking"
      >
        <Select defaultValue="16000">
          <SelectTrigger className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="8000">8,000</SelectItem>
            <SelectItem value="16000">16,000</SelectItem>
            <SelectItem value="32000">32,000</SelectItem>
          </SelectContent>
        </Select>
      </SettingsRow>
    </div>
  );
}

function AccountSettings() {
  return (
    <div>
      <h2 className="text-2xl font-semibold mb-6">Account</h2>
      <p className="text-sm text-muted-foreground">
        Manage your account settings and API keys.
      </p>
    </div>
  );
}

function ExperimentalSettings() {
  return (
    <div>
      <h2 className="text-2xl font-semibold mb-6">Experimental</h2>
      <p className="text-sm text-muted-foreground mb-4">
        These features are experimental and may change or be removed.
      </p>
      <SettingsRow
        title="Parallel agents"
        description="Enable multiple agents working in parallel"
      >
        <Switch />
      </SettingsRow>
    </div>
  );
}

function FeedbackSettings() {
  return (
    <div>
      <h2 className="text-2xl font-semibold mb-6">Feedback</h2>
      <p className="text-sm text-muted-foreground">
        Help us improve ChatML by sharing your feedback.
      </p>
    </div>
  );
}

function UpdatesSettings() {
  return (
    <div>
      <h2 className="text-2xl font-semibold mb-6">Updates</h2>
      <p className="text-sm text-muted-foreground">
        ChatML is up to date.
      </p>
    </div>
  );
}

function AdvancedSettings() {
  return (
    <div>
      <h2 className="text-2xl font-semibold mb-6">Advanced</h2>
      <SettingsRow
        title="Developer mode"
        description="Show additional debugging information"
      >
        <Switch />
      </SettingsRow>
      <SettingsRow
        title="Clear cache"
        description="Clear cached data and temporary files"
      >
        <Button variant="outline" size="sm">
          Clear
        </Button>
      </SettingsRow>
    </div>
  );
}
