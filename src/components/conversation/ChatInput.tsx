'use client';

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useAppStore } from '@/stores/appStore';
import { createConversation, sendConversationMessage, stopConversation, setConversationPlanMode, setConversationFastMode, setConversationPermissionMode, approvePlan } from '@/lib/api';
import { markPlanModeExited } from '@/hooks/useWebSocket';
import { useAppEventListener } from '@/lib/custom-events';
import { useShortcut, useCustomShortcut } from '@/hooks/useShortcut';
import { Sparkles, Upload, Link, FolderSymlink } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useClaudeAuthStatus, refreshClaudeAuthStatus } from '@/hooks/useClaudeAuthStatus';
import { useToast } from '@/components/ui/toast';
import { copyToClipboard } from '@/lib/tauri';
import type { Attachment, SuggestionPill } from '@/lib/types';
import { AttachmentGrid } from './AttachmentGrid';
import { AttachmentPreviewModal } from './AttachmentPreviewModal';
import { loadAllAttachmentContents } from '@/lib/attachments';
import { UserQuestionPrompt } from './UserQuestionPrompt';
import { usePendingUserQuestion, useStreamingChatInput, useSelectedIds, useConversationState, useChatInputActions, useConversationHasMessages } from '@/stores/selectors';
import { useSettingsStore } from '@/stores/settingsStore';
import { THINKING_LEVELS, type ThinkingLevel, resolveThinkingParams, clampThinkingLevel, canDisableThinking } from '@/lib/thinkingLevels';
import { useSlashCommandStore, type UnifiedSlashCommand } from '@/stores/slashCommandStore';
import { LinearIssuePicker } from './LinearIssuePicker';
import { WorkspacePicker } from './WorkspacePicker';
import type { LinearIssueDTO } from '@/lib/api';
import { PlateInput, type PlateInputHandle } from './PlateInput';
import { MODELS as SHARED_MODELS, type ModelEntry, toShortDisplayName, getModelDescription, isDefaultRecommended, deduplicateById, deduplicateByName, sortModelEntries } from '@/lib/models';
import type { MentionItem } from '@/components/ui/mention-node';
import { trackEvent } from '@/lib/telemetry';
import { playSound } from '@/lib/sounds';
import { listSessionFiles, type FileNodeDTO } from '@/lib/api';

// Extracted modules
import { useChatInputDrafts } from './useChatInputDrafts';
import { useChatInputAttachments } from './useChatInputAttachments';
import { useChatInputKeyboardShortcuts } from './useChatInputKeyboardShortcuts';
import { ChatInputPillSuggestions } from './ChatInputPillSuggestions';
import { ChatInputPlanApproval } from './ChatInputPlanApproval';
import { ToolApprovalPrompt } from './ToolApprovalPrompt';
import { ChatInputToolbar, type PermissionMode } from './ChatInputToolbar';
import { DictationWaveform } from './DictationWaveform';
import { useDictation } from '@/hooks/useDictation';

import type { Shortcut, ModifierKey } from '@/lib/shortcuts';
import type { DictationShortcutPreset } from '@/stores/settingsStore';

/** Convert a dictation shortcut preset + custom string into a Shortcut definition. */
function parseDictationShortcut(preset: DictationShortcutPreset, custom: string): Shortcut {
  const base = { id: 'toggleDictation', label: 'Toggle dictation', category: 'Chat' as const };
  switch (preset) {
    case 'capslock':
      return { ...base, key: 'CapsLock', modifiers: [] };
    case 'cmd-shift-d':
      return { ...base, key: 'd', modifiers: ['meta', 'shift'] };
    case 'custom': {
      if (!custom) return { ...base, key: 'd', modifiers: ['meta', 'shift'] };
      const parts = custom.split('+');
      const key = parts[parts.length - 1];
      const modifiers = parts.slice(0, -1) as ModifierKey[];
      return { ...base, key, modifiers };
    }
  }
}

/** Format a Shortcut into a human-readable hint string (e.g. "⌘⇧D"). */
function formatShortcutHint(shortcut: Shortcut): string {
  const parts: string[] = [];
  for (const mod of shortcut.modifiers) {
    switch (mod) {
      case 'meta': parts.push('\u2318'); break;
      case 'ctrl': parts.push('Ctrl'); break;
      case 'alt': parts.push('\u2325'); break;
      case 'shift': parts.push('\u21E7'); break;
    }
  }
  const key = shortcut.key.length === 1 ? shortcut.key.toUpperCase() : shortcut.key;
  parts.push(key);
  return parts.join('');
}

// Flat file type for mention items
interface FlatFile {
  path: string;
  name: string;
  directory: string;
}

