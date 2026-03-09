import { loader } from '@monaco-editor/react';

// Point Monaco loader to self-hosted files (copied from node_modules at build time).
// This avoids CDN fetches which are blocked by Tauri's CSP.
loader.config({ paths: { vs: '/vs' } });

/** Custom dark theme matching the app's color scheme (based on Pierre dark theme). */
export const MONACO_DARK_THEME = 'chatml-dark';

/** Custom light theme matching the app's color scheme (based on Pierre light theme). */
export const MONACO_LIGHT_THEME = 'chatml-light';

/**
 * Define custom Monaco themes. Call this once before mounting any editor.
 * Safe to call multiple times (idempotent via the flag).
 */
let themesRegistered = false;

export function registerMonacoThemes(monaco: typeof import('monaco-editor')) {
  if (themesRegistered) return;
  themesRegistered = true;

  monaco.editor.defineTheme(MONACO_DARK_THEME, {
    base: 'vs-dark',
    inherit: true,
    rules: [],
    colors: {
      'editor.background': '#070707',
      'editor.foreground': '#fbfbfb',
      'editor.selectionBackground': '#009fff4d',
      'editor.lineHighlightBackground': '#19283c8c',
      'editorCursor.foreground': '#009fff',
      'editorLineNumber.foreground': '#84848A',
      'editorLineNumber.activeForeground': '#adadb1',
      'editorIndentGuide.background': '#39393c',
      'editorIndentGuide.activeBackground': '#2e2e30',
    },
  });

  monaco.editor.defineTheme(MONACO_LIGHT_THEME, {
    base: 'vs',
    inherit: true,
    rules: [],
    colors: {
      'editor.background': '#ffffff',
      'editor.foreground': '#1a1a1a',
      'editor.selectionBackground': '#009fff33',
      'editor.lineHighlightBackground': '#f0f4f8',
      'editorCursor.foreground': '#009fff',
      'editorLineNumber.foreground': '#999999',
      'editorLineNumber.activeForeground': '#666666',
    },
  });
}
