'use client';

import { useEffect, useRef, useCallback } from 'react';
import { useTheme } from 'next-themes';
import { useAppStore } from '@/stores/appStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useUpdateStore } from '@/stores/updateStore';
import { useToast } from '@/components/ui/toast';
import { useNavigationStore } from '@/stores/navigationStore';
import { useTabStore } from '@/stores/tabStore';
import { ENABLE_BROWSER_TABS } from '@/lib/constants';
import { switchToTab } from '@/components/navigation/BrowserTabBar';
import { refreshClaudeAuthStatus } from '@/hooks/useClaudeAuthStatus';
import { safeListen, openInVSCode, copyToClipboard, openUrlInBrowser, getCurrentWindow } from '@/lib/tauri';

interface MenuHandlersOptions {
  handleNewSession: () => void;
  handleNewConversation: () => void;
  handleCloseTab: () => void;
  handleCloseFileTab: (tabId: string) => void;
  saveCurrentTab: () => void;
  toggleLeftSidebar: () => void;
  toggleRightSidebar: () => void;
  toggleBottomTerminal: () => void;
  expandBottomTerminal: () => void;
  selectNextTab: () => void;
  selectPreviousTab: () => void;
  setZenMode: (value: boolean) => void;
  zenModeRef: React.RefObject<boolean>;
  resetLayouts: () => void;
  onOpenSettings: (category?: string) => void;
  onCloseSettings: () => void;
  onShowAddWorkspace: () => void;
  onShowCreateSession: () => void;
  onShowShortcuts: () => void;
  onShowBottomTerminal: () => void;
}

/**
 * Handles all Tauri menu events, window close events, and custom DOM events
 * dispatched from the command palette and other components.
 *
 * Uses refs for callback stability to prevent safeListen re-registration races.
 */
