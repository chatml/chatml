'use client';

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useAppStore } from '@/stores/appStore';
import { createConversation, sendConversationMessage, stopConversation, setConversationPlanMode, approvePlan } from '@/lib/api';
import { Button } from '@/components/ui/button';
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
  RotateCcw,
  Loader2,
  Upload,
  ScrollText,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useClaudeAuthStatus } from '@/hooks/useClaudeAuthStatus';
import { ContextMeter } from './ContextMeter';
import { useToast } from '@/components/ui/toast';
import { listenForFileDrop, listenForDragEnter, listenForDragLeave, openFileDialog } from '@/lib/tauri';
import type { Attachment } from '@/lib/types';
import { AttachmentGrid } from './AttachmentGrid';
import { processDroppedFiles, validateAttachments, SUPPORTED_EXTENSIONS, loadAllAttachmentContents, generateAttachmentId } from '@/lib/attachments';
import { UserQuestionPrompt } from './UserQuestionPrompt';
import { usePendingUserQuestion } from '@/stores/selectors';
import { useSettingsStore, type EffortLevel } from '@/stores/settingsStore';
import { useSlashCommandStore, type UnifiedSlashCommand } from '@/stores/slashCommandStore';
import { SummaryPicker } from './SummaryPicker';
import { PlateInput, type PlateInputHandle } from './PlateInput';
import type { MentionItem } from '@/components/ui/mention-node';
import { listSessionFiles, type FileNodeDTO } from '@/lib/api';

// Flat file type for mention items
interface FlatFile {
  path: string;
  name: string;
  directory: string;
}

// Helper to flatten file tree for mentions (excludes hidden directories)
function flattenFileTree(nodes: FileNodeDTO[], parentPath: string = ''): FlatFile[] {
  const result: FlatFile[] = [];
  for (const node of nodes) {
    // Skip hidden files and directories (starting with .)
    if (node.name.startsWith('.')) continue;

    if (node.isDir) {
      if (node.children) {
        result.push(...flattenFileTree(node.children, node.path));
      }
    } else {
      const directory = parentPath || node.path.split('/').slice(0, -1).join('/');
      result.push({ path: node.path, name: node.name, directory });
    }
  }
  return result;
}

