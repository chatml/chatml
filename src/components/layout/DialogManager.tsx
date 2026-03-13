'use client';

import { useState, useCallback, useEffect, useImperativeHandle, forwardRef } from 'react';
import { useSettingsStore } from '@/stores/settingsStore';
import { refreshClaudeAuthStatus } from '@/hooks/useClaudeAuthStatus';
import { useShortcut } from '@/hooks/useShortcut';
import { SettingsPage } from '@/components/settings/SettingsPage';
import type { WorkspaceSettingsSection } from '@/components/settings/settingsRegistry';
import { AddWorkspaceModal } from '@/components/dialogs/AddWorkspaceModal';
import { CreateSessionModal } from '@/components/dialogs/CreateSessionModal';
import { CloneFromUrlDialog } from '@/components/dialogs/CloneFromUrlDialog';
import { GitHubReposDialog } from '@/components/dialogs/GitHubReposDialog';
import { CloseTabConfirmDialog } from '@/components/dialogs/CloseTabConfirmDialog';
import { CloseFileConfirmDialog } from '@/components/dialogs/CloseFileConfirmDialog';
import { KeyboardShortcutsDialog } from '@/components/dialogs/KeyboardShortcutsDialog';
import { DotMcpTrustDialog } from '@/components/dialogs/DotMcpTrustDialog';
import { FilePicker } from '@/components/dialogs/FilePicker';
import { WorkspaceSearch } from '@/components/dialogs/WorkspaceSearch';
import { CommandPalette } from '@/components/dialogs/CommandPalette';
import type { RepoDTO, DotMcpServerInfo } from '@/lib/api';
import { setDotMcpTrust } from '@/lib/api';

interface DialogManagerProps {
  selectedWorkspaceId: string | null;
  selectedSessionId: string | null;
  // Close tab confirmation
  showCloseConfirm: boolean;
  setShowCloseConfirm: (show: boolean) => void;
  onConfirmClose: () => void;
  // Close dirty file confirmation
  pendingCloseFileTabId: string | null;
  setPendingCloseFileTabId: (id: string | null) => void;
  pendingCloseFileName: string;
  onSaveAndCloseFile: () => void;
  onDontSaveAndCloseFile: () => void;
  // Clone/GitHub
  onCloned: (repo: RepoDTO) => void;
  // Workspace settings
  expandWorkspace: (workspaceId: string) => void;
}

/**
 * Manages all modal/dialog state and renders all dialogs.
 * Consolidates 10+ dialog states that were previously in page.tsx.
 * Exposes opener functions via ref (useImperativeHandle) for parent components.
 */
