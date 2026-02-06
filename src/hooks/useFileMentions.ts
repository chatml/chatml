import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { listSessionFiles, type FileNodeDTO } from '@/lib/api';

const MAX_FILE_RESULTS = 50;

// Flat file for search results
export interface FlatFile {
  path: string;
  name: string;
  directory: string;
}

interface TriggerResult {
  active: boolean;
  query: string;
  triggerPos: number;
}

// Detect @ trigger in text before cursor
function detectAtTrigger(text: string, cursorPosition: number): TriggerResult {
  const inactive: TriggerResult = { active: false, query: '', triggerPos: -1 };

  if (!text || cursorPosition === 0) return inactive;

  const textBeforeCursor = text.slice(0, cursorPosition);

  // Find the last @ that's not escaped and not part of an email
  let atPos = -1;
  for (let i = textBeforeCursor.length - 1; i >= 0; i--) {
    if (textBeforeCursor[i] === '@') {
      // Check it's not part of an email (no alphanumeric before it)
      if (i === 0 || /\s/.test(textBeforeCursor[i - 1])) {
        atPos = i;
        break;
      }
    }
    // Stop if we hit whitespace (no @ trigger in this word)
    if (/\s/.test(textBeforeCursor[i])) break;
  }

  if (atPos === -1) return inactive;

  const query = textBeforeCursor.slice(atPos + 1);

  // Don't trigger if query contains space (user moved on)
  if (query.includes(' ')) return inactive;

  return { active: true, query, triggerPos: atPos };
}

// Flatten file tree into searchable list
function flattenFileTree(nodes: FileNodeDTO[], parentPath: string = ''): FlatFile[] {
  const result: FlatFile[] = [];

  for (const node of nodes) {
    if (node.isDir) {
      if (node.children) {
        result.push(...flattenFileTree(node.children, node.path));
      }
    } else {
      const directory = parentPath || node.path.split('/').slice(0, -1).join('/');
      result.push({
        path: node.path,
        name: node.name,
        directory,
      });
    }
  }

  return result;
}

// Filter files by query
function filterFiles(files: FlatFile[], query: string): FlatFile[] {
  if (!query) return files.slice(0, MAX_FILE_RESULTS); // Limit initial display

  const lowerQuery = query.toLowerCase();

  return files
    .filter((f) => {
      const lowerPath = f.path.toLowerCase();
      const lowerName = f.name.toLowerCase();
      return lowerName.includes(lowerQuery) || lowerPath.includes(lowerQuery);
    })
    .slice(0, MAX_FILE_RESULTS);
}

export interface UseFileMentionsReturn {
  isOpen: boolean;
  query: string;
  files: FlatFile[];
  selectedIndex: number;
  isLoading: boolean;
  triggerPos: number;

  handleTextChange: (text: string, cursorPos: number) => void;
  handleKeyDown: (e: React.KeyboardEvent) => boolean;
  selectFile: (file: FlatFile) => void;
  dismiss: () => void;
  setSelectedIndex: (index: number) => void;
}

interface UseFileMentionsOptions {
  workspaceId: string | null;
  sessionId: string | null;
  onSelectFile: (file: FlatFile, triggerPos: number) => void;
}

export function useFileMentions({
  workspaceId,
  sessionId,
  onSelectFile,
}: UseFileMentionsOptions): UseFileMentionsReturn {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [allFiles, setAllFiles] = useState<FlatFile[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const triggerPosRef = useRef(-1);
  const cachedSessionRef = useRef<string | null>(null);
  const hasLoadedFilesRef = useRef(false);

  // Clear cache when session/workspace changes to prevent stale data
  useEffect(() => {
    cachedSessionRef.current = null;
    hasLoadedFilesRef.current = false;
    setAllFiles([]);
  }, [workspaceId, sessionId]);

  const filteredFiles = useMemo(
    () => filterFiles(allFiles, query),
    [allFiles, query]
  );

  const loadFiles = useCallback(async () => {
    if (!workspaceId || !sessionId) return;
    if (cachedSessionRef.current === sessionId && hasLoadedFilesRef.current) return;

    setIsLoading(true);
    try {
      const data = await listSessionFiles(workspaceId, sessionId, 'all');
      const flat = flattenFileTree(data);
      setAllFiles(flat);
      cachedSessionRef.current = sessionId;
      hasLoadedFilesRef.current = true;
    } catch (err) {
      console.error('Failed to load files for mentions:', err);
      setAllFiles([]);
      hasLoadedFilesRef.current = false;
    } finally {
      setIsLoading(false);
    }
  }, [workspaceId, sessionId]);

  const dismiss = useCallback(() => {
    setIsOpen(false);
    setQuery('');
    setSelectedIndex(0);
    triggerPosRef.current = -1;
  }, []);

  const selectFile = useCallback(
    (file: FlatFile) => {
      const triggerPos = triggerPosRef.current;
      dismiss();
      onSelectFile(file, triggerPos);
    },
    [dismiss, onSelectFile]
  );

  const handleTextChange = useCallback(
    (text: string, cursorPos: number) => {
      const trigger = detectAtTrigger(text, cursorPos);

      if (trigger.active) {
        if (!isOpen) {
          loadFiles();
        }
        triggerPosRef.current = trigger.triggerPos;
        setQuery(trigger.query);
        setIsOpen(true);
        setSelectedIndex(0);
      } else {
        if (isOpen) dismiss();
      }
    },
    [isOpen, dismiss, loadFiles]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent): boolean => {
      if (!isOpen || filteredFiles.length === 0) return false;

      switch (e.key) {
        case 'ArrowDown': {
          e.preventDefault();
          setSelectedIndex((prev) => (prev + 1) % filteredFiles.length);
          return true;
        }
        case 'ArrowUp': {
          e.preventDefault();
          setSelectedIndex((prev) => (prev - 1 + filteredFiles.length) % filteredFiles.length);
          return true;
        }
        case 'Enter':
        case 'Tab': {
          e.preventDefault();
          const selected = filteredFiles[selectedIndex];
          if (selected) {
            selectFile(selected);
          }
          return true;
        }
        case 'Escape': {
          e.preventDefault();
          dismiss();
          return true;
        }
        default:
          return false;
      }
    },
    [isOpen, filteredFiles, selectedIndex, selectFile, dismiss]
  );

  return {
    isOpen,
    query,
    files: filteredFiles,
    selectedIndex,
    isLoading,
    triggerPos: triggerPosRef.current,
    handleTextChange,
    handleKeyDown,
    selectFile,
    dismiss,
    setSelectedIndex,
  };
}