// Helper to flatten file tree for mentions (excludes hidden directories)
function flattenFileTree(nodes: FileNodeDTO[], parentPath: string = '', depth: number = 0): FlatFile[] {
  if (depth >= 15) return [];
  const result: FlatFile[] = [];
  for (const node of nodes) {
    // Skip hidden files and directories (starting with .)
    if (node.name.startsWith('.')) continue;

    if (node.isDir) {
      if (node.children) {
        result.push(...flattenFileTree(node.children, node.path, depth + 1));
      }
    } else {
      const directory = parentPath || node.path.split('/').slice(0, -1).join('/');
      result.push({ path: node.path, name: node.name, directory });
    }
  }
  return result;
}

/** Static fallback model list (used when no SDK models are available). */
const STATIC_MODELS: ModelEntry[] = SHARED_MODELS.map((m) => ({
  id: m.id,
  name: m.name,
  description: m.description,
  icon: Sparkles,
  supportsThinking: m.supportsThinking,
  supportsEffort: m.supportsEffort,
  supportsFastMode: m.supportsFastMode,
}));

/** Build the model list from SDK-reported dynamic models, with static fallback. */
function buildModelList(dynamic: ReturnType<typeof useAppStore.getState>['supportedModels']): ModelEntry[] {
  if (dynamic.length === 0) return STATIC_MODELS;
  // Filter out SDK "Default (recommended)" pseudo-model and deduplicate.
  const entries = deduplicateById(
    dynamic
      .filter((m) => !isDefaultRecommended(m.displayName))
      .map((m) => ({
        id: m.value,
        name: toShortDisplayName(m.value, m.displayName),
        description: getModelDescription(m.value),
        icon: Sparkles,
        supportsThinking: m.supportsAdaptiveThinking ?? true,
        supportsEffort: m.supportsEffort ?? false,
        supportedEffortLevels: m.supportedEffortLevels,
        supportsFastMode: m.supportsFastMode,
      }))
  );
  // Also deduplicate by display name — SDK may report dated variants
  // (e.g. claude-sonnet-4-6 and claude-sonnet-4-6-20260301) that resolve
  // to the same friendly name.
  return sortModelEntries(deduplicateByName(entries));
}


/** Get available thinking level IDs for a model, respecting SDK-reported supported levels. */
function getAvailableThinkingLevels(model: ModelEntry): ThinkingLevel[] {
  const allLevels = THINKING_LEVELS.map(l => l.id);
  const allowOff = canDisableThinking(model);
  let available = allowOff ? allLevels : allLevels.filter(l => l !== 'off');
  // Filter by SDK-reported supported effort levels when available
  if (model.supportsEffort && model.supportedEffortLevels) {
    const supported = new Set(model.supportedEffortLevels);
    available = available.filter(l => l === 'off' || supported.has(l as 'low' | 'medium' | 'high' | 'max'));
  }
  return available;
}

interface ChatInputProps {
  onMessageSubmit?: () => void;
}

