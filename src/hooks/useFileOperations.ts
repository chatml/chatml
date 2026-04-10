import { useState, useCallback } from 'react';
import {
  createSessionFile,
  createSessionFolder,
  renameSessionFile,
  deleteSessionFile,
  duplicateSessionFile,
  moveSessionFile,
  discardSessionFileChanges,
} from '@/lib/api/file-operations';
import { listSessionFiles } from '@/lib/api';
import { invalidateSessionData } from '@/lib/sessionDataCache';
import { invalidateDiffCache } from '@/lib/diffCache';
import { invalidateFileContentCache } from '@/lib/fileContentCache';
import { useToast } from '@/components/ui/toast';

interface UseFileOperationsOptions {
  workspaceId: string | null;
  sessionId: string | null;
  onFilesRefresh?: (files: import('@/components/files/FileTree').FileNode[]) => void;
}

export function useFileOperations({ workspaceId, sessionId, onFilesRefresh }: UseFileOperationsOptions) {
  const [loading, setLoading] = useState<string | null>(null);
  const { success: showSuccess, error: showError } = useToast();

  const refreshFiles = useCallback(async () => {
    if (!workspaceId || !sessionId) return;
    // Invalidate caches so subsequent reads are fresh
    invalidateSessionData(workspaceId, sessionId);
    invalidateDiffCache(workspaceId, sessionId);
    invalidateFileContentCache(workspaceId, sessionId);
    // Re-fetch the file tree
    try {
      const files = await listSessionFiles(workspaceId, sessionId);
      onFilesRefresh?.(files);
    } catch {
      // Silently fail — the file watcher debounce will catch up
    }
  }, [workspaceId, sessionId, onFilesRefresh]);

  const createFile = useCallback(async (path: string, content: string = '') => {
    if (!workspaceId || !sessionId) return;
    setLoading('createFile');
    try {
      await createSessionFile(workspaceId, sessionId, path, content);
      showSuccess(`Created ${path.split('/').pop()}`);
      await refreshFiles();
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Failed to create file');
    } finally {
      setLoading(null);
    }
  }, [workspaceId, sessionId, refreshFiles, showSuccess, showError]);

  const createFolder = useCallback(async (path: string) => {
    if (!workspaceId || !sessionId) return;
    setLoading('createFolder');
    try {
      await createSessionFolder(workspaceId, sessionId, path);
      showSuccess(`Created ${path.split('/').pop()}/`);
      await refreshFiles();
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Failed to create folder');
    } finally {
      setLoading(null);
    }
  }, [workspaceId, sessionId, refreshFiles, showSuccess, showError]);

  const rename = useCallback(async (oldPath: string, newPath: string) => {
    if (!workspaceId || !sessionId) return;
    setLoading('rename');
    try {
      await renameSessionFile(workspaceId, sessionId, oldPath, newPath);
      showSuccess(`Renamed to ${newPath.split('/').pop()}`);
      await refreshFiles();
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Failed to rename');
    } finally {
      setLoading(null);
    }
  }, [workspaceId, sessionId, refreshFiles, showSuccess, showError]);

  const deleteFile = useCallback(async (path: string, recursive: boolean = false) => {
    if (!workspaceId || !sessionId) return;
    setLoading('delete');
    try {
      await deleteSessionFile(workspaceId, sessionId, path, recursive);
      showSuccess(`Deleted ${path.split('/').pop()}`);
      await refreshFiles();
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Failed to delete');
    } finally {
      setLoading(null);
    }
  }, [workspaceId, sessionId, refreshFiles, showSuccess, showError]);

  const duplicate = useCallback(async (sourcePath: string, destPath?: string) => {
    if (!workspaceId || !sessionId) return;
    setLoading('duplicate');
    try {
      const result = await duplicateSessionFile(workspaceId, sessionId, sourcePath, destPath);
      showSuccess(`Duplicated to ${result.newPath.split('/').pop()}`);
      await refreshFiles();
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Failed to duplicate');
    } finally {
      setLoading(null);
    }
  }, [workspaceId, sessionId, refreshFiles, showSuccess, showError]);

  const move = useCallback(async (sourcePath: string, destPath: string) => {
    if (!workspaceId || !sessionId) return;
    setLoading('move');
    try {
      await moveSessionFile(workspaceId, sessionId, sourcePath, destPath);
      showSuccess(`Moved to ${destPath}`);
      await refreshFiles();
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Failed to move');
    } finally {
      setLoading(null);
    }
  }, [workspaceId, sessionId, refreshFiles, showSuccess, showError]);

  const discard = useCallback(async (path: string) => {
    if (!workspaceId || !sessionId) return;
    setLoading('discard');
    try {
      await discardSessionFileChanges(workspaceId, sessionId, path);
      showSuccess(`Discarded changes to ${path.split('/').pop()}`);
      await refreshFiles();
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Failed to discard changes');
    } finally {
      setLoading(null);
    }
  }, [workspaceId, sessionId, refreshFiles, showSuccess, showError]);

  const deleteFiles = useCallback(async (paths: string[]) => {
    if (!workspaceId || !sessionId || paths.length === 0) return;
    setLoading('deleteFiles');
    try {
      // Pass recursive: true to handle directories in bulk delete
      await Promise.all(paths.map(p => deleteSessionFile(workspaceId, sessionId, p, true)));
      showSuccess(`Deleted ${paths.length} item${paths.length > 1 ? 's' : ''}`);
      await refreshFiles();
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Failed to delete files');
    } finally {
      setLoading(null);
    }
  }, [workspaceId, sessionId, refreshFiles, showSuccess, showError]);

  const discardChanges = useCallback(async (paths: string[]) => {
    if (!workspaceId || !sessionId || paths.length === 0) return;
    setLoading('discardChanges');
    try {
      await Promise.all(paths.map(p => discardSessionFileChanges(workspaceId, sessionId, p)));
      showSuccess(`Discarded changes to ${paths.length} file${paths.length > 1 ? 's' : ''}`);
      await refreshFiles();
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Failed to discard changes');
    } finally {
      setLoading(null);
    }
  }, [workspaceId, sessionId, refreshFiles, showSuccess, showError]);

  return {
    loading,
    createFile,
    createFolder,
    rename,
    deleteFile,
    duplicate,
    move,
    discard,
    refreshFiles,
    deleteFiles,
    discardChanges,
  };
}
