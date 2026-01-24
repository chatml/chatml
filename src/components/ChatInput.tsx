'use client';

import { useState, useRef, useEffect, useCallback, useMemo, KeyboardEvent } from 'react';
import { useAppStore } from '@/stores/appStore';
import { createConversation, sendConversationMessage, stopConversation, setConversationPlanMode, approvePlan } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  Snowflake,
  ChevronDown,
  Paperclip,
  ArrowUp,
  Square,
  Brain,
  BookOpen,
  Plus,
  Link,
  FolderSymlink,
  FileText,
  EyeOff,
  Loader2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { listenForFileDrop, listenForDragEnter, listenForDragLeave } from '@/lib/tauri';

const MODELS = [
  { id: 'opus-4.5', name: 'Opus 4.5', icon: Snowflake },
  { id: 'sonnet-4', name: 'Sonnet 4', icon: Snowflake },
  { id: 'haiku-3.5', name: 'Haiku 3.5', icon: Snowflake },
];

// Token budget for extended thinking mode
const DEFAULT_THINKING_TOKENS = 10000;

// Common prompt patterns for suggestions
const COMMON_PATTERNS = [
  // Bug fixing & Debugging
  'Fix the bug in',
  'Fix the issue with',
  'Fix the error in',
  'Debug the',
  'Debug why',
  'Find the bug in',
  'Find out why',
  'Investigate why',
  'Troubleshoot the',
  'Figure out why',
  'The tests are failing because',
  'This is broken because',
  'Why is this not working',
  'Why does this fail',
  'Why am I getting this error',

  // Testing
  'Add tests for',
  'Add unit tests for',
  'Add integration tests for',
  'Add e2e tests for',
  'Write tests for',
  'Write unit tests for',
  'Write a test that',
  'Create tests for',
  'Test the',
  'Add test coverage for',
  'Mock the',
  'Add a snapshot test for',
  'Add edge case tests for',

  // Refactoring
  'Refactor the',
  'Refactor this to',
  'Clean up the',
  'Simplify the',
  'Simplify this code',
  'Extract a function for',
  'Extract a component for',
  'Extract this into',
  'Split this into',
  'Consolidate the',
  'Merge these',
  'Deduplicate the',
  'Remove duplication in',
  'Make this more readable',
  'Improve the readability of',
  'Reduce complexity in',

  // Implementation
  'Implement',
  'Implement a function that',
  'Implement a method that',
  'Implement the logic for',
  'Implement support for',
  'Add a function that',
  'Add a method that',
  'Add a feature to',
  'Add support for',
  'Add the ability to',
  'Add functionality to',
  'Build a',
  'Create a',
  'Create a function that',
  'Create a method that',
  'Create a helper for',
  'Create a utility for',
  'Create a hook for',
  'Create a service for',
  'Create a class for',
  'Write a function that',
  'Write a script that',
  'Write code to',
  'Make it so that',
  'I need to',
  'I want to',
  'Can you',
  'Please',

  // Components & UI
  'Create a component for',
  'Create a new component that',
  'Add a component for',
  'Build a component that',
  'Add a button that',
  'Add a form for',
  'Add a modal for',
  'Add a dialog for',
  'Add a dropdown for',
  'Add a tooltip for',
  'Add a sidebar',
  'Add a header',
  'Add a footer',
  'Add a navigation',
  'Add a loading state',
  'Add a loading spinner',
  'Add an empty state',
  'Add an error state',
  'Add pagination to',
  'Add infinite scroll to',
  'Add drag and drop to',
  'Add a search bar',
  'Add filtering to',
  'Add sorting to',

  // Styling & CSS
  'Style the',
  'Add styles for',
  'Update the styles for',
  'Fix the styling of',
  'Add responsive styles for',
  'Make this responsive',
  'Add dark mode support',
  'Add animation to',
  'Add a transition to',
  'Center the',
  'Align the',
  'Add spacing to',
  'Add padding to',
  'Add margin to',

  // Updates & Changes
  'Update the',
  'Update this to',
  'Change the',
  'Change this to',
  'Modify the',
  'Modify this to',
  'Edit the',
  'Adjust the',
  'Tweak the',
  'Rename',
  'Move the',
  'Move this to',
  'Replace',
  'Convert this to',
  'Convert the',
  'Transform the',
  'Migrate the',
  'Migrate this to',
  'Upgrade the',
  'Upgrade to',

  // Removal & Cleanup
  'Remove the',
  'Remove this',
  'Delete the',
  'Delete this',
  'Get rid of',
  'Clean up',
  'Remove unused',
  'Remove dead code',
  'Remove deprecated',

  // Error Handling
  'Add error handling to',
  'Add error handling for',
  'Handle the error',
  'Handle errors in',
  'Handle the case when',
  'Handle edge cases in',
  'Add try catch to',
  'Add validation for',
  'Add input validation to',
  'Validate the',
  'Add null checks to',
  'Add boundary checks',
  'Add fallback for',
  'Add a default value for',

  // Performance
  'Optimize the',
  'Optimize the performance of',
  'Improve the performance of',
  'Speed up the',
  'Make this faster',
  'Reduce the bundle size',
  'Add memoization to',
  'Add caching to',
  'Cache the',
  'Lazy load the',
  'Add debouncing to',
  'Add throttling to',
  'Reduce re-renders in',
  'Fix the memory leak in',

  // Documentation
  'Add documentation for',
  'Add docs for',
  'Document the',
  'Add comments to',
  'Add JSDoc to',
  'Add a README for',
  'Update the README',
  'Explain the',
  'Add inline comments to',
  'Add type documentation for',

  // Types & TypeScript
  'Add types for',
  'Add type annotations to',
  'Fix the types for',
  'Fix the type error in',
  'Create a type for',
  'Create an interface for',
  'Define a type for',
  'Add generics to',
  'Make this type-safe',
  'Add strict types to',

  // API & Backend
  'Add an API endpoint for',
  'Create an API for',
  'Create an endpoint for',
  'Add a route for',
  'Fetch data from',
  'Send data to',
  'Call the API',
  'Make an API call to',
  'Add a GET endpoint for',
  'Add a POST endpoint for',
  'Add a PUT endpoint for',
  'Add a DELETE endpoint for',
  'Handle the API response',
  'Parse the response from',

  // Database
  'Add a database query for',
  'Create a query that',
  'Write a query to',
  'Add a migration for',
  'Create a migration that',
  'Add an index on',
  'Add a foreign key to',
  'Create a table for',
  'Update the schema to',
  'Add a column for',
  'Query the database for',

  // Authentication & Security
  'Add authentication to',
  'Add authorization for',
  'Add login functionality',
  'Add logout functionality',
  'Add password reset',
  'Add session management',
  'Add JWT support',
  'Add OAuth support',
  'Secure the',
  'Add CSRF protection',
  'Add rate limiting to',
  'Sanitize the input',
  'Escape the output',
  'Add encryption for',

  // State Management
  'Add state for',
  'Create a store for',
  'Add a reducer for',
  'Add an action for',
  'Update the state when',
  'Manage the state of',
  'Add a context for',
  'Add a provider for',
  'Persist the state',
  'Reset the state',
  'Sync the state with',

  // Events & Handlers
  'Add a handler for',
  'Add an event listener for',
  'Handle the click event',
  'Handle the submit event',
  'Handle the change event',
  'Handle keyboard events',
  'Add keyboard shortcuts',
  'Add hotkeys for',
  'Listen for',
  'Subscribe to',
  'Emit an event when',

  // Git & Version Control
  'Commit these changes',
  'Create a commit for',
  'Create a branch for',
  'Merge the',
  'Rebase onto',
  'Cherry-pick the',
  'Resolve the merge conflict',
  'Squash the commits',
  'Revert the',
  'Undo the last commit',

  // Configuration
  'Configure the',
  'Add configuration for',
  'Set up the',
  'Initialize the',
  'Add environment variables for',
  'Add settings for',
  'Create a config file for',
  'Update the config to',

  // Dependencies
  'Add the dependency',
  'Install the',
  'Update the dependency',
  'Remove the dependency',
  'Upgrade the package',
  'Fix the dependency conflict',
  'Add a peer dependency',

  // Logging & Monitoring
  'Add logging to',
  'Add logs for',
  'Log the',
  'Add debug logs to',
  'Add error logging to',
  'Add metrics for',
  'Add monitoring for',
  'Track the',
  'Add analytics for',

  // Questions - Explanation
  'Explain how',
  'Explain the',
  'Explain this code',
  'Explain what',
  'Explain why',
  'What does',
  'What is',
  'What are',
  'What happens when',
  'What would happen if',
  'What is the difference between',
  'What is the purpose of',
  'What is the best way to',
  'What are the options for',

  // Questions - Why
  'Why is',
  'Why does',
  'Why do',
  'Why are',
  'Why would',
  'Why should',
  'Why not',
  'Why did',

  // Questions - How
  'How do I',
  'How does',
  'How can I',
  'How would I',
  'How should I',
  'How to',
  'How is',
  'How are',

  // Questions - Other
  'Where is',
  'Where does',
  'Where should',
  'When should I',
  'When to',
  'Which is better',
  'Should I',
  'Can I',
  'Is it possible to',
  'Is there a way to',
  'Is this the right way to',

  // Code Review
  'Review the code in',
  'Review this code',
  'Check the code for',
  'Find issues in',
  'Look for bugs in',
  'Audit the',
  'Analyze the',
  'Evaluate the',
  'Suggest improvements for',
  'What can be improved in',

  // File Operations
  'Read the file',
  'Write to the file',
  'Create a file for',
  'Delete the file',
  'Move the file to',
  'Rename the file to',
  'Copy the file to',
  'Parse the file',
  'Generate a file for',

  // Async & Promises
  'Add async/await to',
  'Convert to async/await',
  'Handle the promise',
  'Add a promise for',
  'Wait for',
  'Run in parallel',
  'Run sequentially',
  'Add concurrency to',

  // Architecture
  'Design a',
  'Architect the',
  'Plan the',
  'Structure the',
  'Organize the',
  'Set up the folder structure for',
  'Add a layer for',
  'Separate concerns in',
  'Add dependency injection',

  // Integration
  'Integrate with',
  'Connect to',
  'Hook up the',
  'Wire up the',
  'Link the',
  'Add webhook support for',
  'Add SSO with',
  'Add OAuth with',

  // Deployment
  'Deploy the',
  'Add deployment scripts for',
  'Set up CI/CD for',
  'Add Docker support',
  'Create a Dockerfile for',
  'Add Kubernetes config for',
  'Configure the build for',
  'Add a build script for',

  // Misc
  'Show me',
  'List all',
  'Find all',
  'Search for',
  'Count the',
  'Calculate the',
  'Compare the',
  'Sort the',
  'Filter the',
  'Group the',
  'Format the',
  'Serialize the',
  'Deserialize the',
  'Encode the',
  'Decode the',
  'Compress the',
  'Generate a',
  'Generate random',
  'Generate unique',
];

