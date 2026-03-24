'use client';

import { useEffect, useCallback, useReducer, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { GitBranch, Wand2, Bug, TestTube2, Eye, Code2, FileText } from 'lucide-react';
import { ConversationMessagePane } from '@/components/conversation/ConversationMessagePane';

// Maximum number of conversation Virtuoso instances to keep mounted per session.
// Each cached conversation preserves its scroll position and rendered DOM,
// making tab switching instant (no remount, no measurement flash).
const MAX_CACHED_CONVERSATIONS = 3;

/** Notify mounted CachedConversationPane instances to evict a conversation from
 *  their LRU cache. Called by ConversationArea when a conversation tab is closed. */
export function clearScrollPosition(conversationId: string) {
  window.dispatchEvent(
    new CustomEvent('conversation-cache-evict', { detail: { conversationId } }),
  );
}

// --- Conversation LRU reducer ---

type ConvCacheState = { ids: string[]; activeId: string | null };

type ConvCacheAction =
  | { type: 'activate'; conversationId: string }
  | { type: 'deactivate' }
  | { type: 'remove'; conversationId: string };

const INITIAL_CONV_CACHE: ConvCacheState = { ids: [], activeId: null };

function convCacheReducer(state: ConvCacheState, action: ConvCacheAction): ConvCacheState {
  switch (action.type) {
    case 'activate': {
      // Move to front, evict oldest if over limit
      const filtered = state.ids.filter(id => id !== action.conversationId);
      const next = [action.conversationId, ...filtered];
      const ids = next.length > MAX_CACHED_CONVERSATIONS ? next.slice(0, MAX_CACHED_CONVERSATIONS) : next;
      return { ids, activeId: action.conversationId };
    }
    case 'deactivate':
      return state.activeId === null ? state : { ...state, activeId: null };
    case 'remove': {
      const ids = state.ids.filter(id => id !== action.conversationId);
      return ids.length === state.ids.length ? state : { ids, activeId: state.activeId };
    }
    default:
      return state;
  }
}

// --- Main component ---

interface CachedConversationPaneProps {
  conversationId: string | null;
  isActive: boolean;
  worktreePath?: string;
  sessionName?: string;
  sessionBranch?: string;
  hasConversations: boolean;
  children?: React.ReactNode;
}

export function CachedConversationPane({
  conversationId,
  isActive,
  worktreePath,
  sessionName,
  sessionBranch,
  hasConversations,
  children,
}: CachedConversationPaneProps) {
  // Conversation-level LRU cache: keeps up to MAX_CACHED_CONVERSATIONS
  // Virtuoso instances mounted per session. Switching between cached
  // conversations toggles visibility instead of remounting.
  const [convCache, dispatch] = useReducer(convCacheReducer, INITIAL_CONV_CACHE);

  // Dispatch during render (React-endorsed "adjust state during rendering"
  // pattern) so the ConversationMessagePane mounts on the same paint frame.
  // A useEffect would run post-paint, leaving a blank frame where no pane
  // exists for the new conversationId. activeId is tracked inside the reducer
  // so a single dispatch handles both tracking and cache update — no separate
  // useState needed. Null transitions are also tracked so re-selecting a
  // previously evicted conversation correctly re-activates it.
  if (conversationId !== convCache.activeId) {
    if (conversationId) {
      dispatch({ type: 'activate', conversationId });
    } else {
      dispatch({ type: 'deactivate' });
    }
  }

  // Evict conversations from the LRU when they are deleted (tab closed).
  // clearScrollPosition() fires a custom event so the reducer stays in sync.
  useEffect(() => {
    const handleEvict = (e: Event) => {
      const { conversationId: id } = (e as CustomEvent<{ conversationId: string }>).detail;
      dispatch({ type: 'remove', conversationId: id });
    };
    window.addEventListener('conversation-cache-evict', handleEvict);
    return () => window.removeEventListener('conversation-cache-evict', handleEvict);
  }, []);

  // Compute empty state for the active conversation
  const activeEmptyState = useMemo(() => {
    if (!hasConversations) {
      return <SessionHomeState sessionName={sessionBranch || sessionName} />;
    }
    return <ConversationEmptyState sessionName={sessionName} />;
  }, [hasConversations, sessionName, sessionBranch]);

  return (
    <div className={cn(
      'flex flex-col absolute inset-0',
      isActive ? 'z-10' : 'invisible pointer-events-none z-0'
    )}>
      {/* Message panes — one per cached conversation, visibility-toggled */}
      <div className="relative flex-1 min-h-0 overflow-hidden">
        {/* Session home state when no conversation is selected and no conversations exist */}
        {!conversationId && !hasConversations && (
          <div className="h-full overflow-auto">
            <SessionHomeState sessionName={sessionBranch || sessionName} />
          </div>
        )}

        {/* Cached conversation panes */}
        {convCache.ids.map((cachedConvId) => (
          <ConversationMessagePane
            key={cachedConvId}
            conversationId={cachedConvId}
            isActive={cachedConvId === conversationId && isActive}
            worktreePath={worktreePath}
            emptyState={cachedConvId === conversationId ? activeEmptyState : undefined}
          />
        ))}
      </div>

      {/* Chat Input */}
      <div className="shrink-0 relative z-10">
        {children}
      </div>
    </div>
  );
}

// --- Local sub-components ---

const QUICK_ACTIONS = [
  { icon: Bug, label: 'Fix a bug', description: 'Diagnose and resolve issues', prompt: 'Fix a bug: ', iconClass: 'text-rose-600 dark:text-rose-400', gradientClass: 'bg-gradient-to-b from-rose-500/15 to-rose-500/5' },
  { icon: TestTube2, label: 'Write tests', description: 'Improve coverage and confidence', prompt: 'Write tests for ', iconClass: 'text-emerald-600 dark:text-emerald-400', gradientClass: 'bg-gradient-to-b from-emerald-500/15 to-emerald-500/5' },
  { icon: Wand2, label: 'Add a feature', description: 'Build something new', prompt: 'Add a feature: ', iconClass: 'text-brand', gradientClass: 'bg-gradient-to-b from-brand/15 to-brand/5' },
  { icon: Eye, label: 'Review code', description: 'Get a fresh perspective', prompt: 'Review the code in ', iconClass: 'text-blue-600 dark:text-blue-400', gradientClass: 'bg-gradient-to-b from-blue-500/15 to-blue-500/5' },
  { icon: Code2, label: 'Refactor', description: 'Improve structure and clarity', prompt: 'Refactor ', iconClass: 'text-amber-600 dark:text-amber-400', gradientClass: 'bg-gradient-to-b from-amber-500/15 to-amber-500/5' },
  { icon: FileText, label: 'Documentation', description: 'Explain what the code does', prompt: 'Write documentation for ', iconClass: 'text-purple-600 dark:text-purple-400', gradientClass: 'bg-gradient-to-b from-purple-500/15 to-purple-500/5' },
];

function SessionHomeState({ sessionName }: { sessionName?: string }) {
  const handleTemplateClick = useCallback((prompt: string) => {
    window.dispatchEvent(
      new CustomEvent('session-home-template-selected', { detail: { text: prompt } }),
    );
  }, []);

  return (
    <div className="pt-3 pl-5 pr-12 pb-10 animate-fade-in">
      <div className="relative">
        <div className="absolute inset-x-0 top-0 h-48 bg-[radial-gradient(ellipse_60%_50%_at_50%_-20%,oklch(0.707_0.165_292/0.04),transparent)] dark:bg-[radial-gradient(ellipse_60%_50%_at_50%_-20%,oklch(0.707_0.165_292/0.06),transparent)] pointer-events-none" />

        <div className="relative max-w-lg mx-auto stagger-children">
          {sessionName && (
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-brand/10 text-brand text-sm font-medium mb-5 animate-scale-in">
              <GitBranch className="w-4 h-4" />
              {sessionName}
            </div>
          )}

          <div className="mb-6">
            <h2 className="font-display text-[1.375rem] leading-[1.25] tracking-display">
              Let&apos;s build something
            </h2>
            <p className="text-sm text-muted-foreground mt-1.5">
              Pick a starting point, or just describe what you need
            </p>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {QUICK_ACTIONS.map(({ icon: Icon, label, description, prompt, iconClass, gradientClass }) => (
              <button
                key={label}
                type="button"
                onClick={() => handleTemplateClick(prompt)}
                className="group flex flex-col items-center text-center gap-2.5 rounded-xl border px-3 py-4 transition-all duration-150 border-border/30 bg-card/30 cursor-pointer hover:bg-card/60 hover:border-border/50 hover:shadow-sm active:scale-[0.98]"
              >
                <div className={cn(
                  'size-10 rounded-xl flex items-center justify-center shrink-0 transition-colors',
                  gradientClass,
                  'group-hover:brightness-110'
                )}>
                  <Icon className={cn('size-5', iconClass)} />
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-medium text-foreground/90 transition-colors group-hover:text-foreground">
                    {label}
                  </div>
                  <div className="text-[11px] text-muted-foreground/70 mt-0.5">
                    {description}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function ConversationEmptyState({ sessionName }: { sessionName?: string }) {
  return (
    <div className="pt-3 pl-5 pr-12 pb-10 animate-fade-in">
      <div className="max-w-lg mx-auto text-center">
        {sessionName && (
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-brand/10 text-brand text-sm font-medium mb-6 animate-scale-in">
            <GitBranch className="w-4 h-4" />
            {sessionName}
          </div>
        )}
        <h2 className="font-display text-[1.375rem] leading-[1.25] tracking-display mb-2">New Session</h2>
        <p className="text-sm text-muted-foreground mb-6">
          Describe your task below. An AI agent will work on it in an isolated git branch.
        </p>
        <div className="text-left bg-background rounded-lg p-4 space-y-3 border border-border">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Example tasks</p>
          <div className="space-y-2 text-sm stagger-children">
            <p className="text-muted-foreground">&quot;Add user authentication with JWT tokens&quot;</p>
            <p className="text-muted-foreground">&quot;Write unit tests for the payment service&quot;</p>
            <p className="text-muted-foreground">&quot;Refactor the API to use async/await&quot;</p>
          </div>
        </div>
      </div>
    </div>
  );
}
