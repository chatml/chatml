'use client';

import { useState, useCallback, useEffect, useImperativeHandle, forwardRef } from 'react';
import { useSettingsStore } from '@/stores/settingsStore';
import { refreshClaudeAuthStatus } from '@/hooks/useClaudeAuthStatus';
import { useShortcut } from '@/hooks/useShortcut';
import { SettingsPage } from '@/components/settings/SettingsPage';
import { WorkspaceSettings } from '@/components/settings/WorkspaceSettings';
import { AddWorkspaceModal } from '@/components/dialogs/AddWorkspaceModal';
import { CreateFromPRModal } from '@/components/dialogs/CreateFromPRModal';
import { CloneFromUrlDialog } from '@/components/dialogs/CloneFromUrlDialog';
import { GitHubReposDialog } from '@/components/dialogs/GitHubReposDialog';
import { CloseTabConfirmDialog } from '@/components/dialogs/CloseTabConfirmDialog';
import { CloseFileConfirmDialog } from '@/components/dialogs/CloseFileConfirmDialog';
import { KeyboardShortcutsDialog } from '@/components/dialogs/KeyboardShortcutsDialog';
import { FilePicker } from '@/components/dialogs/FilePicker';
import { WorkspaceSearch } from '@/components/dialogs/WorkspaceSearch';
import { CommandPalette } from '@/components/dialogs/CommandPalette';
import type { RepoDTO } from '@/lib/api';

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
  const [showCreateFromPR, setShowCreateFromPR] = useState(false);
  const [showWorkspaceSettings, setShowWorkspaceSettings] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsInitialCategory, setSettingsInitialCategory] = useState<string | undefined>(undefined);
  const [showCloneFromUrl, setShowCloneFromUrl] = useState(false);
  const [showGitHubRepos, setShowGitHubRepos] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);

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

  useShortcut('createFromPR', useCallback(() => {
    setShowCreateFromPR(true);
  }, []));

  // Expose dialog openers for use by parent via the returned object
  const openSettings = useCallback((category?: string) => {
    if (category) setSettingsInitialCategory(category);
    setShowSettings(true);
  }, []);

  const closeSettings = useCallback(() => {
    setShowSettings(false);
    setSettingsInitialCategory(undefined);
    refreshClaudeAuthStatus();
  }, []);

  const openWorkspaceSettings = useCallback((workspaceId: string) => {
    expandWorkspace(workspaceId);
    setShowWorkspaceSettings(workspaceId);
  }, [expandWorkspace]);

  // Expose dialog openers to parent via ref
  useImperativeHandle(ref, () => ({
    openSettings,
    closeSettings,
    showAddWorkspace: () => setShowAddWorkspace(true),
    showCreateFromPR: () => setShowCreateFromPR(true),
    showCloneFromUrl: () => setShowCloneFromUrl(true),
    showGitHubRepos: () => setShowGitHubRepos(true),
    showShortcuts: () => setShowShortcuts(true),
    openWorkspaceSettings,
  }), [openSettings, closeSettings, openWorkspaceSettings]);

  return (
    <>
      {/* Settings Overlay - full screen */}
      {showSettings && (
        <div className="absolute inset-0 z-20 bg-content-background">
          <SettingsPage
            initialCategory={settingsInitialCategory as 'general' | 'ai-models' | undefined}
            onBack={closeSettings}
          />
        </div>
      )}

      {/* Workspace Settings Overlay - full screen */}
      {showWorkspaceSettings && (
        <div className="absolute inset-0 z-20 bg-content-background">
          <WorkspaceSettings
            workspaceId={showWorkspaceSettings}
            onBack={() => setShowWorkspaceSettings(null)}
          />
        </div>
      )}

      {/* Add Workspace Modal */}
      <AddWorkspaceModal
        isOpen={showAddWorkspace}
        onClose={() => setShowAddWorkspace(false)}
      />

      {/* Create Session from PR/Branch Modal */}
      <CreateFromPRModal
        isOpen={showCreateFromPR}
        onClose={() => setShowCreateFromPR(false)}
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
    </>
  );
});

// Type for imperative handle exposed via ref
export type DialogManagerHandles = {
  openSettings: (category?: string) => void;
  closeSettings: () => void;
  showAddWorkspace: () => void;
  showCreateFromPR: () => void;
  showCloneFromUrl: () => void;
  showGitHubRepos: () => void;
  showShortcuts: () => void;
  openWorkspaceSettings: (workspaceId: string) => void;
};