// Get suggestion based on current input
function getSuggestion(input: string, previousPrompts: string[]): string | null {
  if (!input || input.length < 2) return null;

  const lowerInput = input.toLowerCase();

  // 1. Check if full input matches previous prompts (highest priority)
  for (const prompt of previousPrompts) {
    if (prompt.toLowerCase().startsWith(lowerInput) && prompt.length > input.length) {
      return prompt.slice(input.length);
    }
  }

  // 2. Check if full input matches common patterns
  for (const pattern of COMMON_PATTERNS) {
    if (pattern.toLowerCase().startsWith(lowerInput) && pattern.length > input.length) {
      return pattern.slice(input.length);
    }
  }

  // 3. Smart mid-sentence matching: check last N words against pattern starts
  // Split by whitespace and get trailing portion
  const words = input.split(/\s+/);
  if (words.length >= 1) {
    // Try matching from the last 1, 2, 3, 4, 5 words
    for (let wordsToMatch = Math.min(5, words.length); wordsToMatch >= 1; wordsToMatch--) {
      const lastWords = words.slice(-wordsToMatch).join(' ');
      const lowerLastWords = lastWords.toLowerCase();

      // Skip very short matches (less than 2 chars)
      if (lowerLastWords.length < 2) continue;

      // Check patterns that start with these last words
      for (const pattern of COMMON_PATTERNS) {
        const lowerPattern = pattern.toLowerCase();
        if (lowerPattern.startsWith(lowerLastWords) && pattern.length > lastWords.length) {
          // Return only the completion part
          return pattern.slice(lastWords.length);
        }
      }
    }
  }

  // 4. Check if input ends with a trigger word that commonly precedes patterns
  const triggerEndings = [
    { trigger: ' to ', patterns: ['add', 'fix', 'update', 'remove', 'create', 'implement', 'refactor'] },
    { trigger: ' the ', patterns: ['bug', 'code', 'function', 'component', 'error', 'issue', 'test'] },
    { trigger: ' a ', patterns: ['function', 'component', 'test', 'method', 'class', 'hook', 'button', 'form'] },
    { trigger: ' for ', patterns: ['the', 'this', 'user', 'error', 'authentication', 'validation'] },
    { trigger: ' with ', patterns: ['the', 'a', 'error', 'async', 'proper'] },
    { trigger: ' in ', patterns: ['the', 'this', 'my'] },
  ];

  for (const { trigger, patterns } of triggerEndings) {
    if (lowerInput.endsWith(trigger)) {
      // Suggest the first common word that follows this trigger
      return patterns[0];
    }
  }

  return null;
}