export function ChatInput({ onMessageSubmit }: ChatInputProps) {
  const claudeAuthStatus = useClaudeAuthStatus();
  const authDisabled = claudeAuthStatus?.configured === false;
  const [message, setMessage] = useState('');
  // Read store defaults once at mount time — these initialize per-conversation
  // state and intentionally don't sync if the user changes settings mid-session.
  const defaultModel = useSettingsStore((s) => s.defaultModel);
  const setDefaultModel = useSettingsStore((s) => s.setDefaultModel);
  const defaultThinkingLevel = useSettingsStore((s) => s.defaultThinkingLevel);
  const setDefaultThinkingLevel = useSettingsStore((s) => s.setDefaultThinkingLevel);

  // Dynamic model list from SDK, with static fallback
  const dynamicModels = useAppStore((s) => s.supportedModels);
  const MODELS = useMemo(() => buildModelList(dynamicModels), [dynamicModels]);

  const [selectedModel, setSelectedModel] = useState<ModelEntry>(
    () => MODELS.find((m) => m.id === defaultModel) ?? MODELS[0]
  );
  const [isSending, setIsSending] = useState(false);
  const [approvalError, setApprovalError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [thinkingLevel, setThinkingLevel] = useState<ThinkingLevel>(defaultThinkingLevel);
  const defaultMaxThinkingTokens = useSettingsStore((s) => s.maxThinkingTokens);
  const defaultPlanMode = useSettingsStore((s) => s.defaultPlanMode);
  const [planModeEnabled, setPlanModeEnabled] = useState(defaultPlanMode);
  const defaultFastMode = useSettingsStore((s) => s.defaultFastMode);
  const [fastModeEnabled, setFastModeEnabled] = useState(defaultFastMode);
  const defaultPermissionMode = useSettingsStore((s) => s.defaultPermissionMode);
  const setDefaultPermissionMode = useSettingsStore((s) => s.setDefaultPermissionMode);
  const [permissionMode, setPermissionMode] = useState(defaultPermissionMode);
  const sendWithEnter = useSettingsStore((s) => s.sendWithEnter);
  const suggestionsEnabled = useSettingsStore((s) => s.suggestionsEnabled);
  const autoSubmitPill = useSettingsStore((s) => s.autoSubmitPillSuggestion);
  const [linearPickerOpen, setLinearPickerOpen] = useState(false);
  const [linkedLinearIssue, setLinkedLinearIssue] = useState<LinearIssueDTO | null>(null);
  const [isFocused, setIsFocused] = useState(false);
  const [workspacePickerOpen, setWorkspacePickerOpen] = useState(false);
  const [linkedWorkspaceIds, setLinkedWorkspaceIds] = useState<string[]>([]);
  const plateInputRef = useRef<PlateInputHandle>(null);
  const messageRef = useRef(message);
  messageRef.current = message;
  const currentSessionIdRef = useRef<string | null>(null);

  // Scoped selectors — avoids subscribing to the entire store.
  const { selectedWorkspaceId, selectedSessionId, selectedConversationId } = useSelectedIds();
  const { conversations, selectConversation, addConversation, removeConversation, updateConversation } = useConversationState();
  const {
    addMessage,
    setStreaming,
    addQueuedMessage,
    clearQueuedMessages,
    clearPendingPlanApproval,
    setApprovedPlanContent,
    clearApprovedPlanContent,
    finalizeStreamingMessage,
    setPlanModeActive,
    clearInputSuggestion,
    setSessionToggleState,
    setDraftInput,
    clearDraftInput,
  } = useChatInputActions();
  currentSessionIdRef.current = selectedSessionId;

  // Attachments hook
  const autoConvertLongText = useSettingsStore((s) => s.autoConvertLongText);
  const { error: showError, info: showInfo } = useToast();
  const {
    attachments,
    setAttachments,
    attachmentsRef,
    isDragOver,
    previewIndex,
    setPreviewIndex,
    handlePaste,
    handleRemoveAttachment,
    handleOpenFilePicker,
  } = useChatInputAttachments({ autoConvertLongText, showError, showInfo });

  // Drafts hook
  useChatInputDrafts({
    selectedSessionId,
    plateInputRef,
    messageRef,
    attachmentsRef,
    currentSessionIdRef,
    setMessage,
    setAttachments,
    setDraftInput,
    clearDraftInput,
  });

  // Speech-to-text dictation
  const preDictationTextRef = useRef('');
  // Holds the last transcript text set during dictation. Used as a "floor" in
  // onInput: any editor onChange delivering text shorter than this ref is a
  // stale/intermediate event from Slate's async onChange and is discarded.
  // Unlike the old boolean flag approach, this has no timing window.
  const lastTranscriptRef = useRef('');
  const { isDictating, toggle: toggleDictation, isAvailable: dictationAvailable, audioLevelRef } = useDictation({
    onTranscript: (text) => {
      if (!text) return; // Ignore empty transcripts (e.g., phantom callback during teardown)
      // Backend sends the full accumulated transcript across task restarts.
      // We only prepend text that was in the editor before dictation started.
      const pre = preDictationTextRef.current;
      const full = pre ? `${pre} ${text}` : text;
      lastTranscriptRef.current = full;
      plateInputRef.current?.setText(full);
      setMessage(full);
    },
    onError: (msg) => showError(msg),
  });

  // Capture existing editor text when dictation starts so it can be prepended
  // to the transcript. Re-captured on each fresh false→true transition, so
  // rapid toggles would pick up mid-dictation text — acceptable since the
  // backend accumulation resets per session anyway.
  const prevDictatingRef = useRef(false);
  useEffect(() => {
    if (isDictating && !prevDictatingRef.current) {
      preDictationTextRef.current = messageRef.current;
      lastTranscriptRef.current = messageRef.current;
      playSound('ding');
    } else if (!isDictating && prevDictatingRef.current) {
      lastTranscriptRef.current = '';
      playSound('pop');
    }
    prevDictatingRef.current = isDictating;
  }, [isDictating]);

  // Register dictation shortcut (configurable via settings)
  const dictationShortcutPref = useSettingsStore((s) => s.dictationShortcut);
  const dictationCustomShortcut = useSettingsStore((s) => s.dictationCustomShortcut);
  const dictationShortcutDef = useMemo(() => {
    return parseDictationShortcut(dictationShortcutPref, dictationCustomShortcut);
  }, [dictationShortcutPref, dictationCustomShortcut]);
  const dictationShortcutHint = useMemo(
    () => formatShortcutHint(dictationShortcutDef),
    [dictationShortcutDef]
  );
  useCustomShortcut(dictationShortcutDef, toggleDictation, { enabled: dictationAvailable });

  // Session-scoped streaming state — prevents cross-session plan/state leakage
  const streamingInput = useStreamingChatInput(selectedConversationId);
  const queuedCount = useAppStore(
    (s) => selectedConversationId ? (s.queuedMessages[selectedConversationId]?.length ?? 0) : 0
  );
  const inputSuggestion = useAppStore(
    (s) => selectedConversationId ? s.inputSuggestions[selectedConversationId] : undefined
  );
  const promptSuggestions = useAppStore(
    (s) => selectedConversationId ? s.promptSuggestions[selectedConversationId] : undefined
  );

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
  }, [selectedConversationId, currentConversationModel, defaultModel, MODELS]);

  // Derive available slash commands from store
  const getAllCommands = useSlashCommandStore((s) => s.getAllCommands);
  const installedSkills = useSlashCommandStore((s) => s.installedSkills);
  const userCommands = useSlashCommandStore((s) => s.userCommands);
  const sdkCommands = useSlashCommandStore((s) => s.sdkCommands);
  const slashCommands = useMemo(
    () => getAllCommands({ hasSession: selectedSessionId !== null }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- need to recompute when skills/commands change
    [getAllCommands, selectedSessionId, installedSkills, userCommands, sdkCommands]
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
      trackEvent('slash_command_used', { command: cmd.trigger });
    } else if (cmd.executionType === 'skill') {
      // Skill commands: insert the trigger text for user to submit
      const text = `/${cmd.trigger}`;
      plateInputRef.current?.setText(text);
      setMessage(text);
      trackEvent('skill_invoked', { skill_name: cmd.trigger });
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
      trackEvent('slash_command_used', { command: cmd.trigger });
    }
  }, [sendMessage, selectedConversationId, selectedSessionId]);

  // Fetch user commands when session changes
  const fetchUserCommands = useSlashCommandStore((s) => s.fetchUserCommands);
  const setInstalledSkills = useSlashCommandStore((s) => s.setInstalledSkills);
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
  const isStreaming = streamingInput.isStreaming;

  // Check if there's a pending plan approval request
  const pendingPlanApproval = streamingInput.pendingPlanApproval;

  // Check if there's a pending tool approval request
  const pendingToolApproval = streamingInput.pendingToolApproval;

  // Derive compose button mode from streaming + text + queue state
  const hasText = message.trim().length > 0;
  const buttonMode: 'send' | 'stop' | 'queue' | 'send-disabled' = (() => {
    if (!isStreaming) return hasText ? 'send' : 'send-disabled';
    // When plan approval is pending, show "send" instead of "queue" —
    // the message will deny the plan and be treated as a new turn, not queued.
    if (pendingPlanApproval) return hasText ? 'send' : 'stop';
    return hasText ? 'queue' : 'stop';
  })();

  // Check if plan mode is active (agent-driven state from backend events)
  const planModeActive = streamingInput.planModeActive;

  // Check if conversation has messages (for ghost text vs placeholder)
  const conversationHasMessages = useConversationHasMessages(selectedConversationId);

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

  // Sync the local planModeEnabled toggle with the store's planModeActive, and vice versa.
  useEffect(() => {
    if (planModeActive && !planModeEnabled) {
      setPlanModeEnabled(true);
      return;
    }
    if (!planModeActive && planModeEnabled && isStreaming && !pendingPlanApproval) {
      setPlanModeEnabled(false);
      return;
    }
    if (selectedConversationId) {
      const current = useAppStore.getState().streamingState[selectedConversationId];
      if (current?.isStreaming) return;
      if ((current?.planModeActive ?? false) !== planModeEnabled) {
        setPlanModeActive(selectedConversationId, planModeEnabled);
      }
    }
  }, [planModeActive, planModeEnabled, isStreaming, pendingPlanApproval, selectedConversationId, setPlanModeActive]);

  // Restore per-session toggle states when switching sessions
  const prevSessionRef = useRef<string | null>(null);
  useEffect(() => {
    if (!selectedSessionId || selectedSessionId === prevSessionRef.current) return;
    prevSessionRef.current = selectedSessionId;

    const saved = useAppStore.getState().sessionToggleState[selectedSessionId];
    if (saved) {
      setThinkingLevel(saved.thinkingLevel);
      setPlanModeEnabled(saved.planModeEnabled);
      setFastModeEnabled(saved.fastModeEnabled ?? defaultFastMode);
    } else {
      setThinkingLevel(defaultThinkingLevel);
      setPlanModeEnabled(defaultPlanMode);
      setFastModeEnabled(defaultFastMode);
    }
  }, [selectedSessionId, defaultThinkingLevel, defaultPlanMode, defaultFastMode]);

  // Persist toggle state changes to the store for the current session.
  useEffect(() => {
    if (!selectedSessionId || selectedSessionId !== prevSessionRef.current) return;
    setSessionToggleState(selectedSessionId, { thinkingLevel, planModeEnabled, fastModeEnabled });
  }, [selectedSessionId, thinkingLevel, planModeEnabled, fastModeEnabled, setSessionToggleState]);


  // Sync fast mode state from agent-runner confirmation events
  useEffect(() => {
    const handler = (e: Event) => {
      const { conversationId: convId, enabled } = (e as CustomEvent).detail;
      if (convId === selectedConversationId) {
        setFastModeEnabled(enabled);
      }
    };
    window.addEventListener('fast-mode-synced', handler);
    return () => window.removeEventListener('fast-mode-synced', handler);
  }, [selectedConversationId]);

  // Check if there's a pending user question
  const pendingQuestion = usePendingUserQuestion(selectedConversationId);

  // Listen for compose-action events (e.g., Fix All review, Add to Chat)
  useAppEventListener('compose-action', ({ text, attachments: incoming }) => {
    let didSetText = false;
    if (text) {
      const existing = plateInputRef.current?.getText() ?? '';
      if (!existing.trim()) {
        plateInputRef.current?.setText(text);
        didSetText = true;
      }
    }
    if (incoming && incoming.length > 0) {
      setAttachments(prev => [...prev, ...incoming]);
    }
    if (!didSetText) {
      plateInputRef.current?.focus();
    }
  });

  // Handler for toggling plan mode - also notifies the backend
  const handlePlanModeToggle = useCallback(async () => {
    const newValue = !planModeEnabled;
    setPlanModeEnabled(newValue);

    if (selectedConversationId) {
      setPlanModeActive(selectedConversationId, newValue);
      if (newValue) {
        clearApprovedPlanContent(selectedConversationId);
        clearPendingPlanApproval(selectedConversationId);
      } else {
        markPlanModeExited(selectedConversationId);
      }
    }

    if (selectedConversationId) {
      try {
        await setConversationPlanMode(selectedConversationId, newValue);
      } catch {
        // Process may not be running — plan mode will be applied when the next message starts
      }
    }
  }, [planModeEnabled, selectedConversationId, setPlanModeActive, clearApprovedPlanContent, clearPendingPlanApproval]);

  const handleFastModeToggle = useCallback(async () => {
    const newValue = !fastModeEnabled;
    setFastModeEnabled(newValue);

    if (selectedConversationId) {
      try {
        await setConversationFastMode(selectedConversationId, newValue);
      } catch (err) {
        // Process may not be running — fast mode will be applied when the next message starts
        console.debug('setConversationFastMode failed (will apply on next message):', err);
      }
    }
  }, [fastModeEnabled, selectedConversationId]);

  const handlePermissionModeChange = useCallback(async (mode: PermissionMode) => {
    const previousMode = permissionMode;
    setPermissionMode(mode);

    if (selectedConversationId) {
      try {
        await setConversationPermissionMode(selectedConversationId, mode);
      } catch (err) {
        // Rollback optimistic update — the live process rejected the change (e.g. plan mode active).
        setPermissionMode(previousMode);
        console.debug('setConversationPermissionMode failed (will apply on next message):', err);
      }
    }
  }, [permissionMode, selectedConversationId]);

  // Handle plan approval
  const handleApprovePlan = useCallback(async () => {
    if (!selectedConversationId || !pendingPlanApproval) return;

    const { requestId, planContent } = pendingPlanApproval;

    if (planContent) {
      setApprovedPlanContent(selectedConversationId, planContent);
    }

    clearPendingPlanApproval(selectedConversationId);
    setApprovalError(null);
    setPlanModeEnabled(false);
    setPlanModeActive(selectedConversationId, false);
    markPlanModeExited(selectedConversationId);

    try {
      await approvePlan(selectedConversationId, requestId, true);
    } catch (error) {
      console.error('Failed to approve plan:', error);
      showError(error instanceof Error ? error.message : 'Failed to approve plan');
    }
  }, [selectedConversationId, pendingPlanApproval, clearPendingPlanApproval, setApprovedPlanContent, setPlanModeActive, showError]);


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
      useAppStore.getState().clearPromptSuggestions(selectedConversationId);
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
      const startTime = useAppStore.getState().streamingState[selectedConversationId]?.startTime;
      const durationMs = startTime ? Date.now() - startTime : undefined;
      finalizeStreamingMessage(selectedConversationId, { durationMs, commitQueued: true, terminal: true });
      addMessage({
        id: `msg-stopped-${Date.now()}`,
        conversationId: selectedConversationId,
        role: 'system',
        content: 'Agent was stopped by user.',
        timestamp: new Date().toISOString(),
      });
      await stopConversation(selectedConversationId);
      updateConversation(selectedConversationId, { status: 'idle' });
    } catch (error) {
      console.error('Failed to stop conversation:', error);
      showError('Failed to stop conversation. Please try again.');
    }
  }, [selectedConversationId, isStreaming, finalizeStreamingMessage, addMessage, updateConversation, showError]);

  useShortcut('stopAgent', handleStop, { enabled: isStreaming });

  // Global keyboard shortcuts
  useChatInputKeyboardShortcuts({
    plateInputRef,
    selectedModel,
    MODELS,
    setSelectedModel,
    setThinkingLevel,
    setMessage,
    handlePlanModeToggle,
    handleFastModeToggle,
    handleOpenFilePicker,
    setLinearPickerOpen,
    getAvailableThinkingLevels,
  });

  const handleSubmit = async () => {
    const { text: content, mentionedFiles } = plateInputRef.current?.getContent() ?? { text: '', mentionedFiles: [] };
    const hasContent = !!content.trim();
    const hasAttachments = attachments.length > 0;
    if ((!hasContent && !hasAttachments) || !selectedWorkspaceId || !selectedSessionId || isSending) return;

    // Can't queue a message to a conversation that doesn't exist yet — check before clearing input
    const conversationMessagesEarly = currentConversation
      ? useAppStore.getState().messagesByConversation[currentConversation.id] ?? []
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

      // Pre-send SSO token check for Bedrock users — refresh expired tokens before
      // sending so the backend doesn't block for 120s with no UI feedback.
      // Applies to both new conversations and follow-up messages (token can expire mid-session).
      if (claudeAuthStatus?.hasBedrock && claudeAuthStatus.ssoTokenValid === false) {
        showInfo('AWS SSO token expired — refreshing credentials...');
        try {
          const { refreshAWSCredentials } = await import('@/lib/api');
          await refreshAWSCredentials();
          // Fire-and-forget: the server-side token is already refreshed; this updates
          // the cached UI status asynchronously (won't be reflected in this render cycle).
          refreshClaudeAuthStatus();
        } catch (err) {
          showError(`AWS credential refresh failed: ${err instanceof Error ? err.message : 'Unknown error'}. You can retry or continue — the agent will prompt if needed.`);
          // Don't block — let the user continue, the backend/agent will handle the auth error
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
          permissionMode: permissionMode !== 'bypassPermissions' ? permissionMode : undefined,
          fastMode: fastModeEnabled ? true : undefined,
          maxThinkingTokens: thinkingParams.maxThinkingTokens,
          effort: thinkingParams.effort,
          attachments: loadedAttachments.length > 0 ? loadedAttachments : undefined,
          linearIssue: linkedLinearIssue ? {
            identifier: linkedLinearIssue.identifier,
            title: linkedLinearIssue.title,
            description: linkedLinearIssue.description,
            stateName: linkedLinearIssue.stateName,
            labels: linkedLinearIssue.labels,
          } : undefined,
          linkedWorkspaceIds: linkedWorkspaceIds.length > 0 ? linkedWorkspaceIds : undefined,
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

        let handledPlanDenial = false;
        if (pendingPlanApproval && selectedConversationId) {
          try {
            await approvePlan(selectedConversationId, pendingPlanApproval.requestId, false, trimmedContent);
          } catch (err) {
            console.error('Failed to deny plan during message submit:', err);
          }
          clearPendingPlanApproval(selectedConversationId);
          setApprovalError(null);
          handledPlanDenial = true;
        }

        if (!handledPlanDenial && isStreaming) {
          addQueuedMessage(selectedConversationId, {
            id: messageId,
            content: trimmedContent,
            attachments: messageAttachments,
            timestamp: messageTimestamp,
          });
        } else {
          addMessage({
            id: messageId,
            conversationId: selectedConversationId,
            role: 'user',
            content: trimmedContent,
            attachments: messageAttachments,
            timestamp: messageTimestamp,
          });
          updateConversation(selectedConversationId, { status: 'active' });
          setStreaming(selectedConversationId, true);
        }

        // Always send to backend (it queues in agent-runner if busy)
        const modelChanged = selectedModel.id !== currentConversation?.model;
        // Omitting the field (undefined) leaves the current model unchanged.
        const modelToSend = selectedModel.id;
        await sendConversationMessage(
          selectedConversationId,
          trimmedContent,
          loadedAttachments.length > 0 ? loadedAttachments : undefined,
          modelChanged ? modelToSend : undefined,
          mentionedFiles.length > 0 ? mentionedFiles : undefined,
          planModeEnabled
        );
      }

      // Track message sent
      trackEvent('message_sent', {
        model: selectedModel.id,
        has_attachments: loadedAttachments.length > 0 ? 1 : 0,
        has_mentions: mentionedFiles.length > 0 ? 1 : 0,
      });

      // Clear attachments and linked context after successful send
      setAttachments([]);
      setLinkedLinearIssue(null);
      setLinkedWorkspaceIds([]);
    } catch (error) {
      console.error('Failed to send message:', error);
      const convId = selectedConversationId;
      if (convId) {
        clearQueuedMessages(convId);
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
    const activeElement = document.activeElement as HTMLElement | null;
    const isInCombobox = activeElement?.closest('[role="combobox"]');
    const hasOpenPopover = document.querySelector('[role="combobox"][aria-expanded="true"]');
    if ((isInCombobox || hasOpenPopover) && (e.key === 'Enter' || e.key === 'Tab')) {
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

  // If there's a pending question, show the question UI instead of the normal input.
  if (pendingQuestion && selectedConversationId) {
    return <UserQuestionPrompt conversationId={selectedConversationId} />;
  }

  // If there's a pending tool approval, replace the entire composer with the approval UI.
  // This takes priority over plan approval (which renders inline in the fall-through composer).
  // In practice, tool approval and plan approval cannot be pending simultaneously: the agent
  // is blocked waiting for the tool approval before it can emit further plan content.
  if (pendingToolApproval && selectedConversationId) {
    return <ToolApprovalPrompt conversationId={selectedConversationId} />;
  }

  return (
    <div className="pt-1 px-3 pb-3">
      {/* Pill Suggestions (input suggestions take priority, prompt suggestions as fallback) */}
      {suggestionsEnabled && inputSuggestion?.pills && inputSuggestion.pills.length > 0 && !isStreaming && !pendingPlanApproval && !isSuggestionStale && (
        <ChatInputPillSuggestions pills={inputSuggestion.pills} onPillClick={handlePillClick} />
      )}
      {/* Prompt suggestions intentionally skip the isSuggestionStale age check —
          they represent "what to ask next" and stay relevant until the next turn clears them. */}
      {suggestionsEnabled && (!inputSuggestion?.pills || inputSuggestion.pills.length === 0) && promptSuggestions && promptSuggestions.length > 0 && !isStreaming && !pendingPlanApproval && (
        <ChatInputPillSuggestions
          pills={promptSuggestions.map((s) => ({ label: s.length > 60 ? s.slice(0, 57) + '...' : s, value: s }))}
          onPillClick={handlePillClick}
        />
      )}

      {/* Plan Approval Bar */}
      {pendingPlanApproval && (
        <ChatInputPlanApproval
          copied={copied}
          hasPlanContent={!!pendingPlanApproval.planContent}
          approvalError={approvalError}
          onCopyPlan={handleCopyPlan}
          onHandOff={handleHandOff}
          onApprovePlan={handleApprovePlan}
        />
      )}

      {/* Dictation waveform visualizer */}
      <DictationWaveform audioLevelRef={audioLevelRef} isActive={isDictating} shortcutHint={dictationShortcutHint} />

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
        {/* Gradient border for streaming state (static for performance) — hidden when dictating */}
        {isStreaming && !pendingPlanApproval && !isDictating && (
          <div className="absolute -inset-[1px] rounded-lg bg-gradient-to-r from-brand/60 via-purple-500/80 to-brand/60 opacity-70" />
        )}
        {/* Blue border for active dictation (takes priority over streaming) */}
        {isDictating && (
          <div className="absolute -inset-[1px] rounded-lg bg-blue-500/50 opacity-70" />
        )}
      <div className={cn(
        'relative rounded-lg border border-border bg-card dark:bg-input',
        isStreaming && !pendingPlanApproval && !isDictating && 'border-transparent',
        pendingPlanApproval && 'border-transparent',
        planModeEnabled && !isStreaming && 'border-transparent',
        isDictating && 'border-transparent',
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
            onPreview={(index) => setPreviewIndex(index)}
          />
        )}

        {/* Linked Linear issue indicator */}
        {linkedLinearIssue && (
          <div className="px-3 py-1.5 flex items-center gap-2">
            <div className="flex items-center gap-1.5 text-xs text-brand bg-brand/10 px-2 py-1 rounded-md">
              <Link className="size-3" />
              <span className="font-mono">{linkedLinearIssue.identifier}</span>
              <span className="truncate max-w-[200px]">{linkedLinearIssue.title}</span>
              <button
                type="button"
                className="ml-1 hover:text-destructive"
                onClick={() => setLinkedLinearIssue(null)}
                aria-label="Remove linked issue"
              >
                ×
              </button>
            </div>
          </div>
        )}

        {/* Linked workspaces indicator */}
        {linkedWorkspaceIds.length > 0 && (
          <div className="px-3 py-1.5 flex items-center gap-2">
            <div className="flex items-center gap-1.5 text-xs text-brand bg-brand/10 px-2 py-1 rounded-md">
              <FolderSymlink className="size-3" />
              {linkedWorkspaceIds.length} {linkedWorkspaceIds.length === 1 ? 'workspace' : 'workspaces'} linked
              <button
                type="button"
                className="ml-1 hover:text-destructive"
                onClick={() => setLinkedWorkspaceIds([])}
                aria-label="Remove linked workspaces"
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
              // During dictation, reject any editor onChange that delivers text
              // shorter than the last transcript we set. This catches stale/empty
              // intermediate events from Slate's async onChange after setValue().
              if (isDictating && text.length < lastTranscriptRef.current.length) {
                return;
              }
              setMessage(text);
              if (text.trim() && selectedConversationId && useAppStore.getState().inputSuggestions[selectedConversationId]) {
                clearInputSuggestion(selectedConversationId);
              }
            }}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
          />
          {/* Ghost text suggestion */}
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

        {/* Toolbar */}
        <ChatInputToolbar
          model={{
            selected: selectedModel,
            models: MODELS,
            defaultId: defaultModel,
            setSelected: setSelectedModel,
            setDefault: setDefaultModel,
          }}
          thinking={{
            level: thinkingLevel,
            defaultLevel: defaultThinkingLevel,
            setLevel: setThinkingLevel,
            setDefault: setDefaultThinkingLevel,
          }}
          permissionMode={{
            mode: permissionMode,
            defaultMode: defaultPermissionMode,
            setMode: handlePermissionModeChange,
            setDefault: setDefaultPermissionMode,
          }}
          planModeEnabled={planModeEnabled}
          onPlanModeToggle={handlePlanModeToggle}
          fastModeEnabled={fastModeEnabled}
          onFastModeToggle={handleFastModeToggle}
          showFastMode={selectedModel.supportsFastMode === true}
          selectedConversationId={selectedConversationId}
          selectedSessionId={selectedSessionId}
          attachments={{
            onOpenFilePicker: handleOpenFilePicker,
            onLinearPickerOpen: () => setLinearPickerOpen(true),
            linkedLinearIssue,
            onWorkspacePickerOpen: () => setWorkspacePickerOpen(true),
            linkedWorkspaceIds,
          }}
          action={{
            buttonMode,
            queuedCount,
            isSending,
            authDisabled,
            sendWithEnter,
            onSubmit: handleSubmit,
            onStop: handleStop,
          }}
          showInfo={showInfo}
          dictation={{
            isDictating,
            isAvailable: dictationAvailable,
            onToggle: toggleDictation,
            shortcutHint: dictationShortcutHint,
          }}
        />
      </div>
      </div>

      {/* Linear Issue Picker Dialog */}
      <LinearIssuePicker
        open={linearPickerOpen}
        onOpenChange={setLinearPickerOpen}
        selectedIssue={linkedLinearIssue}
        onIssueChange={setLinkedLinearIssue}
      />

      {/* Workspace Picker Dialog */}
      {selectedWorkspaceId && (
        <WorkspacePicker
          open={workspacePickerOpen}
          onOpenChange={setWorkspacePickerOpen}
          currentWorkspaceId={selectedWorkspaceId}
          selectedIds={linkedWorkspaceIds}
          onSelectionChange={setLinkedWorkspaceIds}
        />
      )}

      {/* Attachment Preview Modal */}
      {previewIndex !== null && (
        <AttachmentPreviewModal
          open
          onOpenChange={(open) => { if (!open) setPreviewIndex(null); }}
          attachments={attachments}
          initialIndex={previewIndex}
        />
      )}
    </div>
  );
}