const MODELS = [
  { id: 'claude-opus-4-6', name: 'Claude Opus 4.6', icon: Snowflake, supportsThinking: true, supportsEffort: true, badge: 'NEW' as const },
  { id: 'claude-sonnet-4-5-20250929', name: 'Claude Sonnet 4.5', icon: Snowflake, supportsThinking: true, supportsEffort: false },
  { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5', icon: Snowflake, supportsThinking: true, supportsEffort: false },
];

// Effort levels for models that support the effort parameter (Opus 4.6+)
const EFFORT_LEVELS: { id: EffortLevel; label: string }[] = [
  { id: 'low', label: 'Low' },
  { id: 'medium', label: 'Medium' },
  { id: 'high', label: 'High' },
  { id: 'max', label: 'Max' },
];

// Models that support extended thinking mode (derived from MODELS)
const THINKING_SUPPORTED_MODELS = new Set(
  MODELS.filter((m) => m.supportsThinking).map((m) => m.id)
);

interface ChatInputProps {
  onMessageSubmit?: () => void;
}

export function ChatInput({ onMessageSubmit }: ChatInputProps) {
  const claudeAuthConfigured = useClaudeAuthStatus();
  const authDisabled = claudeAuthConfigured === false;
  const [message, setMessage] = useState('');
  // Read store defaults once at mount time — these initialize per-conversation
  // state and intentionally don't sync if the user changes settings mid-session.
  const defaultModel = useSettingsStore((s) => s.defaultModel);
  const defaultThinking = useSettingsStore((s) => s.defaultThinking);
  const [selectedModel, setSelectedModel] = useState(
    () => MODELS.find((m) => m.id === defaultModel) ?? MODELS[0]
  );
  const [isSending, setIsSending] = useState(false);
  const [isApproving, setIsApproving] = useState(false);
  const [approvalError, setApprovalError] = useState<string | null>(null);
  const [thinkingEnabled, setThinkingEnabled] = useState(defaultThinking);
  const maxThinkingTokens = useSettingsStore((s) => s.maxThinkingTokens);
  const thinkingSupported = THINKING_SUPPORTED_MODELS.has(selectedModel.id);
  const defaultEffort = useSettingsStore((s) => s.defaultEffort);
  const [effortLevel, setEffortLevel] = useState<EffortLevel>(defaultEffort);
  const effortSupported = selectedModel.supportsEffort;
  const defaultPlanMode = useSettingsStore((s) => s.defaultPlanMode);
  const [planModeEnabled, setPlanModeEnabled] = useState(defaultPlanMode);
  const sendWithEnter = useSettingsStore((s) => s.sendWithEnter);
  const autoConvertLongText = useSettingsStore((s) => s.autoConvertLongText);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [summaryPickerOpen, setSummaryPickerOpen] = useState(false);
  const [selectedSummaryIds, setSelectedSummaryIds] = useState<string[]>([]);
  const plateInputRef = useRef<PlateInputHandle>(null);

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
    setQueuedMessage,
    commitQueuedMessage,
    clearPendingPlanApproval,
    clearActiveTools,
  } = useAppStore();
  const hasQueuedMessage = useAppStore(
    (s) => selectedConversationId ? s.queuedMessage[selectedConversationId] != null : false
  );
  const { error: showError, info: showInfo } = useToast();

  // File mentions for Plate editor
  const [mentionItems, setMentionItems] = useState<MentionItem[]>([]);
  const [mentionItemsLoading, setMentionItemsLoading] = useState(false);
  const mentionSessionRef = useRef<string | null>(null);

  // Load files when session changes
  useEffect(() => {
    if (!selectedWorkspaceId || !selectedSessionId) {
      setMentionItems([]);
      return;
    }
    if (mentionSessionRef.current === selectedSessionId) return;

    const loadFiles = async () => {
      setMentionItemsLoading(true);
      try {
        const files = await listSessionFiles(selectedWorkspaceId, selectedSessionId, 'all');
        const flatFiles = flattenFileTree(files);
        setMentionItems(flatFiles.map(f => ({
          key: f.path,
          text: f.name,
          data: { path: f.path, directory: f.directory },
        })));
        mentionSessionRef.current = selectedSessionId;
      } catch (err) {
        console.error('Failed to load files for mentions:', err);
        setMentionItems([]);
      } finally {
        setMentionItemsLoading(false);
      }
    };
    loadFiles();
  }, [selectedWorkspaceId, selectedSessionId]);

  // Get current conversation
  const currentConversation = conversations.find((c) => c.id === selectedConversationId);

  // Restore per-conversation model when switching conversations
  const currentConversationModel = currentConversation?.model;
  useEffect(() => {
    if (currentConversationModel) {
      const found = MODELS.find((m) => m.id === currentConversationModel);
      if (found) setSelectedModel(found);
    } else {
      // Reset to default when conversation has no saved model
      setSelectedModel(MODELS.find((m) => m.id === defaultModel) ?? MODELS[0]);
    }
  }, [selectedConversationId, currentConversationModel, defaultModel]);

  // Derive available slash commands from store
  const getAllCommands = useSlashCommandStore((s) => s.getAllCommands);
  const installedSkills = useSlashCommandStore((s) => s.installedSkills);
  const userCommands = useSlashCommandStore((s) => s.userCommands);
  const slashCommands = useMemo(
    () => getAllCommands({ hasSession: selectedSessionId !== null }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- need to recompute when skills/commands change
    [getAllCommands, selectedSessionId, installedSkills, userCommands]
  );

  // sendMessage: programmatically set text and trigger submit
  const pendingSubmitRef = useRef<string | null>(null);
  const sendMessage = useCallback((text: string) => {
    plateInputRef.current?.setText(text);
    setMessage(text);
    pendingSubmitRef.current = text;
  }, []);

  // Process pending programmatic submit
  useEffect(() => {
    if (pendingSubmitRef.current !== null) {
      pendingSubmitRef.current = null;
      const timer = setTimeout(() => {
        handleSubmitRef.current?.();
      }, 0);
      return () => clearTimeout(timer);
    }
  });
  const handleSubmitRef = useRef<(() => void) | null>(null);

  // Handle slash command execution from InlineCombobox
  const handleSlashCommandExecute = useCallback((cmd: UnifiedSlashCommand) => {
    if (cmd.executionType === 'action') {
      // Action commands: clear input and fire
      plateInputRef.current?.clear();
      setMessage('');
      cmd.execute({
        setMessage: (msg: string) => {
          plateInputRef.current?.setText(msg);
          setMessage(msg);
        },
        sendMessage,
        conversationId: selectedConversationId,
        sessionId: selectedSessionId,
      });
    } else if (cmd.executionType === 'skill') {
      // Skill commands: insert the trigger text for user to submit
      const text = `/${cmd.trigger}`;
      plateInputRef.current?.setText(text);
      setMessage(text);
    } else {
      // Prompt commands: set the prompt prefix
      cmd.execute({
        setMessage: (msg: string) => {
          plateInputRef.current?.setText(msg);
          setMessage(msg);
        },
        sendMessage,
        conversationId: selectedConversationId,
        sessionId: selectedSessionId,
      });
    }
  }, [sendMessage, selectedConversationId, selectedSessionId]);

  // Fetch user commands when session changes
  const fetchUserCommands = useSlashCommandStore((s) => s.fetchUserCommands);
  const setInstalledSkills = useSlashCommandStore((s) => s.setInstalledSkills);
  // Note: installedSkills and userCommands are subscribed above for slashCommands derivation
  useEffect(() => {
    if (selectedWorkspaceId && selectedSessionId) {
      fetchUserCommands(selectedWorkspaceId, selectedSessionId);
    }
  }, [selectedWorkspaceId, selectedSessionId, fetchUserCommands]);

  // Sync catalog skills into slash command store (re-fetch on session change)
  useEffect(() => {
    const abortController = new AbortController();
    const syncSkills = async () => {
      try {
        const { listSkills } = await import('@/lib/api');
        const skills = await listSkills(undefined, abortController.signal);
        setInstalledSkills(skills.filter((s) => s.installed));
      } catch {
        // Skills are optional (also catches AbortError on cleanup)
      }
    };
    syncSkills();
    return () => { abortController.abort(); };
  }, [setInstalledSkills, selectedSessionId]);

  // Check if currently streaming
  const isStreaming = selectedConversationId
    ? streamingState[selectedConversationId]?.isStreaming
    : false;

  // Check if there's a pending plan approval request
  const pendingPlanApproval = selectedConversationId
    ? streamingState[selectedConversationId]?.pendingPlanApproval
    : null;

  // Check if there's a pending user question
  const pendingQuestion = usePendingUserQuestion(selectedConversationId);

  // Handle file drop processing
  const handleFileDrop = useCallback(async (paths: string[]) => {
    setIsDragOver(false);

    const result = await processDroppedFiles(paths);

    // Show errors
    if (result.errors.length > 0) {
      result.errors.forEach(err => showError(err));
    }

    if (result.attachments.length === 0) return;

    // Use functional updater to avoid stale closure over attachments
    let validationError: string | null = null;
    setAttachments(prev => {
      const newAttachments = [...prev, ...result.attachments];
      const validation = validateAttachments(newAttachments);
      if (!validation.valid) {
        validationError = validation.error || 'Invalid attachments';
        return prev;
      }
      return newAttachments;
    });
    if (validationError) showError(validationError);
  }, [showError]);

  // Auto-convert long pasted text to attachment
  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    if (!autoConvertLongText) return;
    const text = e.clipboardData.getData('text/plain');
    if (text.length <= 5000) return;

    e.preventDefault();
    e.stopPropagation();

    const blob = new Blob([text], { type: 'text/plain' });
    const attachment: Attachment = {
      id: generateAttachmentId(),
      type: 'file',
      name: 'pasted-text.txt',
      mimeType: 'text/plain',
      size: blob.size,
      lineCount: text.split('\n').length,
      base64Data: btoa(unescape(encodeURIComponent(text))),
      preview: text.slice(0, 200),
    };

    setAttachments(prev => [...prev, attachment]);
    showInfo(`Long text (${Math.round(text.length / 1000)}k chars) converted to attachment`);
  }, [autoConvertLongText, showInfo]);

  // Handle attachment removal
  const handleRemoveAttachment = useCallback((id: string) => {
    setAttachments(prev => prev.filter(a => a.id !== id));
  }, []);

  // Handle file picker
  const handleOpenFilePicker = useCallback(async () => {
    // Build file extensions filter
    const allExtensions = Object.values(SUPPORTED_EXTENSIONS).flat().map(ext => ext.slice(1)); // Remove leading dot

    const paths = await openFileDialog({
      multiple: true,
      filters: [
        { name: 'Supported Files', extensions: allExtensions },
      ],
      title: 'Select files to attach',
    });

    if (paths && paths.length > 0) {
      await handleFileDrop(paths);
    }
  }, [handleFileDrop]);

  // Listen for drag-drop events from Tauri
  useEffect(() => {
    let isCancelled = false;
    let unlistenDrop: (() => void) | undefined;
    let unlistenEnter: (() => void) | undefined;
    let unlistenLeave: (() => void) | undefined;

    const setupListeners = async () => {
      try {
        const [drop, enter, leave] = await Promise.all([
          listenForFileDrop((paths) => {
            handleFileDrop(paths);
          }),
          listenForDragEnter(() => {
            setIsDragOver(true);
          }),
          listenForDragLeave(() => {
            setIsDragOver(false);
          }),
        ]);

        if (isCancelled) {
          drop();
          enter();
          leave();
          return;
        }

        unlistenDrop = drop;
        unlistenEnter = enter;
        unlistenLeave = leave;
      } catch (error) {
        console.error('Failed to setup drag-drop listeners:', error);
        // Clean up any listeners that were registered before the failure
        unlistenDrop?.();
        unlistenEnter?.();
        unlistenLeave?.();
      }
    };

    setupListeners();

    return () => {
      isCancelled = true;
      unlistenDrop?.();
      unlistenEnter?.();
      unlistenLeave?.();
    };
  }, [handleFileDrop]);

  // Handler for toggling plan mode - also notifies the backend
  const handlePlanModeToggle = useCallback(async () => {
    const newValue = !planModeEnabled;
    setPlanModeEnabled(newValue);

    // If there's an active conversation with a running process, notify the backend
    if (selectedConversationId) {
      try {
        await setConversationPlanMode(selectedConversationId, newValue);
      } catch {
        // Process may not be running (idle between turns) - that's fine,
        // plan mode will be applied when the next message starts
      }
    }
  }, [planModeEnabled, selectedConversationId]);

  // Handle plan approval
  const handleApprovePlan = useCallback(async () => {
    if (!selectedConversationId || !pendingPlanApproval || isApproving) return;

    setIsApproving(true);
    setApprovalError(null);
    try {
      await approvePlan(selectedConversationId, pendingPlanApproval.requestId, true);
      clearPendingPlanApproval(selectedConversationId);
    } catch (error) {
      console.error('Failed to approve plan:', error);
      setApprovalError(error instanceof Error ? error.message : 'Failed to approve plan');
    } finally {
      setIsApproving(false);
    }
  }, [selectedConversationId, pendingPlanApproval, isApproving, clearPendingPlanApproval]);

  // Handle reject - sends denial to the agent so it stays in plan mode
  const handleRejectPlan = useCallback(async () => {
    if (!selectedConversationId || !pendingPlanApproval) return;

    try {
      await approvePlan(selectedConversationId, pendingPlanApproval.requestId, false);
    } catch {
      // Ignore errors - agent may have already timed out
    }
    clearPendingPlanApproval(selectedConversationId);
    setApprovalError(null);
  }, [selectedConversationId, pendingPlanApproval, clearPendingPlanApproval]);

  // Auto-disable thinking when switching to an unsupported model
  useEffect(() => {
    if (thinkingEnabled && !thinkingSupported) {
      setThinkingEnabled(false);
    }
  }, [thinkingSupported, thinkingEnabled]);

  // Auto-reset effort to default when switching to an unsupported model
  useEffect(() => {
    if (!effortSupported && effortLevel !== 'high') {
      setEffortLevel('high');
    }
  }, [effortSupported, effortLevel]);

  // Global keyboard shortcuts

  useEffect(() => {
    const handleGlobalKeyDown = (e: globalThis.KeyboardEvent) => {
      // Cmd+L to focus input
      if (e.code === 'KeyL' && (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        plateInputRef.current?.focus();
      }
      // Alt+T to toggle thinking mode or cycle effort levels
      if (e.code === 'KeyT' && e.altKey && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
        e.preventDefault();
        const model = MODELS.find(m => m.id === selectedModel.id);
        if (model?.supportsEffort) {
          // Opus 4.6: cycle effort levels
          setEffortLevel(prev => {
            const ids = EFFORT_LEVELS.map(l => l.id);
            const idx = ids.indexOf(prev);
            return ids[(idx + 1) % ids.length];
          });
        } else if (THINKING_SUPPORTED_MODELS.has(selectedModel.id)) {
          setThinkingEnabled(prev => !prev);
        }
      }
      // Shift+Tab to toggle plan mode
      if (e.code === 'Tab' && e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        handlePlanModeToggle();
      }
      // Cmd+U to open file picker
      if (e.code === 'KeyU' && (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        handleOpenFilePicker();
      }
      // Note: Cmd+Shift+Enter for plan approval is handled in handleKeyDown on the textarea
    };

    // Handle menu events from native Tauri menu
    const handleFocusInput = () => plateInputRef.current?.focus();
    const handleToggleThinking = () => {
      const model = MODELS.find(m => m.id === selectedModel.id);
      if (model?.supportsEffort) {
        setEffortLevel(prev => {
          const ids = EFFORT_LEVELS.map(l => l.id);
          const idx = ids.indexOf(prev);
          return ids[(idx + 1) % ids.length];
        });
      } else if (THINKING_SUPPORTED_MODELS.has(selectedModel.id)) {
        setThinkingEnabled(prev => !prev);
      }
    };
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
  }, [handlePlanModeToggle, handleOpenFilePicker, selectedModel.id]);

  const handleSubmit = async () => {
    const { text: content, mentionedFiles } = plateInputRef.current?.getContent() ?? { text: '', mentionedFiles: [] };
    if (!content.trim() || !selectedWorkspaceId || !selectedSessionId || isSending || hasQueuedMessage) return;

    // Can't queue a message to a conversation that doesn't exist yet — check before clearing input
    const conversationMessagesEarly = currentConversation
      ? useAppStore.getState().messages.filter(m => m.conversationId === currentConversation.id)
      : [];
    const isNewConversation = !selectedConversationId || conversationMessagesEarly.length === 0;
    if (isNewConversation && isStreaming) return;

    // Clear any pending programmatic submit now that we're executing
    pendingSubmitRef.current = null;

    const trimmedContent = content.trim();
    const currentAttachments = [...attachments];
    plateInputRef.current?.clear();
    setMessage(''); // Keep for suggestion state sync
    // Don't clear attachments yet - wait until API call succeeds
    setIsSending(true);

    // Notify parent to scroll to bottom when user submits a message
    onMessageSubmit?.();
    window.dispatchEvent(new CustomEvent('chat-message-submitted'));

    try {
      // Load base64 content for all attachments before sending
      let loadedAttachments: Attachment[] = [];
      if (currentAttachments.length > 0) {
        try {
          loadedAttachments = await loadAllAttachmentContents(currentAttachments);
        } catch (err) {
          showError(`Failed to load attachment content: ${err instanceof Error ? err.message : 'Unknown error'}`);
          setIsSending(false);
          return;
        }
      }

      if (isNewConversation) {
        // Show immediate feedback on the placeholder conversation while API call is in-flight
        if (selectedConversationId) {
          setStreaming(selectedConversationId, true);
        }

        // Create new conversation with initial message via API
        const convType = currentConversation?.type || 'task';
        const conv = await createConversation(selectedWorkspaceId, selectedSessionId, {
          type: convType,
          message: trimmedContent,
          // Pass selected model so agent uses the correct model
          model: selectedModel.id,
          // Pass plan mode so agent starts in plan mode if toggled on before first message
          planMode: planModeEnabled ? true : undefined,
          // Pass thinking tokens when thinking mode is enabled (non-Opus-4.6 models)
          maxThinkingTokens: !effortSupported && thinkingEnabled ? maxThinkingTokens : undefined,
          // Pass effort level for Opus 4.6 (only when non-default)
          effort: effortSupported && effortLevel !== 'high' ? effortLevel : undefined,
          // Pass attachments with loaded content
          attachments: loadedAttachments.length > 0 ? loadedAttachments : undefined,
          // Pass conversation summary context
          summaryIds: selectedSummaryIds.length > 0 ? selectedSummaryIds : undefined,
        });

        // Clear streaming on placeholder before removing it
        if (selectedConversationId && selectedConversationId !== conv.id) {
          setStreaming(selectedConversationId, false);
          removeConversation(selectedConversationId);
        }

        // Add/update conversation in store with backend ID
        addConversation({
          id: conv.id,
          sessionId: conv.sessionId,
          type: conv.type,
          name: conv.name,
          status: conv.status,
          model: conv.model || selectedModel.id,
          messages: [],
          toolSummary: [],
          createdAt: conv.createdAt,
          updatedAt: conv.updatedAt,
        });

        // Add user message to store (without base64 data to save memory)
        addMessage({
          id: crypto.randomUUID(),
          conversationId: conv.id,
          role: 'user',
          content: trimmedContent,
          attachments: currentAttachments.length > 0 ? currentAttachments : undefined,
          timestamp: new Date().toISOString(),
        });

        // Select the new conversation
        selectConversation(conv.id);

        // Mark as streaming on the real conversation
        setStreaming(conv.id, true);
      } else {
        const messageId = crypto.randomUUID();
        const messageTimestamp = new Date().toISOString();
        const messageAttachments = currentAttachments.length > 0 ? currentAttachments : undefined;

        if (isStreaming) {
          // Queue the message — don't add to messages[] yet (it renders in the footer)
          setQueuedMessage(selectedConversationId, {
            id: messageId,
            content: trimmedContent,
            attachments: messageAttachments,
            timestamp: messageTimestamp,
          });
        } else {
          // Normal path: add user message to store immediately
          addMessage({
            id: messageId,
            conversationId: selectedConversationId,
            role: 'user',
            content: trimmedContent,
            attachments: messageAttachments,
            timestamp: messageTimestamp,
          });
          // Mark as streaming
          setStreaming(selectedConversationId, true);
        }

        // Always send to backend (it queues in agent-runner if busy)
        const modelChanged = selectedModel.id !== currentConversation?.model;
        await sendConversationMessage(
          selectedConversationId,
          trimmedContent,
          loadedAttachments.length > 0 ? loadedAttachments : undefined,
          modelChanged ? selectedModel.id : undefined,
          mentionedFiles.length > 0 ? mentionedFiles : undefined
        );
      }

      // Clear attachments only after successful send
      setAttachments([]);
    } catch (error) {
      console.error('Failed to send message:', error);
      const convId = selectedConversationId;
      if (convId) {
        // Clear any queued message so the UI doesn't get stuck
        setQueuedMessage(convId, null);
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

  // Keep ref in sync for programmatic submit from sendMessage
  handleSubmitRef.current = handleSubmit;

  const handleStop = async () => {
    if (!selectedConversationId || !isStreaming) return;

    try {
      // Commit any queued message to history before stopping
      commitQueuedMessage(selectedConversationId);
      await stopConversation(selectedConversationId);
      setStreaming(selectedConversationId, false);
      updateConversation(selectedConversationId, { status: 'idle' });
      clearActiveTools(selectedConversationId);
    } catch (error) {
      console.error('Failed to stop conversation:', error);
      showError('Failed to stop conversation. Please try again.');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Check if a combobox is active (mention or slash command selection in progress)
    // Check both: focused combobox input OR visible combobox popover (listbox)
    const activeElement = document.activeElement as HTMLElement | null;
    const isInCombobox = activeElement?.closest('[role="combobox"]');
    const hasOpenPopover = document.querySelector('[role="listbox"]');
    if ((isInCombobox || hasOpenPopover) && (e.key === 'Enter' || e.key === 'Tab')) {
      // Let the combobox handle item selection
      return;
    }

    // ⌘⇧↵ to approve plan
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && e.shiftKey && pendingPlanApproval) {
      e.preventDefault();
      handleApprovePlan();
      return;
    }
    // Submit: Enter (default) or Cmd/Ctrl+Enter (if sendWithEnter is off)
    if (e.key === 'Enter') {
      const shouldSubmit = sendWithEnter
        ? !e.shiftKey && !e.metaKey && !e.ctrlKey
        : (e.metaKey || e.ctrlKey) && !e.shiftKey;
      if (shouldSubmit) {
        e.preventDefault();
        handleSubmit();
      }
    }
  };

  // If there's a pending question, show the question UI instead of the normal input
  if (pendingQuestion && selectedConversationId) {
    return <UserQuestionPrompt conversationId={selectedConversationId} />;
  }

  return (
    <div className="pt-1 px-3 pb-3">
      {/* Plan Approval Bar */}
      {pendingPlanApproval && (
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
                onClick={handleRejectPlan}
                disabled={isApproving}
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Request changes
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
                    <kbd className="px-1 py-0.5 rounded bg-muted text-2xs font-mono">⌘⇧↵</kbd>
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
        pendingPlanApproval && 'plan-approval-border'
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
        {isStreaming && !pendingPlanApproval && (
          <div className="absolute -inset-[1px] rounded-lg bg-gradient-to-r from-primary/60 via-purple-500/80 to-primary/60 opacity-70" />
        )}
      <div className={cn(
        'relative rounded-lg border border-border bg-card dark:bg-input',
        isStreaming && !pendingPlanApproval && 'border-transparent',
        pendingPlanApproval && 'border-transparent',
        planModeEnabled && !isStreaming && 'border-transparent',
        isDragOver && 'ring-2 ring-primary ring-offset-2 border-primary'
      )}>
        {/* Drag overlay - drop zone */}
        {isDragOver && (
          <div className="absolute inset-0 bg-background/95 rounded-lg border-2 border-dashed border-primary/50 flex flex-col items-center justify-center z-20 pointer-events-none">
            <Upload className="w-8 h-8 text-muted-foreground mb-2" />
            <span className="font-medium text-foreground">Drop files here</span>
            <span className="text-xs text-muted-foreground mt-1">
              Images, code, and text files (max 5MB each)
            </span>
          </div>
        )}

        {/* Attachment grid */}
        {attachments.length > 0 && (
          <AttachmentGrid
            attachments={attachments}
            onRemove={handleRemoveAttachment}
          />
        )}

        {/* Summary context indicator */}
        {selectedSummaryIds.length > 0 && (
          <div className="px-3 py-1.5 flex items-center gap-2">
            <div className="flex items-center gap-1.5 text-xs text-primary bg-primary/10 px-2 py-1 rounded-md">
              <ScrollText className="size-3" />
              {selectedSummaryIds.length} {selectedSummaryIds.length === 1 ? 'summary' : 'summaries'} attached
              <button
                type="button"
                className="ml-1 hover:text-destructive"
                onClick={() => setSelectedSummaryIds([])}
                aria-label="Remove summaries"
              >
                ×
              </button>
            </div>
          </div>
        )}

        {/* Text Input with Cmd+L hint */}
        <div className="relative px-3 py-2">
          <PlateInput
            ref={plateInputRef}
            placeholder="Describe your task, @ to reference files, / for skills and commands"
            className="bg-transparent dark:bg-transparent relative z-10"
            mentionItems={mentionItems}
            mentionItemsLoading={mentionItemsLoading}
            slashCommands={slashCommands}
            onSlashCommandExecute={handleSlashCommandExecute}
            onInput={(text) => {
              setMessage(text);
            }}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
          />
          {/* Cmd+L hint - hidden when focused */}
          {!isFocused && (
            <div className="absolute top-3 right-3 text-xs text-muted-foreground/50 pointer-events-none z-20">
              ⌘L to focus
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
                  <model.icon className="size-3.5" />
                  {model.name}
                  {'badge' in model && model.badge && (
                    <span className="ml-1.5 rounded-sm bg-emerald-500 px-1.5 py-px text-[10px] font-semibold text-white">
                      {model.badge}
                    </span>
                  )}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Thinking / Effort Control — adapts based on model */}
          {effortSupported ? (
            // Opus 4.6: Effort level dropdown (thinking is implicit via adaptive thinking)
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className={cn(
                    'h-7 gap-1.5 px-2 text-xs',
                    effortLevel !== 'high' && 'text-amber-500 hover:text-amber-600 bg-amber-500/10 hover:bg-amber-500/20'
                  )}
                  title={`Reasoning effort: ${effortLevel} (⌥T to cycle)`}
                  aria-label={`Reasoning effort: ${effortLevel}`}
                >
                  <Brain className="h-4 w-4" />
                  <span className="font-medium capitalize">{effortLevel}</span>
                  <ChevronDown className="h-3 w-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {EFFORT_LEVELS.map((level) => (
                  <DropdownMenuItem
                    key={level.id}
                    onClick={() => setEffortLevel(level.id)}
                  >
                    {level.label}
                    {level.id === 'high' && (
                      <span className="ml-1.5 text-xs text-muted-foreground">(default)</span>
                    )}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            // Non-Opus-4.6 models: Regular thinking toggle
            <Button
              variant="ghost"
              size={thinkingEnabled ? 'sm' : 'icon'}
              className={cn(
                thinkingEnabled ? 'h-7 gap-1.5 px-2' : 'h-7 w-7',
                thinkingEnabled && 'text-amber-500 hover:text-amber-600 bg-amber-500/10 hover:bg-amber-500/20',
                !thinkingSupported && 'opacity-50 cursor-not-allowed'
              )}
              onClick={() => setThinkingEnabled(!thinkingEnabled)}
              disabled={!thinkingSupported}
              title={
                !thinkingSupported
                  ? `Extended thinking not available for ${selectedModel.name}`
                  : `Extended thinking ${thinkingEnabled ? 'on' : 'off'} (⌥T)`
              }
              aria-label={`Extended thinking ${thinkingEnabled ? 'on' : 'off'}`}
              aria-pressed={thinkingEnabled}
            >
              <Brain className="h-4 w-4" />
              {thinkingEnabled && <span className="text-xs font-medium">Thinking</span>}
            </Button>
          )}

          {/* Plan Mode Toggle */}
          <Button
            variant="ghost"
            size={planModeEnabled ? 'sm' : 'icon'}
            className={cn(
              planModeEnabled ? 'h-7 gap-1.5 px-2' : 'h-7 w-7',
              planModeEnabled && 'text-amber-500 hover:text-amber-600 bg-amber-500/10 hover:bg-amber-500/20'
            )}
            onClick={handlePlanModeToggle}
            title={`Plan mode ${planModeEnabled ? 'on' : 'off'} (⇧Tab)`}
            aria-label={`Plan mode ${planModeEnabled ? 'on' : 'off'}`}
            aria-pressed={planModeEnabled}
          >
            <BookOpen className="h-4 w-4" />
            {planModeEnabled && <span className="text-xs font-medium">Plan</span>}
          </Button>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Context Meter */}
          <ContextMeter conversationId={selectedConversationId} />

          {/* Plus Menu */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Add attachment or link">
                <Plus className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={handleOpenFilePicker}>
                <Paperclip className="size-4" />
                Add attachment
                <span className="ml-auto text-xs text-muted-foreground">⌘U</span>
              </DropdownMenuItem>
              <DropdownMenuItem>
                <Link className="size-4" />
                Link Linear issue
                <span className="ml-auto text-xs text-muted-foreground">⌘I</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem>
                <FolderSymlink className="size-4" />
                Link workspaces
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setSummaryPickerOpen(true)}>
                <ScrollText className="size-4" />
                Attach conversation context
                {selectedSummaryIds.length > 0 && (
                  <span className="ml-auto text-xs bg-primary/20 text-primary px-1.5 py-0.5 rounded-full">
                    {selectedSummaryIds.length}
                  </span>
                )}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Stop Button (when streaming) */}
          {isStreaming && (
            <Button
              size="icon"
              variant="destructive"
              className="h-8 w-8 rounded-full"
              onClick={handleStop}
              aria-label="Stop agent"
            >
              <Square className="h-4 w-4" />
            </Button>
          )}
          {/* Send Button — also shown during streaming to queue a message (unless one is already queued) */}
          {(!isStreaming || !hasQueuedMessage) && (
            <Button
              size="icon"
              className={cn(
                'h-8 w-8 rounded-lg',
                (!message.trim() || isSending || hasQueuedMessage) && 'opacity-50'
              )}
              onClick={handleSubmit}
              disabled={!message.trim() || !selectedSessionId || isSending || hasQueuedMessage || authDisabled}
              aria-label={isStreaming ? 'Queue message' : (sendWithEnter ? 'Send message (Enter)' : 'Send message (⌘Enter)')}
              title={isStreaming ? 'Queue message' : (sendWithEnter ? 'Send (Enter)' : 'Send (⌘Enter)')}
            >
              <ArrowUp className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
      </div>

      {/* Summary Picker Dialog */}
      {selectedWorkspaceId && selectedSessionId && (
        <SummaryPicker
          open={summaryPickerOpen}
          onOpenChange={setSummaryPickerOpen}
          workspaceId={selectedWorkspaceId}
          sessionId={selectedSessionId}
          selectedIds={selectedSummaryIds}
          onSelectionChange={setSelectedSummaryIds}
        />
      )}
    </div>
  );
}
