'use client';

import { useState, useRef, useEffect, KeyboardEvent } from 'react';
import { useAppStore } from '@/stores/appStore';
import { spawnAgent } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Snowflake,
  ChevronDown,
  Paperclip,
  Trash2,
  ArrowUp,
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
  const [isLoading, setIsLoading] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const {
    selectedConversationId,
    selectedWorkspaceId,
    selectedSessionId,
    sessions,
    addMessage,
    updateSession,
    updateConversation,
    conversations,
  } = useAppStore();

  // Get current session to check its status
  const currentSession = sessions.find((s) => s.id === selectedSessionId);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  }, [message]);

  const handleSubmit = async () => {
    if (!message.trim() || !selectedConversationId || !selectedWorkspaceId || isLoading) return;

    const task = message.trim();

    const userMessage = {
      id: crypto.randomUUID(),
      conversationId: selectedConversationId,
      role: 'user' as const,
      content: task,
      timestamp: new Date().toISOString(),
    };

    addMessage(userMessage);
    setMessage('');
    setIsLoading(true);

    try {
      // Check if this is an idle session (first message spawns the agent)
      if (currentSession && currentSession.status === 'idle') {
        // Spawn agent via backend API
        const agent = await spawnAgent(selectedWorkspaceId, task);

        // Update existing session with agent details
        updateSession(currentSession.id, {
          id: agent.id, // Update to backend-assigned ID
          worktreePath: agent.worktree,
          task: agent.task,
          status: agent.status === 'running' ? 'active' : 'idle',
          updatedAt: new Date().toISOString(),
        });

        // Update conversation title based on task
        updateConversation(selectedConversationId, {
          title: task.slice(0, 50) + (task.length > 50 ? '...' : ''),
          updatedAt: new Date().toISOString(),
        });
      }
      // For active sessions, the message is sent via WebSocket (to be implemented)
      // For now, we just add the message to the conversation

      // The response will stream via WebSocket
      // WebSocket hook will add assistant messages as output arrives
    } catch (error) {
      console.error('Failed to spawn agent:', error);
      addMessage({
        id: crypto.randomUUID(),
        conversationId: selectedConversationId,
        role: 'assistant' as const,
        content: `Error: ${error instanceof Error ? error.message : 'Failed to spawn agent'}`,
        timestamp: new Date().toISOString(),
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="p-4">
      <div className="rounded-lg border bg-muted/50">
        {/* Text Input */}
        <Textarea
          ref={textareaRef}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask to make changes, @mention files, run /commands"
          className={cn(
            'min-h-[100px] max-h-[200px] resize-none border-0 focus-visible:ring-0',
            'bg-transparent dark:bg-transparent',
            'placeholder:text-muted-foreground/60'
          )}
          disabled={!selectedConversationId || isLoading}
        />

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

          {/* Attachment Button */}
          <Button variant="ghost" size="icon" className="h-7 w-7">
            <Paperclip className="h-3.5 w-3.5" />
          </Button>

          {/* Clear Button */}
          <Button variant="ghost" size="icon" className="h-7 w-7">
            <Trash2 className="h-3.5 w-3.5" />
          </Button>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Send Button */}
          <Button
            size="icon"
            className={cn(
              'h-8 w-8 rounded-full',
              (!message.trim() || isLoading) && 'opacity-50'
            )}
            onClick={handleSubmit}
            disabled={!message.trim() || !selectedConversationId || isLoading}
          >
            <ArrowUp className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
