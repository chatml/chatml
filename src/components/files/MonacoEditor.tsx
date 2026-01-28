'use client';

import { useRef, useEffect, useCallback, useMemo, useState } from 'react';
import Editor, { DiffEditor, OnMount, OnChange } from '@monaco-editor/react';
import type { editor } from 'monaco-editor';
import { createRoot } from 'react-dom/client';
import { Loader2, FileCode } from 'lucide-react';
import { useSettingsStore } from '@/stores/settingsStore';
import { ErrorBoundary } from '@/components/shared/ErrorBoundary';
import { BlockErrorFallback } from '@/components/shared/ErrorFallbacks';
import { registerMonacoTheme } from '@/lib/monacoThemes';
import { getMonacoLanguage } from '@/lib/languageMapping';
import { CommentZoneManager } from '@/lib/monaco/CommentZoneManager';
import { CommentThread } from '@/components/monaco/CommentThread';
import type { ReviewComment } from '@/lib/types';

interface EditorState {
  cursorPosition?: { line: number; column: number };
  scrollPosition?: { top: number; left: number };
}

interface MonacoEditorProps {
  content: string;
  filename: string;
  readOnly?: boolean;
  wordWrap?: boolean;
  onChange?: (content: string) => void;
  onStateChange?: (state: EditorState) => void;
  initialCursorPosition?: { line: number; column: number };
  initialScrollPosition?: { top: number; left: number };
}

export function MonacoEditor({
  content,
  filename,
  readOnly = false,
  wordWrap = false,
  onChange,
  onStateChange,
  initialCursorPosition,
  initialScrollPosition,
}: MonacoEditorProps) {
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const language = getMonacoLanguage(filename);
  const editorTheme = useSettingsStore((s) => s.editorTheme);
  const [activeTheme, setActiveTheme] = useState<string | null>(null);
  const [isInitialLoad, setIsInitialLoad] = useState(true);

  // Register custom theme when editorTheme changes
  // Only show loading spinner on initial load to prevent flash when switching themes
  useEffect(() => {
    registerMonacoTheme(editorTheme).then((themeId) => {
      setActiveTheme(themeId);
      setIsInitialLoad(false);
    });
  }, [editorTheme]);

  const handleMount: OnMount = useCallback((editor) => {
    editorRef.current = editor;

    // Restore cursor position if provided
    if (initialCursorPosition) {
      editor.setPosition({
        lineNumber: initialCursorPosition.line,
        column: initialCursorPosition.column,
      });
      editor.revealPositionInCenter({
        lineNumber: initialCursorPosition.line,
        column: initialCursorPosition.column,
      });
    }

    // Restore scroll position if provided
    if (initialScrollPosition) {
      editor.setScrollPosition({
        scrollTop: initialScrollPosition.top,
        scrollLeft: initialScrollPosition.left,
      });
    }

    // Focus the editor
    editor.focus();
  }, [initialCursorPosition, initialScrollPosition]);

  const handleChange: OnChange = useCallback((value) => {
    if (value !== undefined && onChange) {
      onChange(value);
    }
  }, [onChange]);

  // Save editor state before unmount
  useEffect(() => {
    return () => {
      if (editorRef.current && onStateChange) {
        try {
          const position = editorRef.current.getPosition();
          const scrollPosition = editorRef.current.getScrollTop();
          const scrollLeft = editorRef.current.getScrollLeft();

          onStateChange({
            cursorPosition: position
              ? { line: position.lineNumber, column: position.column }
              : undefined,
            scrollPosition: { top: scrollPosition, left: scrollLeft },
          });
        } catch {
          // Editor may be disposed during StrictMode double-mount
        }
      }
    };
  }, [onStateChange]);

  // Clear ref on unmount (disposal is handled by @monaco-editor/react)
  useEffect(() => {
    return () => {
      editorRef.current = null;
    };
  }, []);

  // Show loading state only on initial theme registration
  if (isInitialLoad || !activeTheme) {
    return <EditorLoading />;
  }

  return (
    <ErrorBoundary
      section="MonacoEditor"
      fallback={
        <BlockErrorFallback
          icon={FileCode}
          title="Editor failed to load"
          description="There was an error initializing the code editor"
        />
      }
    >
      <Editor
        height="100%"
        language={language}
        value={content}
        onChange={handleChange}
        onMount={handleMount}
        theme={activeTheme}
        loading={<EditorLoading />}
        options={{
          readOnly,
          minimap: { enabled: false },
          lineNumbers: 'on',
          scrollBeyondLastLine: false,
          automaticLayout: true,
          fontSize: 12,
          fontFamily: 'var(--font-mono, ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace)',
          lineHeight: 18,
          padding: { top: 8, bottom: 8 },
          renderLineHighlight: readOnly ? 'none' : 'line',
          cursorStyle: readOnly ? 'block' : 'line',
          cursorBlinking: readOnly ? 'solid' : 'blink',
          wordWrap: wordWrap ? 'on' : 'off',
          folding: true,
          foldingStrategy: 'indentation',
          showFoldingControls: 'mouseover',
          bracketPairColorization: { enabled: true },
          scrollbar: {
            vertical: 'auto',
            horizontal: 'auto',
            verticalScrollbarSize: 10,
            horizontalScrollbarSize: 10,
          },
          overviewRulerBorder: false,
          hideCursorInOverviewRuler: true,
          contextmenu: !readOnly,
          // Enable find widget (Cmd/Ctrl+F)
          find: {
            addExtraSpaceOnTop: false,
            autoFindInSelection: 'multiline',
            seedSearchStringFromSelection: 'selection',
          },
          // Enable IntelliSense features for editable editors
          quickSuggestions: !readOnly,
          suggestOnTriggerCharacters: !readOnly,
          acceptSuggestionOnEnter: readOnly ? 'off' : 'on',
          tabCompletion: readOnly ? 'off' : 'on',
          parameterHints: { enabled: !readOnly },
        }}
      />
    </ErrorBoundary>
  );
}

