'use client';

import { useState, useRef, useEffect, KeyboardEvent, useImperativeHandle, forwardRef } from 'react';
import { useAppStore } from '@/stores/appStore';
import { createConversation, sendConversationMessage, stopConversation } from '@/lib/api';
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
} from 'lucide-react';
import { cn } from '@/lib/utils';

const MODELS = [
  { id: 'opus-4.5', name: 'Opus 4.5', icon: Snowflake },
  { id: 'sonnet-4', name: 'Sonnet 4', icon: Snowflake },
  { id: 'haiku-3.5', name: 'Haiku 3.5', icon: Snowflake },
];

export function ChatInput() {
  const [message, setMessage] = useState('');
  const [selectedModel, setSelectedModel] = useState(MODELS[0]);
  const [isSending, setIsSending] = useState(false);
  const [thinkingEnabled, setThinkingEnabled] = useState(false);
  const [planModeEnabled, setPlanModeEnabled] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const {
    selectedConversationId,
    selectedWorkspaceId,
    selectedSessionId,
    sessions,
    conversations,
    streamingState,
    addMessage,
    addConversation,
    removeConversation,
    updateConversation,
    selectConversation,
    setStreaming,
  } = useAppStore();

  // Get current session and conversation
  const currentSession = sessions.find((s) => s.id === selectedSessionId);
  const currentConversation = conversations.find((c) => c.id === selectedConversationId);

  // Check if currently streaming
  const isStreaming = selectedConversationId
    ? streamingState[selectedConversationId]?.isStreaming
    : false;

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  }, [message]);

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
        setPlanModeEnabled(prev => !prev);
      }
    };
    document.addEventListener('keydown', handleGlobalKeyDown);
    return () => document.removeEventListener('keydown', handleGlobalKeyDown);
  }, []);

  const handleSubmit = async () => {
    if (!message.trim() || !selectedWorkspaceId || !selectedSessionId || isSending || isStreaming) return;

    const content = message.trim();
    setMessage('');
    setIsSending(true);

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
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="pt-1 px-4 pb-4">
      <div className={cn(
        'relative',
        isStreaming && 'streaming-border'
      )}>
        {isStreaming && (
          <svg className="streaming-border-svg">
            <rect
              x="1"
              y="1"
              rx="8"
              ry="8"
              style={{ width: 'calc(100% - 2px)', height: 'calc(100% - 2px)' }}
            />
          </svg>
        )}
      <div className={cn(
        'rounded-lg border bg-muted/50',
        isStreaming && 'border-transparent'
      )}>
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
            onClick={() => setPlanModeEnabled(!planModeEnabled)}
            title={`Plan mode ${planModeEnabled ? 'on' : 'off'} (⇧Tab)`}
          >
            <BookOpen className="h-4 w-4" />
          </Button>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Plus Menu */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7">
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
