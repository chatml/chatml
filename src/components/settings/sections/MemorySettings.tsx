'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { Plus, Trash2, RefreshCw } from 'lucide-react';
import {
  listMemoryFiles,
  getMemoryFile,
  saveMemoryFile,
  deleteMemoryFile,
  type MemoryFileInfo,
} from '@/lib/api';

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

export function MemorySettings({ workspaceId }: { workspaceId: string }) {
  const [files, setFiles] = useState<MemoryFileInfo[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [content, setContent] = useState('');
  const [savedContent, setSavedContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newFileName, setNewFileName] = useState('');
  const { error: showError } = useToast();

  const loadFiles = useCallback(async () => {
    try {
      const data = await listMemoryFiles(workspaceId);
      setFiles(data);
      return data;
    } catch {
      // Memory directory may not exist yet — treat as empty
      setFiles([]);
      return [];
    }
  }, [workspaceId]);

  const loadFileContent = useCallback(async (name: string) => {
    try {
      const file = await getMemoryFile(workspaceId, name);
      setContent(file.content);
      setSavedContent(file.content);
      setSelectedFile(name);
    } catch {
      showError(`Failed to load ${name}`);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  useEffect(() => {
    setLoading(true);
    loadFiles().then((data) => {
      // Auto-select MEMORY.md if it exists
      const memoryFile = data.find((f) => f.name === 'MEMORY.md');
      if (memoryFile) {
        loadFileContent('MEMORY.md');
      }
    }).finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  const handleRefresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await loadFiles();
      if (selectedFile) {
        const stillExists = data.find((f) => f.name === selectedFile);
        if (stillExists) {
          await loadFileContent(selectedFile);
        } else {
          setSelectedFile(null);
          setContent('');
          setSavedContent('');
        }
      }
    } finally {
      setLoading(false);
    }
  }, [loadFiles, loadFileContent, selectedFile]);

  const handleSave = useCallback(async () => {
    if (!selectedFile) return;
    setSaving(true);
    try {
      await saveMemoryFile(workspaceId, selectedFile, content);
      setSavedContent(content);
      await loadFiles();
    } catch {
      showError('Failed to save memory file');
    } finally {
      setSaving(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, selectedFile, content, loadFiles]);

  const handleCreate = useCallback(async () => {
    const name = newFileName.trim();
    if (!name) return;
    const fileName = name.endsWith('.md') ? name : `${name}.md`;
    try {
      await saveMemoryFile(workspaceId, fileName, '');
      setNewFileName('');
      setCreating(false);
      await loadFiles();
      await loadFileContent(fileName);
    } catch {
      showError('Failed to create memory file');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, newFileName, loadFiles, loadFileContent]);

  const handleDelete = useCallback(async (name: string) => {
    if (!window.confirm(`Delete ${name}?`)) return;
    try {
      await deleteMemoryFile(workspaceId, name);
      if (selectedFile === name) {
        setSelectedFile(null);
        setContent('');
        setSavedContent('');
      }
      await loadFiles();
    } catch {
      showError('Failed to delete memory file');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, selectedFile, loadFiles]);

  const handleCreateMemory = useCallback(async () => {
    try {
      await saveMemoryFile(workspaceId, 'MEMORY.md', '');
      await loadFiles();
      await loadFileContent('MEMORY.md');
    } catch {
      showError('Failed to create MEMORY.md');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, loadFiles, loadFileContent]);

  const hasChanges = content !== savedContent;

  if (loading && files.length === 0) {
    return (
      <div>
        <h2 className="text-xl font-semibold mb-1">Project Memory</h2>
        <p className="text-sm text-muted-foreground">Loading...</p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-xl font-semibold">Project Memory</h2>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={handleRefresh}
          disabled={loading}
          title="Refresh"
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </Button>
      </div>
      <p className="text-sm text-muted-foreground mb-6">
        Memory files are loaded into the agent&apos;s context for every conversation.
        They persist preferences, coding conventions, and project-specific knowledge across sessions.
        Use the <code className="text-xs bg-muted px-1 py-0.5 rounded">/remember</code> command in chat to save memories.
      </p>

      {files.length === 0 && !creating ? (
        <div className="border rounded-md p-6 text-center">
          <p className="text-sm text-muted-foreground mb-3">
            No memory files yet. Create MEMORY.md to get started.
          </p>
          <Button size="sm" onClick={handleCreateMemory}>
            Create MEMORY.md
          </Button>
        </div>
      ) : (
        <>
          {/* File list */}
          <div className="border rounded-md divide-y mb-4">
            {files.map((file) => (
              <div
                key={file.name}
                className={`flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-muted/50 transition-colors ${
                  selectedFile === file.name ? 'bg-muted' : ''
                }`}
                onClick={() => {
                  if (hasChanges && !window.confirm('Discard unsaved changes?')) return;
                  loadFileContent(file.name);
                }}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-sm font-medium truncate">{file.name}</span>
                  <span className="text-xs text-muted-foreground shrink-0">
                    {formatSize(file.size)}
                  </span>
                </div>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete(file.name);
                  }}
                  title={`Delete ${file.name}`}
                >
                  <Trash2 className="w-3.5 h-3.5 text-muted-foreground" />
                </Button>
              </div>
            ))}
          </div>

          {/* New file input */}
          {creating ? (
            <div className="flex items-center gap-2 mb-4">
              <Input
                className="text-sm"
                placeholder="filename.md"
                value={newFileName}
                onChange={(e) => setNewFileName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCreate();
                  if (e.key === 'Escape') {
                    setCreating(false);
                    setNewFileName('');
                  }
                }}
                autoFocus
              />
              <Button size="sm" onClick={handleCreate} disabled={!newFileName.trim()}>
                Create
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => { setCreating(false); setNewFileName(''); }}
              >
                Cancel
              </Button>
            </div>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="mb-4"
              onClick={() => setCreating(true)}
            >
              <Plus className="w-3.5 h-3.5 mr-1.5" />
              New File
            </Button>
          )}

          {/* Editor */}
          {selectedFile && (
            <div>
              <div className="text-sm font-medium text-muted-foreground mb-2">
                Editing: {selectedFile}
              </div>
              <Textarea
                className="text-sm min-h-[300px] font-mono"
                value={content}
                onChange={(e) => setContent(e.target.value)}
              />
              {hasChanges && (
                <div className="mt-3 flex justify-end">
                  <Button size="sm" disabled={saving} onClick={handleSave}>
                    {saving ? 'Saving...' : 'Save'}
                  </Button>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
