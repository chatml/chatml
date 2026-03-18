'use client';

import { useEffect, useCallback, useReducer, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { GitBranch, Sparkles, Bug, TestTube2, Eye, RefreshCw, FileText } from 'lucide-react';
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
      <div className="relative flex-1 min-h-0">
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
      <div className="shrink-0 relative">
        {children}
      </div>
    </div>
  );
}

// --- Local sub-components ---

const QUICK_ACTIONS = [
  { icon: Bug, label: 'Fix a bug', prompt: 'Fix a bug: ' },
  { icon: TestTube2, label: 'Write tests', prompt: 'Write tests for ' },
  { icon: Sparkles, label: 'Add a feature', prompt: 'Add a feature: ' },
  { icon: Eye, label: 'Review code', prompt: 'Review the code in ' },
  { icon: RefreshCw, label: 'Refactor', prompt: 'Refactor ' },
  { icon: FileText, label: 'Documentation', prompt: 'Write documentation for ' },
];

function SessionHomeState({ sessionName }: { sessionName?: string }) {
  const handleTemplateClick = useCallback((prompt: string) => {
    window.dispatchEvent(
      new CustomEvent('session-home-template-selected', { detail: { text: prompt } }),
    );
  }, []);

  return (
    <div className="pt-3 pl-5 pr-12 pb-10 animate-fade-in">
      <div className="max-w-md mx-auto text-center">
        {sessionName && (
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-brand/10 text-brand text-sm font-medium mb-6 animate-scale-in">
            <GitBranch className="w-4 h-4" />
            {sessionName}
          </div>
        )}
        <h2 className="font-display text-[1.375rem] leading-[1.25] tracking-display mb-2">
          What would you like to work on?
        </h2>
        <p className="text-sm text-muted-foreground mb-6">
          Type below to start, or pick a quick action
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {QUICK_ACTIONS.map(({ icon: Icon, label, prompt }) => (
            <button
              key={label}
              type="button"
              onClick={() => handleTemplateClick(prompt)}
              className="flex items-center gap-2 px-3 py-2.5 rounded-lg border border-border bg-card text-sm text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors cursor-pointer text-left"
            >
              <Icon className="w-4 h-4 shrink-0" />
              {label}
            </button>
          ))}
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
