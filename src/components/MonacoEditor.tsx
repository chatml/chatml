'use client';

import { useRef, useEffect, useCallback } from 'react';
import Editor, { DiffEditor, OnMount, OnChange } from '@monaco-editor/react';
import type { editor } from 'monaco-editor';
import { useTheme } from 'next-themes';
import { Loader2 } from 'lucide-react';

// Map file extensions to Monaco language identifiers
function getMonacoLanguage(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  const name = filename.toLowerCase();

  // Special files
  if (name === 'dockerfile' || name.endsWith('.dockerfile')) return 'dockerfile';
  if (name === 'makefile') return 'makefile';
  if (name === '.gitignore' || name === '.dockerignore') return 'plaintext';

  const langMap: Record<string, string> = {
    // JavaScript/TypeScript
    js: 'javascript',
    jsx: 'javascript',
    ts: 'typescript',
    tsx: 'typescript',
    mjs: 'javascript',
    cjs: 'javascript',
    // Web
    html: 'html',
    htm: 'html',
    css: 'css',
    scss: 'scss',
    sass: 'scss',
    less: 'less',
    // Data/Config
    json: 'json',
    yaml: 'yaml',
    yml: 'yaml',
    toml: 'plaintext',
    xml: 'xml',
    // Documentation
    md: 'markdown',
    mdx: 'markdown',
    // Programming languages
    go: 'go',
    py: 'python',
    rb: 'ruby',
    rs: 'rust',
    java: 'java',
    kt: 'kotlin',
    kts: 'kotlin',
    swift: 'swift',
    c: 'c',
    h: 'c',
    cpp: 'cpp',
    cc: 'cpp',
    hpp: 'cpp',
    cs: 'csharp',
    php: 'php',
    // Shell
    sh: 'shell',
    bash: 'shell',
    zsh: 'shell',
    ps1: 'powershell',
    // SQL
    sql: 'sql',
    // Others
    graphql: 'graphql',
    gql: 'graphql',
    prisma: 'plaintext',
    env: 'plaintext',
    lock: 'plaintext',
    txt: 'plaintext',
  };

  return langMap[ext] || 'plaintext';
}

interface EditorState {
  cursorPosition?: { line: number; column: number };
  scrollPosition?: { top: number; left: number };
}

interface MonacoEditorProps {
  content: string;
  filename: string;
  readOnly?: boolean;
  onChange?: (content: string) => void;
  onStateChange?: (state: EditorState) => void;
  initialCursorPosition?: { line: number; column: number };
  initialScrollPosition?: { top: number; left: number };
}

export function MonacoEditor({
  content,
  filename,
  readOnly = false,
  onChange,
  onStateChange,
  initialCursorPosition,
  initialScrollPosition,
}: MonacoEditorProps) {
  const { resolvedTheme } = useTheme();
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const language = getMonacoLanguage(filename);

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
        const position = editorRef.current.getPosition();
        const scrollPosition = editorRef.current.getScrollTop();
        const scrollLeft = editorRef.current.getScrollLeft();

        onStateChange({
          cursorPosition: position
            ? { line: position.lineNumber, column: position.column }
            : undefined,
          scrollPosition: { top: scrollPosition, left: scrollLeft },
        });
      }
    };
  }, [onStateChange]);

  return (
    <Editor
      height="100%"
      language={language}
      value={content}
      onChange={handleChange}
      onMount={handleMount}
      theme={resolvedTheme === 'dark' ? 'vs-dark' : 'light'}
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
        wordWrap: 'off',
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
        quickSuggestions: false,
        suggestOnTriggerCharacters: false,
        acceptSuggestionOnEnter: 'off',
        tabCompletion: 'off',
        parameterHints: { enabled: false },
      }}
    />
  );
}

interface MonacoDiffEditorProps {
  oldContent: string;
  newContent: string;
  filename: string;
  readOnly?: boolean;
}

export function MonacoDiffEditor({
  oldContent,
  newContent,
  filename,
  readOnly = true,
}: MonacoDiffEditorProps) {
  const { resolvedTheme } = useTheme();
  const language = getMonacoLanguage(filename);

  return (
    <DiffEditor
      height="100%"
      language={language}
      original={oldContent}
      modified={newContent}
      theme={resolvedTheme === 'dark' ? 'vs-dark' : 'light'}
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
        renderSideBySide: true,
        renderOverviewRuler: false,
        diffWordWrap: 'off',
        scrollbar: {
          vertical: 'auto',
          horizontal: 'auto',
          verticalScrollbarSize: 10,
          horizontalScrollbarSize: 10,
        },
        overviewRulerBorder: false,
        contextmenu: false,
      }}
    />
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
export { getMonacoLanguage };
