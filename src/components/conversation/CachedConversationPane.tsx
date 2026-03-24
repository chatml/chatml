'use client';

import { useEffect, useReducer, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { GitBranch } from 'lucide-react';
import { ConversationMessagePane } from '@/components/conversation/ConversationMessagePane';
import { WelcomeScreen, SuggestionChips } from '@/components/conversation/WelcomeScreen';

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
      if (ids.length === state.ids.length) return state;
      // Reset activeId when the removed conversation was active — otherwise the
      // dispatch-during-render guard (conversationId !== convCache.activeId) won't
      // fire on re-selection, leaving convCache.ids empty and the pane blank.
      return { ids, activeId: state.activeId === action.conversationId ? null : state.activeId };
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

  // Empty state for the normal-conversation branch (not used on the welcome screen path).
  const activeEmptyState = useMemo(() => {
    return <ConversationEmptyState sessionName={sessionName} />;
  }, [sessionName]);

  // Only show the welcome screen for the active session — inactive cached sessions
  // with no conversations should not mount WelcomeScreen/SuggestionChips unnecessarily.
  const isWelcomeScreen = isActive && !conversationId && !hasConversations;

  return (
    <div className={cn(
      'flex flex-col absolute inset-0',
      isActive ? 'z-10' : 'invisible pointer-events-none z-0'
    )}>
      {isWelcomeScreen ? (
        /* Welcome screen: vertically centered composition with input as hero */
        <div className="flex-1 flex flex-col items-center justify-center gap-8 px-6 pb-4 relative">
          <WelcomeScreen sessionName={sessionBranch || sessionName} />
          <div className="w-full max-w-2xl relative z-10">
            {children}
          </div>
          <div className="max-w-2xl w-full">
            <SuggestionChips />
          </div>
        </div>
      ) : (
        /* Normal conversation layout */
        <>
          <div className="relative flex-1 min-h-0 overflow-hidden">
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
          <div className="shrink-0 relative z-10">
            {children}
          </div>
        </>
      )}
    </div>
  );
}

// --- Local sub-components ---

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
