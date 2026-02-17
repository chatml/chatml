'use client';

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useAppStore } from '@/stores/appStore';
import { createConversation, sendConversationMessage, stopConversation, setConversationPlanMode, approvePlan } from '@/lib/api';
import { markPlanModeExited } from '@/hooks/useWebSocket';
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
  PenLine,
  Upload,
  ScrollText,
  Check,
  Copy,
  MessageSquarePlus,
  Clock,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useClaudeAuthStatus } from '@/hooks/useClaudeAuthStatus';
import { ContextMeter } from './ContextMeter';
import { useToast } from '@/components/ui/toast';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { listenForFileDrop, listenForDragEnter, listenForDragLeave, openFileDialog, copyToClipboard } from '@/lib/tauri';
import type { Attachment, SuggestionPill } from '@/lib/types';
import { AttachmentGrid } from './AttachmentGrid';
import { processDroppedFiles, validateAttachments, SUPPORTED_EXTENSIONS, loadAllAttachmentContents, generateAttachmentId } from '@/lib/attachments';
import { UserQuestionPrompt } from './UserQuestionPrompt';
import { usePendingUserQuestion, useStreamingState } from '@/stores/selectors';
import { useSettingsStore } from '@/stores/settingsStore';
import { THINKING_LEVELS, type ThinkingLevel, resolveThinkingParams, clampThinkingLevel, canDisableThinking } from '@/lib/thinkingLevels';
import { useSlashCommandStore, type UnifiedSlashCommand } from '@/stores/slashCommandStore';
import { SummaryPicker } from './SummaryPicker';
import { PlateInput, type PlateInputHandle } from './PlateInput';
import { MODELS as SHARED_MODELS } from '@/lib/models';
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
  { ...SHARED_MODELS[0], icon: Snowflake, badge: 'NEW' as const },
  { ...SHARED_MODELS[1], icon: Snowflake },
  { ...SHARED_MODELS[2], icon: Snowflake },
];


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
  const defaultThinkingLevel = useSettingsStore((s) => s.defaultThinkingLevel);
  const [selectedModel, setSelectedModel] = useState(
    () => MODELS.find((m) => m.id === defaultModel) ?? MODELS[0]
  );
  const [isSending, setIsSending] = useState(false);
  const [approvalError, setApprovalError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [thinkingLevel, setThinkingLevel] = useState<ThinkingLevel>(defaultThinkingLevel);
  const defaultMaxThinkingTokens = useSettingsStore((s) => s.maxThinkingTokens);
  const defaultPlanMode = useSettingsStore((s) => s.defaultPlanMode);
  const [planModeEnabled, setPlanModeEnabled] = useState(defaultPlanMode);
  const sendWithEnter = useSettingsStore((s) => s.sendWithEnter);
  const autoConvertLongText = useSettingsStore((s) => s.autoConvertLongText);
  const suggestionsEnabled = useSettingsStore((s) => s.suggestionsEnabled);
  const autoSubmitPill = useSettingsStore((s) => s.autoSubmitPillSuggestion);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [summaryPickerOpen, setSummaryPickerOpen] = useState(false);
  const [selectedSummaryIds, setSelectedSummaryIds] = useState<string[]>([]);
  const plateInputRef = useRef<PlateInputHandle>(null);
  const attachmentsRef = useRef<Attachment[]>(attachments);
  attachmentsRef.current = attachments;

  const {
    selectedConversationId,
    selectedWorkspaceId,
    selectedSessionId,
    conversations,
    addMessage,
    addConversation,
    removeConversation,
    updateConversation,
    selectConversation,
    setStreaming,
    setQueuedMessage,
    commitQueuedMessage,
    clearPendingPlanApproval,
    setApprovedPlanContent,
    clearActiveTools,
    setPlanModeActive,
    clearInputSuggestion,
    setSessionToggleState,
    setDraftInput,
    clearDraftInput,
  } = useAppStore();
  // Session-scoped streaming state — prevents cross-session plan/state leakage
  const streaming = useStreamingState(selectedConversationId);
  const hasQueuedMessage = useAppStore(
    (s) => selectedConversationId ? s.queuedMessage[selectedConversationId] != null : false
  );
  const inputSuggestion = useAppStore(
    (s) => selectedConversationId ? s.inputSuggestions[selectedConversationId] : undefined
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

  // Save/restore compose draft per session so switching sessions doesn't lose or leak input
  const prevSessionIdRef = useRef<string | null>(selectedSessionId);
  useEffect(() => {
    const prevId = prevSessionIdRef.current;
    if (prevId === selectedSessionId) return;

    // Save draft for the previous session
    if (prevId) {
      const currentText = plateInputRef.current?.getText() ?? '';
      const currentAttachments = attachmentsRef.current;
      if (currentText || currentAttachments.length > 0) {
        setDraftInput(prevId, { text: currentText, attachments: currentAttachments });
      } else {
        clearDraftInput(prevId);
      }
    }

    // Restore draft for the new session (or clear)
    const draft = selectedSessionId ? useAppStore.getState().draftInputs[selectedSessionId] : undefined;
    if (draft) {
      plateInputRef.current?.setText(draft.text);
      setMessage(draft.text);
      setAttachments(draft.attachments);
      clearDraftInput(selectedSessionId!);
    } else {
      plateInputRef.current?.clear();
      setMessage('');
      setAttachments([]);
    }

    prevSessionIdRef.current = selectedSessionId;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only run on session switch
  }, [selectedSessionId]);

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
  const isStreaming = streaming?.isStreaming ?? false;

  // Check if there's a pending plan approval request
  const pendingPlanApproval = streaming?.pendingPlanApproval ?? null;

  // Derive compose button mode from streaming + text + queue state
  const hasText = message.trim().length > 0;
  const buttonMode: 'send' | 'stop' | 'queue' | 'queue-disabled' | 'send-disabled' = (() => {
    if (!isStreaming) return hasText ? 'send' : 'send-disabled';
    // When plan approval is pending, show "send" instead of "queue" —
    // the message will deny the plan and be treated as a new turn, not queued.
    if (pendingPlanApproval) return hasText ? 'send' : 'stop';
    if (hasQueuedMessage) return hasText ? 'queue-disabled' : 'stop';
    return hasText ? 'queue' : 'stop';
  })();

  // Check if plan mode is active (agent-driven state from backend events)
  const planModeActive = streaming?.planModeActive ?? false;

  // Check if conversation has messages (for ghost text vs placeholder)
  const conversationHasMessages = useAppStore(
    (s) => selectedConversationId ? s.messages.some(m => m.conversationId === selectedConversationId) : false
  );

  // Suggestions older than 5 minutes are considered stale and auto-hidden
  const SUGGESTION_MAX_AGE_MS = 5 * 60 * 1000;
  const isSuggestionStale = inputSuggestion?.timestamp
    ? (Date.now() - inputSuggestion.timestamp) > SUGGESTION_MAX_AGE_MS
    : false;

  // Ghost text visibility: show after first message when editor is empty and not streaming
  const showGhostText = suggestionsEnabled
    && !isStreaming
    && !message.trim()
    && !!inputSuggestion?.ghostText
    && conversationHasMessages
    && !isSuggestionStale;

  // Sync toggle ON when agent enters plan mode (e.g. EnterPlanMode tool).
  // Only syncs activation — deactivation is handled by handleApprovePlan.
  useEffect(() => {
    if (planModeActive && !planModeEnabled) {
      setPlanModeEnabled(true);
    }
  }, [planModeActive, planModeEnabled]);

  // Restore per-session toggle states when switching sessions
  const prevSessionRef = useRef<string | null>(null);
  useEffect(() => {
    if (!selectedSessionId || selectedSessionId === prevSessionRef.current) return;
    prevSessionRef.current = selectedSessionId;

    const saved = useAppStore.getState().sessionToggleState[selectedSessionId];
    if (saved) {
      setThinkingLevel(saved.thinkingLevel);
      setPlanModeEnabled(saved.planModeEnabled);
    } else {
      setThinkingLevel(defaultThinkingLevel);
      setPlanModeEnabled(defaultPlanMode);
    }
  }, [selectedSessionId, defaultThinkingLevel, defaultPlanMode]);

  // Persist toggle state changes to the store for the current session.
  // Skip when the session just changed (prevSessionRef hasn't caught up yet)
  // to avoid overwriting the old session's state with the new session's values.
  useEffect(() => {
    if (!selectedSessionId || selectedSessionId !== prevSessionRef.current) return;
    setSessionToggleState(selectedSessionId, { thinkingLevel, planModeEnabled });
  }, [selectedSessionId, thinkingLevel, planModeEnabled, setSessionToggleState]);

  // Keep streaming state planModeActive in sync with the local toggle.
  // This ensures the ConversationArea banner is visible immediately when:
  // - A new session starts with defaultPlanMode = true
  // - Switching to a session that had planModeEnabled = true
  // - A new conversation is created in a session with plan mode on
  useEffect(() => {
    if (!selectedConversationId) return;
    const current = useAppStore.getState().streamingState[selectedConversationId];
    if (current?.isStreaming) return; // Don't fight with WebSocket handler
    if ((current?.planModeActive ?? false) !== planModeEnabled) {
      setPlanModeActive(selectedConversationId, planModeEnabled);
    }
  }, [selectedConversationId, planModeEnabled, setPlanModeActive]);

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

  // Use a ref for the handler so the Tauri listener is registered once
  const handleFileDropRef = useRef(handleFileDrop);
  useEffect(() => { handleFileDropRef.current = handleFileDrop; }, [handleFileDrop]);

  // Listen for drag-drop events from Tauri
  useEffect(() => {
    let isCancelled = false;
    let unlistenDrop: (() => void) | undefined;
    let unlistenEnter: (() => void) | undefined;
    let unlistenLeave: (() => void) | undefined;

    const safeUnlisten = (fn?: () => void): undefined => {
      try { fn?.(); } catch { /* listener already removed */ }
      return undefined;
    };

    const setupListeners = async () => {
      try {
        const [drop, enter, leave] = await Promise.all([
          listenForFileDrop((paths) => {
            handleFileDropRef.current(paths);
          }),
          listenForDragEnter(() => {
            setIsDragOver(true);
          }),
          listenForDragLeave(() => {
            setIsDragOver(false);
          }),
        ]);

        if (isCancelled) {
          safeUnlisten(drop);
          safeUnlisten(enter);
          safeUnlisten(leave);
          return;
        }

        unlistenDrop = drop;
        unlistenEnter = enter;
        unlistenLeave = leave;
      } catch (error) {
        console.error('Failed to setup drag-drop listeners:', error);
        unlistenDrop = safeUnlisten(unlistenDrop);
        unlistenEnter = safeUnlisten(unlistenEnter);
        unlistenLeave = safeUnlisten(unlistenLeave);
      }
    };

    setupListeners();

    return () => {
      isCancelled = true;
      unlistenDrop = safeUnlisten(unlistenDrop);
      unlistenEnter = safeUnlisten(unlistenEnter);
      unlistenLeave = safeUnlisten(unlistenLeave);
    };
  }, []);

  // Handler for toggling plan mode - also notifies the backend
  const handlePlanModeToggle = useCallback(async () => {
    const newValue = !planModeEnabled;
    setPlanModeEnabled(newValue);

    // Update store state optimistically so the banner and toggle react together
    if (selectedConversationId) {
      setPlanModeActive(selectedConversationId, newValue);
      // Suppress stale backend events that would re-activate plan mode
      if (!newValue) {
        markPlanModeExited(selectedConversationId);
      }
    }

    // If there's an active conversation with a running process, notify the backend
    if (selectedConversationId) {
      try {
        await setConversationPlanMode(selectedConversationId, newValue);
      } catch {
        // Process may not be running (idle between turns) - that's fine,
        // plan mode will be applied when the next message starts
      }
    }
  }, [planModeEnabled, selectedConversationId, setPlanModeActive]);


  // Handle plan approval — clear UI optimistically so the bar disappears instantly
  const handleApprovePlan = useCallback(async () => {
    if (!selectedConversationId || !pendingPlanApproval) return;

    const { requestId, planContent } = pendingPlanApproval;

    // Save approved plan content for message persistence before clearing
    if (planContent) {
      setApprovedPlanContent(selectedConversationId, planContent);
    }

    // Clear UI immediately — don't wait for the HTTP round-trip
    clearPendingPlanApproval(selectedConversationId);
    setApprovalError(null);
    // Approving a plan exits plan mode — turn off the toggle and clear active state
    setPlanModeEnabled(false);
    setPlanModeActive(selectedConversationId, false);
    // Suppress stale backend events (init, permission_mode_changed) from re-activating
    markPlanModeExited(selectedConversationId);

    try {
      await approvePlan(selectedConversationId, requestId, true);
    } catch (error) {
      console.error('Failed to approve plan:', error);
      showError(error instanceof Error ? error.message : 'Failed to approve plan');
    }
  }, [selectedConversationId, pendingPlanApproval, clearPendingPlanApproval, setApprovedPlanContent, setPlanModeActive, showError]);

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

  // Handle copying plan content to clipboard
  const handleCopyPlan = useCallback(async () => {
    if (!pendingPlanApproval?.planContent) return;
    const ok = await copyToClipboard(pendingPlanApproval.planContent);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }, [pendingPlanApproval]);

  // Handle handing off the plan to a new conversation
  const handleHandOff = useCallback(async () => {
    if (!selectedWorkspaceId || !selectedSessionId || !pendingPlanApproval?.planContent) return;

    try {
      // Create a new conversation pre-loaded with the plan content
      const conv = await createConversation(selectedWorkspaceId, selectedSessionId, {
        type: 'task',
        message: pendingPlanApproval.planContent,
        model: selectedModel.id,
      });

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

      addMessage({
        id: crypto.randomUUID(),
        conversationId: conv.id,
        role: 'user',
        content: pendingPlanApproval.planContent,
        timestamp: new Date().toISOString(),
      });

      selectConversation(conv.id);
      setStreaming(conv.id, true);

      // Reject the current plan to clean up approval state
      if (selectedConversationId) {
        try {
          await approvePlan(selectedConversationId, pendingPlanApproval.requestId, false);
        } catch {
          // Ignore - agent may have timed out
        }
        clearPendingPlanApproval(selectedConversationId);
      }
    } catch (error) {
      console.error('Failed to hand off plan:', error);
      showError('Failed to create new conversation for hand off');
    }
  }, [selectedWorkspaceId, selectedSessionId, selectedConversationId, pendingPlanApproval, selectedModel.id, addConversation, addMessage, selectConversation, setStreaming, clearPendingPlanApproval, showError]);

  // Handle pill suggestion click
  const handlePillClick = useCallback((pill: SuggestionPill) => {
    if (selectedConversationId) {
      clearInputSuggestion(selectedConversationId);
    }
    if (autoSubmitPill) {
      sendMessage(pill.value);
    } else {
      plateInputRef.current?.setText(pill.value);
      setMessage(pill.value);
      plateInputRef.current?.focus();
    }
  }, [selectedConversationId, autoSubmitPill, sendMessage, clearInputSuggestion]);

  // Clamp thinking level when switching models (e.g. 'off' → 'low' for Opus)
  useEffect(() => {
    setThinkingLevel(prev => clampThinkingLevel(prev, selectedModel));
  }, [selectedModel]);

  const handleStop = useCallback(async () => {
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
  }, [selectedConversationId, isStreaming, commitQueuedMessage, setStreaming, updateConversation, clearActiveTools, showError]);

  // Global keyboard shortcuts

  useEffect(() => {
    const handleGlobalKeyDown = (e: globalThis.KeyboardEvent) => {
      // Cmd+L to focus input
      if (e.code === 'KeyL' && (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        plateInputRef.current?.focus();
      }
      // Alt+T to cycle thinking levels
      if (e.code === 'KeyT' && e.altKey && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
        e.preventDefault();
        setThinkingLevel(prev => {
          const levels = THINKING_LEVELS.map(l => l.id);
          const allowOff = canDisableThinking(selectedModel);
          const available = allowOff ? levels : levels.filter(l => l !== 'off');
          const idx = available.indexOf(prev);
          return available[(idx + 1) % available.length];
        });
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
      // Escape to stop agent (only when streaming, no dialog/combobox open)
      if (e.key === 'Escape' && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) {
        const hasOpenOverlay = document.querySelector('[role="listbox"], [role="dialog"]');
        if (!hasOpenOverlay && isStreaming) {
          e.preventDefault();
          handleStop();
        }
      }
      // Note: Cmd+Shift+Enter for plan approval is handled in handleKeyDown on the textarea
    };

    // Handle menu events from native Tauri menu
    const handleFocusInput = () => plateInputRef.current?.focus();
    const handleToggleThinking = () => {
      setThinkingLevel(prev => {
        const levels = THINKING_LEVELS.map(l => l.id);
        const allowOff = canDisableThinking(selectedModel);
        const available = allowOff ? levels : levels.filter(l => l !== 'off');
        const idx = available.indexOf(prev);
        return available[(idx + 1) % available.length];
      });
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
  }, [handlePlanModeToggle, handleOpenFilePicker, selectedModel, isStreaming, handleStop]);

  const handleSubmit = async () => {
    const { text: content, mentionedFiles } = plateInputRef.current?.getContent() ?? { text: '', mentionedFiles: [] };
    const hasContent = !!content.trim();
    const hasAttachments = attachments.length > 0;
    if ((!hasContent && !hasAttachments) || !selectedWorkspaceId || !selectedSessionId || isSending || hasQueuedMessage) return;

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
          if (planModeEnabled) {
            setPlanModeActive(selectedConversationId, true);
          }
          setStreaming(selectedConversationId, true);
        }

        // Create new conversation with initial message via API
        const convType = currentConversation?.type || 'task';
        // Resolve thinking level into backend params based on model
        const thinkingParams = resolveThinkingParams(
          thinkingLevel,
          selectedModel,
          defaultMaxThinkingTokens,
        );
        const conv = await createConversation(selectedWorkspaceId, selectedSessionId, {
          type: convType,
          message: trimmedContent,
          model: selectedModel.id,
          planMode: planModeEnabled ? true : undefined,
          maxThinkingTokens: thinkingParams.maxThinkingTokens,
          effort: thinkingParams.effort,
          attachments: loadedAttachments.length > 0 ? loadedAttachments : undefined,
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
        if (planModeEnabled) {
          setPlanModeActive(conv.id, true);
        }
        setStreaming(conv.id, true);
      } else {
        const messageId = crypto.randomUUID();
        const messageTimestamp = new Date().toISOString();
        const messageAttachments = currentAttachments.length > 0 ? currentAttachments : undefined;

        if (pendingPlanApproval && selectedConversationId) {
          // User typed feedback while plan approval is pending — deny the plan first,
          // then send the message. The deny MUST complete before the message send to
          // guarantee stdin ordering in the agent-runner.
          try {
            await approvePlan(selectedConversationId, pendingPlanApproval.requestId, false);
          } catch (err) {
            console.error('Failed to deny plan during message submit:', err);
          }
          clearPendingPlanApproval(selectedConversationId);
          setApprovalError(null);

          // Add message directly (not queued) — after the denial resolves the hook,
          // the agent finishes its turn and picks up this message as the next turn.
          addMessage({
            id: messageId,
            conversationId: selectedConversationId,
            role: 'user',
            content: trimmedContent,
            attachments: messageAttachments,
            timestamp: messageTimestamp,
          });
        } else if (isStreaming) {
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
          mentionedFiles.length > 0 ? mentionedFiles : undefined,
          planModeEnabled
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

    // Tab to accept ghost text suggestion
    if (e.key === 'Tab' && !e.shiftKey && showGhostText && inputSuggestion?.ghostText && selectedConversationId) {
      e.preventDefault();
      plateInputRef.current?.setText(inputSuggestion.ghostText);
      setMessage(inputSuggestion.ghostText);
      clearInputSuggestion(selectedConversationId);
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
      {/* Pill Suggestions */}
      {suggestionsEnabled && inputSuggestion?.pills && inputSuggestion.pills.length > 0 && !isStreaming && !pendingPlanApproval && !isSuggestionStale && (
        <div className="flex items-center gap-2 mb-2">
          <span className="text-xs text-muted-foreground shrink-0">Suggested:</span>
          <div className="flex items-center gap-1.5 flex-wrap">
            {inputSuggestion.pills.map((pill, i) => {
              const needsTooltip = pill.label !== pill.value;
              const button = (
                <Button
                  key={i}
                  variant="secondary"
                  size="sm"
                  className="h-7 text-xs rounded-full px-3"
                  onClick={() => handlePillClick(pill)}
                >
                  {pill.label}
                </Button>
              );
              return needsTooltip ? (
                <Tooltip key={i}>
                  <TooltipTrigger asChild>{button}</TooltipTrigger>
                  <TooltipContent className="max-w-xs">{pill.value}</TooltipContent>
                </Tooltip>
              ) : button;
            })}
          </div>
        </div>
      )}

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
                onClick={handleCopyPlan}
                disabled={!pendingPlanApproval?.planContent}
              >
                {copied ? (
                  <Check className="h-3.5 w-3.5 text-green-500" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
                {copied ? 'Copied' : 'Copy'}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1.5 text-xs text-muted-foreground"
                onClick={handleHandOff}
                disabled={!pendingPlanApproval?.planContent}
              >
                <MessageSquarePlus className="h-3.5 w-3.5" />
                Hand off
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1.5 text-xs text-muted-foreground"
                onClick={handleRejectPlan}
              >
                <PenLine className="h-3.5 w-3.5" />
                Request changes
              </Button>
              <Button
                variant="secondary"
                size="sm"
                className="h-7 gap-1.5 text-xs bg-background hover:bg-surface-2"
                onClick={handleApprovePlan}
              >
                Approve
                <kbd className="px-1 py-0.5 rounded bg-muted text-2xs font-mono">⌘⇧↵</kbd>
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
            className="absolute inset-0 w-full h-full pointer-events-none z-10 overflow-visible"
            preserveAspectRatio="none"
          >
            <rect
              x="0"
              y="0"
              width="100%"
              height="100%"
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
            placeholder={conversationHasMessages && suggestionsEnabled
              ? undefined
              : "Describe your task, @ to reference files, / for skills and commands"
            }
            className="bg-transparent dark:bg-transparent relative z-10"
            mentionItems={mentionItems}
            mentionItemsLoading={mentionItemsLoading}
            slashCommands={slashCommands}
            onSlashCommandExecute={handleSlashCommandExecute}
            onInput={(text) => {
              setMessage(text);
              // Clear suggestion when user starts typing
              if (text.trim() && selectedConversationId) {
                clearInputSuggestion(selectedConversationId);
              }
            }}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
          />
          {/* Ghost text suggestion — padding must match wrapper (px-3 py-2) + Editor (py-1) */}
          {showGhostText && (
            <div className="absolute inset-0 px-3 py-3 pointer-events-none z-0 flex items-start">
              <span className="text-muted-foreground/40 text-base">
                {inputSuggestion!.ghostText}
                <span className="text-muted-foreground/25 text-xs ml-2">Tab</span>
              </span>
            </div>
          )}
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

          {/* Unified Thinking Level Dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className={cn(
                  'h-7 gap-1.5 px-2 text-xs',
                  thinkingLevel !== 'high' && 'text-amber-500 hover:text-amber-600 bg-amber-500/10 hover:bg-amber-500/20'
                )}
                title={`Thinking: ${thinkingLevel} (⌥T to cycle)`}
                aria-label={`Thinking: ${thinkingLevel}`}
              >
                <Brain className="h-4 w-4" />
                <span className="font-medium capitalize">{thinkingLevel}</span>
                <ChevronDown className="h-3 w-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {THINKING_LEVELS.map((level) => (
                <DropdownMenuItem
                  key={level.id}
                  disabled={level.id === 'off' && !canDisableThinking(selectedModel)}
                  onClick={() => setThinkingLevel(level.id)}
                >
                  {level.label}
                  {level.id === 'high' && (
                    <span className="ml-1.5 text-xs text-muted-foreground">(default)</span>
                  )}
                  {level.id === 'off' && !canDisableThinking(selectedModel) && (
                    <span className="ml-1.5 text-xs text-muted-foreground">(Opus always thinks)</span>
                  )}
                  {level.id === thinkingLevel && <Check className="ml-auto h-3.5 w-3.5" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

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

          {/* Single Contextual Action Button — changes between Stop/Queue/Send based on state */}
          {buttonMode === 'stop' ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon"
                  variant="destructive"
                  className="h-8 w-8 rounded-lg"
                  onClick={handleStop}
                  aria-label="Stop agent (Escape)"
                >
                  <Square className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">Stop agent (Esc)</TooltipContent>
            </Tooltip>
          ) : buttonMode === 'queue' ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon"
                  className="h-8 w-8 rounded-lg relative"
                  onClick={handleSubmit}
                  disabled={!selectedSessionId || isSending || authDisabled}
                  aria-label="Queue message"
                >
                  <ArrowUp className="h-4 w-4" />
                  <Clock className="h-2.5 w-2.5 absolute -top-0.5 -right-0.5 text-amber-500" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">Queue message — sent after current response</TooltipContent>
            </Tooltip>
          ) : (
            <Button
              size="icon"
              className={cn('h-8 w-8 rounded-lg', buttonMode !== 'send' && 'opacity-50')}
              onClick={handleSubmit}
              disabled={buttonMode !== 'send' || !selectedSessionId || isSending || authDisabled}
              aria-label={sendWithEnter ? 'Send message (Enter)' : 'Send message (Cmd+Enter)'}
              title={sendWithEnter ? 'Send (Enter)' : 'Send (Cmd+Enter)'}
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