export function useMenuHandlers(options: MenuHandlersOptions) {
  const { resolvedTheme, setTheme } = useTheme();
  const { info: toastInfo } = useToast();

  // Refs for menu-event handler callbacks — prevents safeListen re-registration race condition.
  // Without refs, unstable callbacks cause the useEffect to re-run, tearing down the Tauri
  // listener and asynchronously re-registering it. During the async gap, menu events are lost.
  const toastInfoRef = useRef(toastInfo);
  useEffect(() => { toastInfoRef.current = toastInfo; }, [toastInfo]);

  const handleNewSessionRef = useRef(options.handleNewSession);
  const handleNewConversationRef = useRef(options.handleNewConversation);
  const handleCloseTabRef = useRef(options.handleCloseTab);
  const handleCloseFileTabRef = useRef(options.handleCloseFileTab);
  const toggleBottomTerminalRef = useRef(options.toggleBottomTerminal);
  const saveCurrentTabRef = useRef(options.saveCurrentTab);

  useEffect(() => { handleNewSessionRef.current = options.handleNewSession; }, [options.handleNewSession]);
  useEffect(() => { handleNewConversationRef.current = options.handleNewConversation; }, [options.handleNewConversation]);
  useEffect(() => { handleCloseTabRef.current = options.handleCloseTab; }, [options.handleCloseTab]);
  useEffect(() => { handleCloseFileTabRef.current = options.handleCloseFileTab; }, [options.handleCloseFileTab]);
  useEffect(() => { toggleBottomTerminalRef.current = options.toggleBottomTerminal; }, [options.toggleBottomTerminal]);
  useEffect(() => { saveCurrentTabRef.current = options.saveCurrentTab; }, [options.saveCurrentTab]);

  // Ref for selectedSessionId to use in event handlers
  const selectedSessionIdRef = useRef(useAppStore.getState().selectedSessionId);
  useEffect(() => {
    const unsub = useAppStore.subscribe((s) => {
      selectedSessionIdRef.current = s.selectedSessionId;
    });
    return unsub;
  }, []);

  // Handle Tauri menu events
  useEffect(() => {
    let cleanup: (() => void) | null = null;

    safeListen<string>('menu-event', (menuId) => {
      switch (menuId) {
        // App menu
        case 'check_for_updates':
          useUpdateStore.getState().checkForUpdates().then((result) => {
            if (result === 'up-to-date') {
              toastInfoRef.current("You're on the latest version");
            }
          });
          break;
        case 'settings':
          options.onOpenSettings();
          break;

        // File menu
        case 'new_session':
          handleNewSessionRef.current();
          break;
        case 'new_conversation':
          handleNewConversationRef.current();
          break;
        case 'create_session':
          window.dispatchEvent(new CustomEvent('create-session'));
          break;
        case 'add_workspace':
          options.onShowAddWorkspace();
          break;
        case 'save_file':
          saveCurrentTabRef.current();
          break;
        case 'close_tab': {
          // Close file tab first, then browser tab, then conversation
          const fileTabId = useAppStore.getState().selectedFileTabId;
          if (fileTabId) {
            handleCloseFileTabRef.current(fileTabId);
          } else if (ENABLE_BROWSER_TABS && useTabStore.getState().tabOrder.length > 1) {
            const tabStore = useTabStore.getState();
            const closingId = tabStore.activeTabId;
            tabStore.closeTab(closingId);
            const newActiveId = tabStore.activeTabId;
            if (newActiveId !== closingId) {
              switchToTab(newActiveId);
            }
          } else {
            handleCloseTabRef.current();
          }
          break;
        }

        // Edit > Paste (custom handler replacing native paste for image support)
        case 'edit_paste':
          (async () => {
            try {
              // Try text paste first (most common case)
              const { readText } = await import('@tauri-apps/plugin-clipboard-manager');
              const text = await readText().catch(() => '');
              if (text) {
                // Auto-convert long text to attachment (mirrors handlePaste in useChatInputAttachments)
                const { autoConvertLongText } = useSettingsStore.getState();
                if (autoConvertLongText && text.length > 5000) {
                  window.dispatchEvent(new CustomEvent('clipboard-paste-long-text', { detail: { text } }));
                  return;
                }
                document.execCommand('insertText', false, text);
                return;
              }
            } catch (err) {
              if (process.env.NODE_ENV === 'development') console.warn('Clipboard text paste failed:', err);
            }

            try {
              // No text — try image paste via Tauri clipboard plugin
              const { readImage } = await import('@tauri-apps/plugin-clipboard-manager');
              const img = await readImage();
              const { width, height } = await img.size();

              // Guard against extremely large images (e.g., 5K retina screenshots)
              const MAX_PIXELS = 4096 * 4096;
              if (width * height > MAX_PIXELS) {
                toastInfoRef.current('Image too large to paste');
                return;
              }

              const rgba = await img.rgba();

              // Convert RGBA to PNG via canvas
              const canvas = document.createElement('canvas');
              canvas.width = width;
              canvas.height = height;
              const ctx = canvas.getContext('2d');
              if (!ctx) return;
              const imageData = new ImageData(new Uint8ClampedArray(rgba), width, height);
              ctx.putImageData(imageData, 0, 0);
              const dataUrl = canvas.toDataURL('image/png');
              const base64 = dataUrl.split(',')[1];

              window.dispatchEvent(new CustomEvent('clipboard-paste-image', {
                detail: { base64, width, height, mimeType: 'image/png', size: Math.round(base64.length * 0.75) }
              }));
            } catch (err) {
              if (process.env.NODE_ENV === 'development') console.warn('Clipboard image paste failed:', err);
            }
          })();
          break;

        // Edit > Find
        case 'find':
          window.dispatchEvent(new CustomEvent('search-chat'));
          break;
        case 'find_next':
          window.dispatchEvent(new CustomEvent('search-next'));
          break;
        case 'find_previous':
          window.dispatchEvent(new CustomEvent('search-prev'));
          break;

        // View menu
        case 'toggle_left_sidebar':
          options.toggleLeftSidebar();
          break;
        case 'toggle_right_sidebar':
          if (selectedSessionIdRef.current) {
            options.toggleRightSidebar();
          }
          break;
        case 'toggle_terminal':
          toggleBottomTerminalRef.current();
          break;
        case 'command_palette':
          window.dispatchEvent(new CustomEvent('open-command-palette'));
          break;
        case 'file_picker':
          window.dispatchEvent(new CustomEvent('open-file-picker'));
          break;
        case 'open_session_manager':
          useSettingsStore.getState().setContentView({ type: 'session-manager' });
          break;
        case 'open_pr_dashboard':
          useSettingsStore.getState().setContentView({ type: 'pr-dashboard' });
          break;
        case 'open_repositories':
          useSettingsStore.getState().setContentView({ type: 'repositories' });
          break;
        case 'toggle_zen_mode':
          if (selectedSessionIdRef.current) {
            options.setZenMode(!options.zenModeRef.current);
          }
          break;
        case 'reset_layouts':
          options.resetLayouts();
          window.location.reload();
          break;
        case 'enter_full_screen':
          getCurrentWindow().then(async (win) => {
            if (win) {
              const isFullscreen = await win.isFullscreen();
              await win.setFullscreen(!isFullscreen);
            }
          });
          break;

        // Go menu
        case 'navigate_back':
          useNavigationStore.getState().goBack();
          break;
        case 'navigate_forward':
          useNavigationStore.getState().goForward();
          break;
        case 'go_to_workspace':
        case 'go_to_session':
        case 'go_to_conversation':
          window.dispatchEvent(new CustomEvent('open-command-palette'));
          break;
        case 'search_workspaces':
          window.dispatchEvent(new CustomEvent('search-workspaces'));
          break;

        // Session menu
        case 'thinking_off':
          useSettingsStore.getState().setDefaultThinkingLevel('off');
          break;
        case 'thinking_low':
          useSettingsStore.getState().setDefaultThinkingLevel('low');
          break;
        case 'thinking_medium':
          useSettingsStore.getState().setDefaultThinkingLevel('medium');
          break;
        case 'thinking_high':
          useSettingsStore.getState().setDefaultThinkingLevel('high');
          break;
        case 'thinking_max':
          useSettingsStore.getState().setDefaultThinkingLevel('max');
          break;
        case 'toggle_plan_mode':
          window.dispatchEvent(new CustomEvent('toggle-plan-mode'));
          break;
        case 'approve_plan':
          window.dispatchEvent(new CustomEvent('approve-plan'));
          break;
        case 'focus_input':
          window.dispatchEvent(new CustomEvent('focus-input'));
          break;
        case 'next_tab':
          options.selectNextTab();
          break;
        case 'previous_tab':
          options.selectPreviousTab();
          break;
        case 'quick_review':
          window.dispatchEvent(new CustomEvent('start-review', { detail: { type: 'quick' } }));
          break;
        case 'deep_review':
          window.dispatchEvent(new CustomEvent('start-review', { detail: { type: 'deep' } }));
          break;
        case 'security_audit':
          window.dispatchEvent(new CustomEvent('start-review', { detail: { type: 'security' } }));
          break;
        case 'open_in_vscode': {
          const { selectedSessionId, sessions: allSessions } = useAppStore.getState();
          const session = allSessions.find((s) => s.id === selectedSessionId);
          if (session?.worktreePath) {
            openInVSCode(session.worktreePath);
          }
          break;
        }
        case 'open_terminal':
          window.dispatchEvent(new CustomEvent('show-bottom-panel'));
          break;

        // Git menu
        case 'git_commit':
          window.dispatchEvent(new CustomEvent('git-commit'));
          break;
        case 'git_create_pr':
          window.dispatchEvent(new CustomEvent('git-create-pr'));
          break;
        case 'git_sync':
          window.dispatchEvent(new CustomEvent('git-sync'));
          break;
        case 'git_copy_branch': {
          const { selectedSessionId: sid, sessions: allSessions } = useAppStore.getState();
          const sess = allSessions.find((s) => s.id === sid);
          if (sess?.branch) {
            copyToClipboard(sess.branch);
          }
          break;
        }

        // Help menu
        case 'keyboard_shortcuts':
          window.dispatchEvent(new CustomEvent('show-shortcuts'));
          break;
        case 'release_notes':
          openUrlInBrowser('https://github.com/chatml/chatml/releases');
          break;
        case 'report_issue':
          openUrlInBrowser('https://github.com/chatml/chatml/issues/new');
          break;

        default:
          // Unhandled menu event
      }
    }).then((unlisten) => {
      cleanup = unlisten;
    });

    return () => {
      cleanup?.();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Handle window close: intercept the default Tauri close flow (which calls
  // window.destroy() and requires ACL permission) and use process.exit() instead.
  useEffect(() => {
    let cleanup: (() => void) | null = null;

    (async () => {
      try {
        const win = await getCurrentWindow();
        if (!win) return;
        cleanup = await win.onCloseRequested(async (event) => {
          event.preventDefault();
          const { exit } = await import('@tauri-apps/plugin-process');
          await exit(0);
        });
      } catch (e) {
        console.error('Failed to register close handler', e);
      }
    })();

    return () => {
      cleanup?.();
    };
  }, []);

  // Handle CommandPalette custom events
  useEffect(() => {
    const handleOpenSettings = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      options.onOpenSettings(detail?.category);
    };
    const handleCloseSettings = () => options.onCloseSettings();
    const handleSpawnAgent = () => handleNewSessionRef.current();
    const handleNewConv = () => handleNewConversationRef.current();
    const handleAddWorkspace = () => options.onShowAddWorkspace();
    const handleCreateSession = () => options.onShowCreateSession();
    const handleToggleTheme = () => {
      setTheme(resolvedTheme === 'dark' ? 'light' : 'dark');
    };
    const handleToggleLeftPanel = () => options.toggleLeftSidebar();
    const handleToggleRightPanel = () => options.toggleRightSidebar();
    const handleToggleBottomPanel = () => toggleBottomTerminalRef.current();
    const handleShowBottomPanel = () => options.onShowBottomTerminal();
    const handleOpenInVSCode = () => {
      const { selectedSessionId, sessions } = useAppStore.getState();
      const session = sessions.find((s) => s.id === selectedSessionId);
      if (session?.worktreePath) {
        openInVSCode(session.worktreePath);
      }
    };

    window.addEventListener('open-settings', handleOpenSettings);
    window.addEventListener('close-settings', handleCloseSettings);
    window.addEventListener('spawn-agent', handleSpawnAgent);
    window.addEventListener('new-conversation', handleNewConv);
    window.addEventListener('add-workspace', handleAddWorkspace);
    window.addEventListener('create-session', handleCreateSession);
    window.addEventListener('toggle-theme', handleToggleTheme);
    window.addEventListener('toggle-left-panel', handleToggleLeftPanel);
    window.addEventListener('toggle-right-panel', handleToggleRightPanel);
    window.addEventListener('toggle-bottom-panel', handleToggleBottomPanel);
    window.addEventListener('show-bottom-panel', handleShowBottomPanel);
    window.addEventListener('open-in-vscode', handleOpenInVSCode);

    return () => {
      window.removeEventListener('open-settings', handleOpenSettings);
      window.removeEventListener('close-settings', handleCloseSettings);
      window.removeEventListener('spawn-agent', handleSpawnAgent);
      window.removeEventListener('new-conversation', handleNewConv);
      window.removeEventListener('add-workspace', handleAddWorkspace);
      window.removeEventListener('create-session', handleCreateSession);
      window.removeEventListener('toggle-theme', handleToggleTheme);
      window.removeEventListener('toggle-left-panel', handleToggleLeftPanel);
      window.removeEventListener('toggle-right-panel', handleToggleRightPanel);
      window.removeEventListener('toggle-bottom-panel', handleToggleBottomPanel);
      window.removeEventListener('show-bottom-panel', handleShowBottomPanel);
      window.removeEventListener('open-in-vscode', handleOpenInVSCode);
    };
  }, [options, resolvedTheme, setTheme]);
}