interface ChatInputProps {
  onMessageSubmit?: () => void;
}

export function ChatInput({ onMessageSubmit }: ChatInputProps) {
  const [message, setMessage] = useState('');
  const [selectedModel, setSelectedModel] = useState(MODELS[0]);
  const [isSending, setIsSending] = useState(false);
  const [isApproving, setIsApproving] = useState(false);
  const [approvalError, setApprovalError] = useState<string | null>(null);
  const [thinkingEnabled, setThinkingEnabled] = useState(false);
  const [planModeEnabled, setPlanModeEnabled] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const ghostTextRef = useRef<HTMLSpanElement>(null);

  const {
    selectedConversationId,
    selectedWorkspaceId,
    selectedSessionId,
    conversations,
    streamingState,
    addMessage,
    addConversation,
    removeConversation,
    updateConversation,
    selectConversation,
    setStreaming,
    setAwaitingPlanApproval,
  } = useAppStore();

  // Get current conversation
  const currentConversation = conversations.find((c) => c.id === selectedConversationId);

  // Get all messages for the current session to extract previous user prompts
  const allMessages = useAppStore((s) => s.messages);
  const sessionConversationIds = useMemo(
    () => new Set(conversations.filter((c) => c.sessionId === selectedSessionId).map((c) => c.id)),
    [conversations, selectedSessionId]
  );
  const previousPrompts = useMemo(() => {
    // Get unique user messages from this session, most recent first
    const userMessages = allMessages
      .filter((m) => m.role === 'user' && sessionConversationIds.has(m.conversationId))
      .map((m) => m.content)
      .reverse();
    // Deduplicate while preserving order
    return [...new Set(userMessages)].slice(0, 50); // Keep last 50 unique prompts
  }, [allMessages, sessionConversationIds]);

  // Calculate suggestion when message changes
  useEffect(() => {
    const newSuggestion = getSuggestion(message, previousPrompts);
    setSuggestion(newSuggestion);
  }, [message, previousPrompts]);

  // Check if currently streaming
  const isStreaming = selectedConversationId
    ? streamingState[selectedConversationId]?.isStreaming
    : false;

  // Check if awaiting plan approval
  const awaitingPlanApproval = selectedConversationId
    ? streamingState[selectedConversationId]?.awaitingPlanApproval
    : false;

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  }, [message]);

  // Listen for drag-drop events from Tauri
  useEffect(() => {
    let unlistenDrop: (() => void) | undefined;
    let unlistenEnter: (() => void) | undefined;
    let unlistenLeave: (() => void) | undefined;

    const setupListeners = async () => {
      unlistenDrop = await listenForFileDrop(() => {
        // File attachments not yet implemented - just clear drag state
        setIsDragOver(false);
      });
      unlistenEnter = await listenForDragEnter(() => {
        setIsDragOver(true);
      });
      unlistenLeave = await listenForDragLeave(() => {
        setIsDragOver(false);
      });
    };

    setupListeners();

    return () => {
      unlistenDrop?.();
      unlistenEnter?.();
      unlistenLeave?.();
    };
  }, []);

  // Handler for toggling plan mode - also notifies the backend
  const handlePlanModeToggle = useCallback(async () => {
    const newValue = !planModeEnabled;
    setPlanModeEnabled(newValue);

    // If there's an active conversation, notify the backend
    if (selectedConversationId && isStreaming) {
      try {
        await setConversationPlanMode(selectedConversationId, newValue);
      } catch (error) {
        console.error('Failed to set plan mode:', error);
        // Revert UI state on failure so it stays in sync with backend
        setPlanModeEnabled(!newValue);
      }
    }
  }, [planModeEnabled, selectedConversationId, isStreaming]);

  // Handle plan approval
  const handleApprovePlan = useCallback(async () => {
    if (!selectedConversationId || !awaitingPlanApproval || isApproving) return;

    setIsApproving(true);
    setApprovalError(null);
    try {
      await approvePlan(selectedConversationId);
      // The WebSocket will clear awaitingPlanApproval when tool_end is received
    } catch (error) {
      console.error('Failed to approve plan:', error);
      setApprovalError(error instanceof Error ? error.message : 'Failed to approve plan');
    } finally {
      setIsApproving(false);
    }
  }, [selectedConversationId, awaitingPlanApproval, isApproving]);

  // Handle hand off - dismisses the approval UI locally without approving.
  // The agent continues waiting; user can still send feedback via the input.
  // This allows the user to hide the approval bar while composing a longer response.
  const handleHandOff = useCallback(() => {
    if (!selectedConversationId) return;
    setAwaitingPlanApproval(selectedConversationId, false);
    setApprovalError(null);
  }, [selectedConversationId, setAwaitingPlanApproval]);

  // Global keyboard shortcuts

  useEffect(() => {
    const handleGlobalKeyDown = (e: globalThis.KeyboardEvent) => {
      // Cmd+L to focus input
      if (e.code === 'KeyL' && (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        textareaRef.current?.focus();
      }
      // Alt+T to toggle thinking mode
      if (e.code === 'KeyT' && e.altKey && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
        e.preventDefault();
        setThinkingEnabled(prev => !prev);
      }
      // Shift+Tab to toggle plan mode
      if (e.code === 'Tab' && e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        handlePlanModeToggle();
      }
      // Note: Cmd+Shift+Enter for plan approval is handled in handleKeyDown on the textarea
    };

    // Handle menu events from native Tauri menu
    const handleFocusInput = () => textareaRef.current?.focus();
    const handleToggleThinking = () => setThinkingEnabled(prev => !prev);
    const handleTogglePlanMode = () => handlePlanModeToggle();

    document.addEventListener('keydown', handleGlobalKeyDown);
    window.addEventListener('focus-input', handleFocusInput);
    window.addEventListener('toggle-thinking', handleToggleThinking);
    window.addEventListener('toggle-plan-mode', handleTogglePlanMode);
    return () => {
      document.removeEventListener('keydown', handleGlobalKeyDown);
      window.removeEventListener('focus-input', handleFocusInput);
      window.removeEventListener('toggle-thinking', handleToggleThinking);
      window.removeEventListener('toggle-plan-mode', handleTogglePlanMode);
    };
  }, [handlePlanModeToggle]);

  const handleSubmit = async () => {
    if (!message.trim() || !selectedWorkspaceId || !selectedSessionId || isSending || isStreaming) return;

    const content = message.trim();
    setMessage('');
    setIsSending(true);

    // Notify parent to scroll to bottom when user submits a message
    onMessageSubmit?.();
    window.dispatchEvent(new CustomEvent('chat-message-submitted'));

    try {
      // Check if this is a new conversation (no messages yet) or no conversation selected
      // In either case, we need to create via API since local conversations don't exist on backend
      const conversationMessages = currentConversation
        ? useAppStore.getState().messages.filter(m => m.conversationId === currentConversation.id)
        : [];
      const isNewConversation = !selectedConversationId || conversationMessages.length === 0;

      if (isNewConversation) {
        // Create new conversation with initial message via API
        const convType = currentConversation?.type || 'task';
        const conv = await createConversation(selectedWorkspaceId, selectedSessionId, {
          type: convType,
          message: content,
          // Pass thinking tokens when thinking mode is enabled
          maxThinkingTokens: thinkingEnabled ? DEFAULT_THINKING_TOKENS : undefined,
        });

        // Remove local placeholder conversation if it exists
        if (selectedConversationId && selectedConversationId !== conv.id) {
          removeConversation(selectedConversationId);
        }

        // Add/update conversation in store with backend ID
        addConversation({
          id: conv.id,
          sessionId: conv.sessionId,
          type: conv.type,
          name: conv.name,
          status: conv.status,
          messages: [],
          toolSummary: [],
          createdAt: conv.createdAt,
          updatedAt: conv.updatedAt,
        });

        // Add user message to store
        addMessage({
          id: crypto.randomUUID(),
          conversationId: conv.id,
          role: 'user',
          content,
          timestamp: new Date().toISOString(),
        });

        // Select the new conversation
        selectConversation(conv.id);

        // Mark as streaming
        setStreaming(conv.id, true);
      } else {
        // Add user message to store first
        addMessage({
          id: crypto.randomUUID(),
          conversationId: selectedConversationId,
          role: 'user',
          content,
          timestamp: new Date().toISOString(),
        });

        // Mark as streaming
        setStreaming(selectedConversationId, true);

        // Send message to existing conversation
        await sendConversationMessage(selectedConversationId, content);
      }
    } catch (error) {
      console.error('Failed to send message:', error);
      const convId = selectedConversationId;
      if (convId) {
        addMessage({
          id: crypto.randomUUID(),
          conversationId: convId,
          role: 'assistant',
          content: `Error: ${error instanceof Error ? error.message : 'Failed to send message'}`,
          timestamp: new Date().toISOString(),
        });
        setStreaming(convId, false);
      }
    } finally {
      setIsSending(false);
    }
  };

  const handleStop = async () => {
    if (!selectedConversationId || !isStreaming) return;

    try {
      await stopConversation(selectedConversationId);
      setStreaming(selectedConversationId, false);
      updateConversation(selectedConversationId, { status: 'idle' });
    } catch (error) {
      console.error('Failed to stop conversation:', error);
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Tab to accept suggestion
    if (e.key === 'Tab' && suggestion && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      setMessage(message + suggestion);
      setSuggestion(null);
      return;
    }
    // ⌘⇧↵ to approve plan
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && e.shiftKey && awaitingPlanApproval) {
      e.preventDefault();
      handleApprovePlan();
      return;
    }
    // Regular Enter to submit (or send feedback when awaiting approval)
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
    // Escape to dismiss suggestion
    if (e.key === 'Escape' && suggestion) {
      e.preventDefault();
      setSuggestion(null);
    }
  };

  return (
    <div className="pt-1 px-3 pb-3">
      {/* Plan Approval Bar */}
      {awaitingPlanApproval && (
        <div className="space-y-1.5 mb-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">
              Approve the plan (<kbd className="px-1 py-0.5 rounded bg-muted text-xs font-mono">⌘⇧↵</kbd>) or tell the AI what to do differently <kbd className="px-1 py-0.5 rounded bg-muted text-xs font-mono">↵</kbd>
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1.5 text-xs text-muted-foreground"
                onClick={handleHandOff}
                disabled={isApproving}
              >
                <EyeOff className="h-3.5 w-3.5" />
                Hand off
              </Button>
              <Button
                variant="secondary"
                size="sm"
                className="h-7 gap-1.5 text-xs bg-background hover:bg-surface-2"
                onClick={handleApprovePlan}
                disabled={isApproving}
              >
                {isApproving ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <>
                    Approve
                    <kbd className="px-1 py-0.5 rounded bg-muted text-[10px] font-mono">⌘⇧↵</kbd>
                  </>
                )}
              </Button>
            </div>
          </div>
          {approvalError && (
            <div className="text-xs text-destructive">{approvalError}</div>
          )}
        </div>
      )}

      <div className={cn(
        'relative',
        awaitingPlanApproval && 'plan-approval-border'
      )}>
        {/* Animated marching ants border for plan mode */}
        {planModeEnabled && !isStreaming && (
          <svg
            className="absolute -inset-[1px] w-[calc(100%+2px)] h-[calc(100%+2px)] pointer-events-none z-10"
            preserveAspectRatio="none"
          >
            <rect
              x="1"
              y="1"
              width="calc(100% - 2px)"
              height="calc(100% - 2px)"
              rx="8"
              ry="8"
              fill="none"
              stroke="#f59e0b"
              strokeWidth="2"
              strokeDasharray="6 4"
              strokeOpacity="0.6"
              style={{ animation: 'marching-ants-dash 1s linear infinite' }}
            />
          </svg>
        )}
        {/* Gradient border for streaming state (static for performance) */}
        {isStreaming && !awaitingPlanApproval && (
          <div className="absolute -inset-[1px] rounded-lg bg-gradient-to-r from-primary/60 via-purple-500/80 to-primary/60 opacity-70" />
        )}
      {/* Intentional: hardcoded border color for specific visual weight */}
      <div className={cn(
        'relative rounded-lg border border-[#434343] bg-input',
        isStreaming && !awaitingPlanApproval && 'border-transparent',
        awaitingPlanApproval && 'border-transparent',
        planModeEnabled && !isStreaming && 'border-transparent',
        isDragOver && 'ring-2 ring-primary ring-offset-2 border-primary'
      )}>
        {/* Drag overlay - file attachments coming soon */}
        {isDragOver && (
          <div className="absolute inset-0 bg-primary/10 rounded-lg flex items-center justify-center z-10 pointer-events-none">
            <div className="flex items-center gap-2 text-muted-foreground font-medium">
              <FileText className="w-5 h-5" />
              File attachments coming soon
            </div>
          </div>
        )}

        {/* Text Input with Cmd+L hint and ghost text */}
        <div className="relative">
          {/* Ghost text overlay - must match textarea styling exactly for proper wrapping */}
          <div
            className="absolute inset-0 px-3 py-2 pointer-events-none overflow-hidden text-base md:text-sm"
            aria-hidden="true"
            style={{
              // Match textarea's default line-height and font
              lineHeight: '1.5',
              fontFamily: 'inherit',
              wordBreak: 'break-word',
              overflowWrap: 'break-word',
            }}
          >
            <span className="whitespace-pre-wrap">
              {/* Invisible text matching user input to position the suggestion */}
              <span className="invisible">{message}</span>
              {/* Ghost suggestion text */}
              {suggestion && (
                <span
                  ref={ghostTextRef}
                  className="text-muted-foreground/40"
                >
                  {suggestion}
                </span>
              )}
            </span>
          </div>
          <Textarea
            ref={textareaRef}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={isStreaming ? "Agent is working..." : "Ask to make changes, @mention files, run /commands"}
            className={cn(
              'min-h-[100px] max-h-[200px] resize-none border-0 focus-visible:ring-0',
              'bg-transparent dark:bg-transparent',
              'placeholder:text-muted-foreground/60',
              // Make textarea background transparent to show ghost text
              'relative z-10'
            )}
            disabled={!selectedSessionId || isSending || isStreaming}
          />
          {/* Cmd+L hint */}
          <div className="absolute top-3 right-3 text-[11px] text-muted-foreground/50 pointer-events-none z-20">
            ⌘L to focus
          </div>
          {/* Tab hint when suggestion is visible */}
          {suggestion && (
            <div className="absolute bottom-3 right-3 text-[11px] text-muted-foreground/50 pointer-events-none z-20">
              Tab to accept
            </div>
          )}
        </div>

        {/* Toolbar inside input */}
        <div className="flex items-center gap-1 px-2 pb-2">
          {/* Model Selector */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-xs">
                <selectedModel.icon className="h-3.5 w-3.5" />
                {selectedModel.name}
                <ChevronDown className="h-3 w-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {MODELS.map((model) => (
                <DropdownMenuItem
                  key={model.id}
                  onClick={() => setSelectedModel(model)}
                >
                  <model.icon className="h-3.5 w-3.5 mr-2" />
                  {model.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Extended Thinking Toggle */}
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              'h-7 w-7',
              thinkingEnabled && 'text-amber-500 hover:text-amber-600 bg-amber-500/10 hover:bg-amber-500/20'
            )}
            onClick={() => setThinkingEnabled(!thinkingEnabled)}
            title={`Extended thinking ${thinkingEnabled ? 'on' : 'off'} (⌥T)`}
            aria-label={`Extended thinking ${thinkingEnabled ? 'on' : 'off'}`}
            aria-pressed={thinkingEnabled}
          >
            <Brain className="h-4 w-4" />
          </Button>

          {/* Plan Mode Toggle */}
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              'h-7 w-7',
              planModeEnabled && 'text-amber-500 hover:text-amber-600 bg-amber-500/10 hover:bg-amber-500/20'
            )}
            onClick={handlePlanModeToggle}
            title={`Plan mode ${planModeEnabled ? 'on' : 'off'} (⇧Tab)`}
            aria-label={`Plan mode ${planModeEnabled ? 'on' : 'off'}`}
            aria-pressed={planModeEnabled}
          >
            <BookOpen className="h-4 w-4" />
          </Button>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Plus Menu */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Add attachment or link">
                <Plus className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem>
                <Paperclip className="h-4 w-4 mr-2" />
                Add attachment
                <span className="ml-auto text-xs text-muted-foreground">⌘U</span>
              </DropdownMenuItem>
              <DropdownMenuItem>
                <Link className="h-4 w-4 mr-2" />
                Link Linear issue
                <span className="ml-auto text-xs text-muted-foreground">⌘I</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem>
                <FolderSymlink className="h-4 w-4 mr-2" />
                Link workspaces
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Stop Button (when streaming) */}
          {isStreaming ? (
            <Button
              size="icon"
              variant="destructive"
              className="h-8 w-8 rounded-full"
              onClick={handleStop}
              aria-label="Stop agent"
            >
              <Square className="h-4 w-4" />
            </Button>
          ) : (
            /* Send Button */
            <Button
              size="icon"
              className={cn(
                'h-8 w-8 rounded-full',
                (!message.trim() || isSending) && 'opacity-50'
              )}
              onClick={handleSubmit}
              disabled={!message.trim() || !selectedSessionId || isSending}
              aria-label="Send message"
            >
              <ArrowUp className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
      </div>
    </div>
  );
}
