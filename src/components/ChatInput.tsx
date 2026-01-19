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
  FileText,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { listenForFileDrop, listenForDragEnter, listenForDragLeave } from '@/lib/tauri';
import { useSpeechRecognition } from '@/hooks/useSpeechRecognition';
import { DictationButton } from '@/components/DictationButton';
import { DictationOverlay } from '@/components/DictationOverlay';

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
  const [droppedFiles, setDroppedFiles] = useState<string[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Speech recognition
  const {
    isListening,
    isAvailable: speechAvailable,
    interimText,
    finalText,
    soundLevel,
    toggleListening,
    stopListening,
  } = useSpeechRecognition();

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

  // Insert transcribed text when speech recognition completes
  useEffect(() => {
    if (finalText) {
      setMessage((prev) => {
        // Insert at cursor position or append
        const textarea = textareaRef.current;
        if (textarea) {
          const start = textarea.selectionStart;
          const end = textarea.selectionEnd;
          const before = prev.slice(0, start);
          const after = prev.slice(end);
          const separator = before && !before.endsWith(' ') ? ' ' : '';
          return before + separator + finalText + after;
        }
        return prev + (prev ? ' ' : '') + finalText;
      });
    }
  }, [finalText]);

  // Handle ESC key to exit speech mode
  useEffect(() => {
    if (!isListening) return;

    const handleEscape = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        stopListening();
      }
    };

    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [isListening, stopListening]);

  // Listen for drag-drop events from Tauri
  useEffect(() => {
    let unlistenDrop: (() => void) | undefined;
    let unlistenEnter: (() => void) | undefined;
    let unlistenLeave: (() => void) | undefined;

    const setupListeners = async () => {
      unlistenDrop = await listenForFileDrop((paths) => {
        setDroppedFiles((prev) => [...prev, ...paths]);
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
      // Cmd+Shift+D to toggle dictation
      if (e.code === 'KeyD' && (e.metaKey || e.ctrlKey) && e.shiftKey && !e.altKey) {
        e.preventDefault();
        if (speechAvailable && !isStreaming) {
          toggleListening();
        }
      }
    };

    // Handle menu events from native Tauri menu
    const handleFocusInput = () => textareaRef.current?.focus();
    const handleToggleThinking = () => setThinkingEnabled(prev => !prev);
    const handleTogglePlanMode = () => setPlanModeEnabled(prev => !prev);

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
  }, [speechAvailable, isStreaming, toggleListening]);

  const handleSubmit = async () => {
    if (!message.trim() || !selectedWorkspaceId || !selectedSessionId || isSending || isStreaming) return;

    const content = message.trim();
    const attachedFiles = [...droppedFiles];
    setMessage('');
    setDroppedFiles([]);
    setIsSending(true);

    // TODO: Include attachedFiles in message when backend supports it
    console.log('Attached files:', attachedFiles);

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

  const removeDroppedFile = (index: number) => {
    setDroppedFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const getFileName = (path: string) => {
    return path.split('/').pop() || path;
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
        isStreaming && 'border-transparent',
        isDragOver && 'ring-2 ring-primary ring-offset-2 border-primary',
        isListening && 'shadow-[inset_0_4px_8px_-2px_rgba(16,185,129,0.15)]'
      )}>
        {/* Dictation overlay */}
        {isListening && (
          <DictationOverlay
            soundLevel={soundLevel}
            onStop={stopListening}
          />
        )}

        {/* Drag overlay */}
        {isDragOver && (
          <div className="absolute inset-0 bg-primary/10 rounded-lg flex items-center justify-center z-10 pointer-events-none">
            <div className="flex items-center gap-2 text-primary font-medium">
              <FileText className="w-5 h-5" />
              Drop files to attach
            </div>
          </div>
        )}

        {/* Dropped files chips */}
        {droppedFiles.length > 0 && (
          <div className="flex flex-wrap gap-1.5 px-3 pt-3">
            {droppedFiles.map((file, index) => (
              <div
                key={`${file}-${index}`}
                className="flex items-center gap-1.5 px-2 py-1 bg-muted rounded-md text-xs"
              >
                <FileText className="w-3 h-3 text-muted-foreground" />
                <span className="max-w-32 truncate" title={file}>
                  {getFileName(file)}
                </span>
                <button
                  type="button"
                  onClick={() => removeDroppedFile(index)}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Text Input with Cmd+L hint */}
        <div className="relative">
          <Textarea
            ref={textareaRef}
            value={isListening && interimText ? message + (message ? ' ' : '') + interimText : message}
            onChange={(e) => !isListening && setMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={isStreaming ? "Agent is working..." : isListening ? "Listening..." : "Ask to make changes, @mention files, run /commands"}
            className={cn(
              'min-h-[100px] max-h-[200px] resize-none border-0 focus-visible:ring-0',
              'bg-transparent dark:bg-transparent',
              'placeholder:text-muted-foreground/60',
              isListening && 'text-emerald-600 dark:text-emerald-400'
            )}
            disabled={!selectedSessionId || isSending || isStreaming}
            readOnly={isListening}
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

          {/* Dictation Button */}
          <DictationButton
            isListening={isListening}
            isAvailable={speechAvailable}
            disabled={isStreaming || !selectedSessionId}
            onClick={toggleListening}
          />

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