export const DialogManager = forwardRef<DialogManagerHandles, DialogManagerProps>(function DialogManager({
  selectedWorkspaceId,
  selectedSessionId,
  showCloseConfirm,
  setShowCloseConfirm,
  onConfirmClose,
  pendingCloseFileTabId,
  setPendingCloseFileTabId,
  pendingCloseFileName,
  onSaveAndCloseFile,
  onDontSaveAndCloseFile,
  onCloned,
  expandWorkspace,
}, ref) {
  const [showAddWorkspace, setShowAddWorkspace] = useState(false);
  const [showCreateSession, setShowCreateSession] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsInitialCategory, setSettingsInitialCategory] = useState<string | undefined>(undefined);
  const [settingsInitialWorkspaceId, setSettingsInitialWorkspaceId] = useState<string | undefined>(undefined);
  const [settingsInitialWorkspaceSection, setSettingsInitialWorkspaceSection] = useState<WorkspaceSettingsSection | undefined>(undefined);
  const [showCloneFromUrl, setShowCloneFromUrl] = useState(false);
  const [showGitHubRepos, setShowGitHubRepos] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [dotMcpTrustState, setDotMcpTrustState] = useState<{
    open: boolean;
    workspaceId: string;
    workspaceName: string;
    servers: DotMcpServerInfo[];
  }>({ open: false, workspaceId: '', workspaceName: '', servers: [] });

  // Listen for open-settings events from other components (e.g. auth error display)
  useEffect(() => {
    const handler = () => setShowSettings(true);
    window.addEventListener('open-settings', handler);
    return () => window.removeEventListener('open-settings', handler);
  }, []);

  // Keyboard shortcut: Cmd+/ to show shortcuts dialog
  useShortcut('shortcutsDialog', useCallback(() => {
    setShowShortcuts((prev) => !prev);
  }, []));

  // Listen for show-shortcuts event from menu bar
  useEffect(() => {
    const handleShowShortcuts = () => setShowShortcuts(true);
    window.addEventListener('show-shortcuts', handleShowShortcuts);
    return () => window.removeEventListener('show-shortcuts', handleShowShortcuts);
  }, []);

  useShortcut('createSession', useCallback(() => {
    setShowCreateSession(true);
  }, []));

  // Expose dialog openers for use by parent via the returned object
  const openSettings = useCallback((category?: string) => {
    if (category) setSettingsInitialCategory(category);
    setSettingsInitialWorkspaceId(undefined);
    setSettingsInitialWorkspaceSection(undefined);
    setShowSettings(true);
  }, []);

  const closeSettings = useCallback(() => {
    setShowSettings(false);
    setSettingsInitialCategory(undefined);
    setSettingsInitialWorkspaceId(undefined);
    setSettingsInitialWorkspaceSection(undefined);
    refreshClaudeAuthStatus();
  }, []);

  const openWorkspaceSettings = useCallback((workspaceId: string) => {
    expandWorkspace(workspaceId);
    setSettingsInitialWorkspaceId(workspaceId);
    setSettingsInitialWorkspaceSection('repository');
    setSettingsInitialCategory(undefined);
    setShowSettings(true);
  }, [expandWorkspace]);

  const showDotMcpTrust = useCallback((workspaceId: string, workspaceName: string, servers: DotMcpServerInfo[]) => {
    setDotMcpTrustState({ open: true, workspaceId, workspaceName, servers });
  }, []);

  const handleDotMcpAllow = useCallback(async () => {
    try {
      await setDotMcpTrust(dotMcpTrustState.workspaceId, 'trusted');
      setDotMcpTrustState((s) => ({ ...s, open: false }));
    } catch (err) {
      console.error('Failed to save .mcp.json trust status:', err);
    }
  }, [dotMcpTrustState.workspaceId]);

  const handleDotMcpDeny = useCallback(async () => {
    try {
      await setDotMcpTrust(dotMcpTrustState.workspaceId, 'denied');
      setDotMcpTrustState((s) => ({ ...s, open: false }));
    } catch (err) {
      console.error('Failed to save .mcp.json trust status:', err);
    }
  }, [dotMcpTrustState.workspaceId]);

  // Expose dialog openers to parent via ref
  useImperativeHandle(ref, () => ({
    openSettings,
    closeSettings,
    showAddWorkspace: () => setShowAddWorkspace(true),
    showCreateSession: () => setShowCreateSession(true),
    showCloneFromUrl: () => setShowCloneFromUrl(true),
    showGitHubRepos: () => setShowGitHubRepos(true),
    showShortcuts: () => setShowShortcuts(true),
    openWorkspaceSettings,
    showDotMcpTrust,
  }), [openSettings, closeSettings, openWorkspaceSettings, showDotMcpTrust]);

  return (
    <>
      {/* Settings Overlay - full screen (unified: app + workspace settings) */}
      {showSettings && (
        <div className="absolute inset-0 z-20 bg-content-background">
          <SettingsPage
            initialCategory={settingsInitialCategory as 'general' | 'ai-models' | undefined}
            initialWorkspaceId={settingsInitialWorkspaceId}
            initialWorkspaceSection={settingsInitialWorkspaceSection}
            onBack={closeSettings}
          />
        </div>
      )}

      {/* Add Workspace Modal */}
      <AddWorkspaceModal
        isOpen={showAddWorkspace}
        onClose={() => setShowAddWorkspace(false)}
      />

      {/* Create Session from PR/Branch Modal */}
      <CreateSessionModal
        isOpen={showCreateSession}
        onClose={() => setShowCreateSession(false)}
      />

      {/* Clone from URL Dialog */}
      <CloneFromUrlDialog
        isOpen={showCloneFromUrl}
        onClose={() => setShowCloneFromUrl(false)}
        onCloned={(repo) => onCloned(repo)}
      />

      {/* GitHub Repos Dialog */}
      <GitHubReposDialog
        isOpen={showGitHubRepos}
        onClose={() => setShowGitHubRepos(false)}
        onCloned={(repo) => onCloned(repo)}
      />

      {/* Close Tab Confirmation Dialog */}
      <CloseTabConfirmDialog
        open={showCloseConfirm}
        onOpenChange={setShowCloseConfirm}
        onConfirm={onConfirmClose}
      />

      {/* Close Dirty File Confirmation Dialog */}
      <CloseFileConfirmDialog
        open={pendingCloseFileTabId !== null}
        onOpenChange={(open) => {
          if (!open) setPendingCloseFileTabId(null);
        }}
        fileName={pendingCloseFileName}
        onSave={onSaveAndCloseFile}
        onDontSave={onDontSaveAndCloseFile}
      />

      {/* File Picker (Cmd+P) */}
      <FilePicker
        workspaceId={selectedWorkspaceId}
        sessionId={selectedSessionId}
      />

      {/* Workspace Search (Cmd+Shift+F) */}
      <WorkspaceSearch />

      {/* Keyboard Shortcuts Dialog (Cmd+/) */}
      <KeyboardShortcutsDialog
        open={showShortcuts}
        onOpenChange={setShowShortcuts}
      />

      {/* Command Palette (Cmd+K) */}
      <CommandPalette />

      {/* .mcp.json Trust Dialog */}
      <DotMcpTrustDialog
        open={dotMcpTrustState.open}
        onOpenChange={(open) => setDotMcpTrustState((s) => ({ ...s, open }))}
        workspaceName={dotMcpTrustState.workspaceName}
        servers={dotMcpTrustState.servers}
        onAllow={handleDotMcpAllow}
        onDeny={handleDotMcpDeny}
      />
    </>
  );
});

// Type for imperative handle exposed via ref
export type DialogManagerHandles = {
  openSettings: (category?: string) => void;
  closeSettings: () => void;
  showAddWorkspace: () => void;
  showCreateSession: () => void;
  showCloneFromUrl: () => void;
  showGitHubRepos: () => void;
  showShortcuts: () => void;
  openWorkspaceSettings: (workspaceId: string) => void;
  showDotMcpTrust: (workspaceId: string, workspaceName: string, servers: DotMcpServerInfo[]) => void;
};