interface MonacoDiffEditorProps {
  oldContent: string;
  newContent: string;
  filename: string;
  readOnly?: boolean;
  sideBySide?: boolean;
  wordWrap?: boolean;
  // Review comments support
  comments?: ReviewComment[];
  onResolveComment?: (id: string, resolved: boolean) => void;
  onDeleteComment?: (id: string) => void;
}

export function MonacoDiffEditor({
  oldContent,
  newContent,
  filename,
  readOnly = true,
  sideBySide = true,
  wordWrap = false,
  comments,
  onResolveComment,
  onDeleteComment,
}: MonacoDiffEditorProps) {
  const language = getMonacoLanguage(filename);
  const editorRef = useRef<editor.IStandaloneDiffEditor | null>(null);
  const commentZoneManagerRef = useRef<CommentZoneManager | null>(null);
  const editorTheme = useSettingsStore((s) => s.editorTheme);
  const [activeTheme, setActiveTheme] = useState<string | null>(null);
  const [isInitialLoad, setIsInitialLoad] = useState(true);

  // Register custom theme when editorTheme changes
  // Only show loading spinner on initial load to prevent flash when switching themes
  useEffect(() => {
    registerMonacoTheme(editorTheme).then((themeId) => {
      setActiveTheme(themeId);
      setIsInitialLoad(false);
    });
  }, [editorTheme]);

  // Update sideBySide option when it changes without remounting
  useEffect(() => {
    if (editorRef.current) {
      editorRef.current.updateOptions({ renderSideBySide: sideBySide });
    }
  }, [sideBySide]);

  // Update diff editor content when props change
  // Note: This only syncs content, not language. If the filename changes to a different
  // language, the model language won't update since Monaco models are tied to their
  // language at creation. In practice, this component is typically used with a fixed
  // filename within a single mount lifecycle, so this is acceptable.
  useEffect(() => {
    if (editorRef.current) {
      const modifiedEditor = editorRef.current.getModifiedEditor();
      const originalEditor = editorRef.current.getOriginalEditor();
      const modifiedModel = modifiedEditor.getModel();
      const originalModel = originalEditor.getModel();

      if (modifiedModel && modifiedModel.getValue() !== newContent) {
        modifiedModel.setValue(newContent);
      }
      if (originalModel && originalModel.getValue() !== oldContent) {
        originalModel.setValue(oldContent);
      }
    }
  }, [oldContent, newContent]);

  const handleMount = useCallback((editor: editor.IStandaloneDiffEditor) => {
    editorRef.current = editor;

    // Initialize CommentZoneManager on the modified editor (right side)
    // Comments are shown on the new/modified code
    const modifiedEditor = editor.getModifiedEditor();

    if (onResolveComment) {
      const manager = new CommentZoneManager(modifiedEditor, {
        onResolve: onResolveComment,
        onDelete: onDeleteComment,
      });

      // Set up render callback for creating React components
      manager.setRenderCallback((comment, container, root) => {
        root.render(
          <CommentThread
            comment={comment}
            onResolve={onResolveComment}
            onDelete={onDeleteComment}
          />
        );
      });

      commentZoneManagerRef.current = manager;

      // Set initial comments if provided
      if (comments && comments.length > 0) {
        manager.setComments(comments);
      }
    }

    // Scroll to the first change after the diff is computed
    // Use a small delay to ensure diff computation is complete
    setTimeout(() => {
      const lineChanges = editor.getLineChanges();
      if (lineChanges && lineChanges.length > 0) {
        const firstChange = lineChanges[0];
        // Use the modified line number (right side) for positioning
        const targetLine = firstChange.modifiedStartLineNumber || firstChange.originalStartLineNumber || 1;
        modifiedEditor.revealLineInCenter(targetLine);
      }
    }, 50);
  }, [comments, onResolveComment, onDeleteComment]);

  // Update comments when they change
  useEffect(() => {
    if (commentZoneManagerRef.current && comments) {
      commentZoneManagerRef.current.setComments(comments);
    }
  }, [comments]);

  // Dispose comment manager and clear ref on unmount
  // (editor disposal is handled by @monaco-editor/react)
  useEffect(() => {
    return () => {
      if (commentZoneManagerRef.current) {
        commentZoneManagerRef.current.dispose();
        commentZoneManagerRef.current = null;
      }
      editorRef.current = null;
    };
  }, []);

  // Memoize options to prevent unnecessary re-renders
  const options = useMemo(() => ({
    readOnly,
    minimap: { enabled: false },
    lineNumbers: 'on' as const,
    scrollBeyondLastLine: false,
    automaticLayout: true,
    fontSize: 12,
    fontFamily: 'var(--font-mono, ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace)',
    lineHeight: 18,
    padding: { top: 8, bottom: 8 },
    renderSideBySide: sideBySide,
    useInlineViewWhenSpaceIsLimited: false, // Prevent auto-switch to unified based on width
    enableSplitViewResizing: true,
    renderIndicators: true,
    renderOverviewRuler: true,
    diffWordWrap: (wordWrap ? 'on' : 'off') as 'on' | 'off',
    wordWrap: (wordWrap ? 'on' : 'off') as 'on' | 'off',
    scrollbar: {
      vertical: 'auto' as const,
      horizontal: 'auto' as const,
      verticalScrollbarSize: 10,
      horizontalScrollbarSize: 10,
    },
    overviewRulerBorder: false,
    contextmenu: false,
  }), [readOnly, sideBySide, wordWrap]);

  // Show loading state only on initial theme registration
  if (isInitialLoad || !activeTheme) {
    return <EditorLoading />;
  }

  return (
    <ErrorBoundary
      section="MonacoDiffEditor"
      fallback={
        <BlockErrorFallback
          icon={FileCode}
          title="Diff editor failed to load"
          description="There was an error initializing the diff editor"
        />
      }
    >
      <DiffEditor
        height="100%"
        language={language}
        original={oldContent}
        modified={newContent}
        originalModelPath={`original://${filename}`}
        modifiedModelPath={`modified://${filename}`}
        theme={activeTheme}
        loading={<EditorLoading />}
        onMount={handleMount}
        options={options}
      />
    </ErrorBoundary>
  );
}

function EditorLoading() {
  return (
    <div className="h-full flex items-center justify-center bg-background">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin" />
        <span className="text-sm">Loading editor...</span>
      </div>
    </div>
  );
}

// Re-export the language detection function for use elsewhere
export { getMonacoLanguage } from '@/lib/languageMapping';
