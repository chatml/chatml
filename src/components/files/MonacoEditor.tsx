'use client';

import { memo, useCallback, useRef, useEffect, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { Loader2, FileCode } from 'lucide-react';
import { useResolvedThemeType } from '@/hooks/useResolvedThemeType';
import { getMonacoLanguage } from '@/lib/monacoLanguageMapping';
import {
  registerMonacoThemes,
  MONACO_DARK_THEME,
  MONACO_LIGHT_THEME,
} from '@/lib/monacoSetup';
import { ErrorBoundary } from '@/components/shared/ErrorBoundary';
import { BlockErrorFallback } from '@/components/shared/ErrorFallbacks';
import type { OnMount, BeforeMount } from '@monaco-editor/react';

// Dynamic import — Monaco must not be SSR'd
const Editor = dynamic(
  () => import('@monaco-editor/react').then((mod) => mod.Editor),
  {
    ssr: false,
    loading: () => <EditorLoading />,
  },
);

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

interface MonacoEditorProps {
  content: string;
  filename: string;
  onChange?: (content: string) => void;
}

export const MonacoEditor = memo(function MonacoEditor({
  content,
  filename,
  onChange,
}: MonacoEditorProps) {
  const themeType = useResolvedThemeType();
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
  const onChangeRef = useRef(onChange);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep ref in sync so the debounced handler always calls the latest callback
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const language = getMonacoLanguage(filename);
  const theme = themeType === 'dark' ? MONACO_DARK_THEME : MONACO_LIGHT_THEME;
  const readOnly = !onChange;

  const handleBeforeMount: BeforeMount = useCallback((monaco) => {
    registerMonacoThemes(monaco);
  }, []);

  const handleMount: OnMount = useCallback((editor) => {
    editorRef.current = editor;
    editor.focus();
  }, []);

  // Debounce onChange to avoid updating the store on every keystroke
  const handleChange = useCallback(
    (value: string | undefined) => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = setTimeout(() => {
        onChangeRef.current?.(value ?? '');
      }, 150);
    },
    [], // stable — uses refs only
  );

  // Clear refs and pending timer on unmount
  useEffect(() => {
    return () => {
      editorRef.current = null;
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, []);

  const options = useMemo(
    () => ({
      readOnly,
      minimap: { enabled: false },
      lineNumbers: 'on' as const,
      scrollBeyondLastLine: false,
      automaticLayout: true,
      fontSize: 12,
      fontFamily:
        'var(--font-mono, ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace)',
      lineHeight: 18,
      tabSize: 2,
      padding: { top: 8, bottom: 8 },
      renderLineHighlight: readOnly ? ('none' as const) : ('line' as const),
      cursorStyle: readOnly ? ('block' as const) : ('line' as const),
      cursorBlinking: readOnly ? ('solid' as const) : ('blink' as const),
      wordWrap: 'off' as const,
      folding: true,
      foldingStrategy: 'indentation' as const,
      showFoldingControls: 'mouseover' as const,
      bracketPairColorization: { enabled: true },
      scrollbar: {
        vertical: 'auto' as const,
        horizontal: 'auto' as const,
        verticalScrollbarSize: 10,
        horizontalScrollbarSize: 10,
      },
      overviewRulerBorder: false,
      hideCursorInOverviewRuler: true,
      contextmenu: !readOnly,
      // Cmd/Ctrl+F find widget
      find: {
        addExtraSpaceOnTop: false,
        autoFindInSelection: 'multiline' as const,
        seedSearchStringFromSelection: 'selection' as const,
      },
      // IntelliSense features only for editable mode
      quickSuggestions: !readOnly,
      suggestOnTriggerCharacters: !readOnly,
      acceptSuggestionOnEnter: readOnly ? ('off' as const) : ('on' as const),
      tabCompletion: readOnly ? ('off' as const) : ('on' as const),
      parameterHints: { enabled: !readOnly },
    }),
    [readOnly],
  );

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
        theme={theme}
        defaultValue={content}
        options={options}
        loading={<EditorLoading />}
        beforeMount={handleBeforeMount}
        onMount={handleMount}
        onChange={handleChange}
      />
    </ErrorBoundary>
  );
});
