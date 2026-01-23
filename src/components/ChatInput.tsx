'use client';

import { useState, useRef, useEffect, useCallback, KeyboardEvent } from 'react';
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
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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
  };

  return (
    <div className="pt-1 px-4 pb-4">
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
                className="h-7 gap-1.5 text-xs bg-background hover:bg-muted"
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
        {/* Gradient border for streaming state (static for performance) */}
        {isStreaming && !awaitingPlanApproval && (
          <div className="absolute -inset-[1px] rounded-lg bg-gradient-to-r from-primary/60 via-purple-500/80 to-primary/60 opacity-70" />
        )}
      <div className={cn(
        'relative rounded-lg border backdrop-blur-sm bg-surface-1/50 transition-all duration-200',
        isStreaming && !awaitingPlanApproval && 'border-transparent',
        awaitingPlanApproval && 'border-transparent',
        !isStreaming && !awaitingPlanApproval && 'hover:bg-surface-2/50 focus-within:ring-2 focus-within:ring-primary/20 focus-within:border-primary/50',
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

        {/* Text Input with Cmd+L hint */}
        <div className="relative">
          <Textarea
            ref={textareaRef}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={isStreaming ? "Agent is working..." : "Ask to make changes, @mention files, run /commands"}
            className={cn(
              'min-h-[100px] max-h-[200px] resize-none border-0 focus-visible:ring-0',
              'bg-transparent dark:bg-transparent',
              'placeholder:text-muted-foreground/60'
            )}
            disabled={!selectedSessionId || isSending || isStreaming}
          />
          {/* Cmd+L hint */}
          <div className="absolute top-3 right-3 text-[11px] text-muted-foreground/50 pointer-events-none">
            ⌘L to focus
          </div>
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
