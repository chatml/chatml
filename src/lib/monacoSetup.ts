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
    rules: [
      // Comments
      { token: 'comment', foreground: '84848A' },

      // Strings
      { token: 'string', foreground: '5ecc71' },
      { token: 'string.escape', foreground: '68cdf2' },

      // Numbers & booleans
      { token: 'number', foreground: '68cdf2' },
      { token: 'number.hex', foreground: '68cdf2' },
      { token: 'number.float', foreground: '68cdf2' },

      // Constants
      { token: 'constant', foreground: 'ffd452' },

      // Keywords & storage
      { token: 'keyword', foreground: 'ff678d' },
      { token: 'keyword.control', foreground: 'ff678d' },
      { token: 'keyword.flow', foreground: 'ff678d' },

      // Types & classes
      { token: 'type', foreground: 'd568ea' },
      { token: 'type.identifier', foreground: 'd568ea' },

      // Functions
      { token: 'function', foreground: '9d6afb' },

      // Variables
      { token: 'variable', foreground: 'ffa359' },
      { token: 'variable.predefined', foreground: 'ffca00' },
      { token: 'variable.parameter', foreground: 'adadb1' },

      // Operators
      { token: 'operator', foreground: '79797F' },

      // Delimiters & punctuation
      { token: 'delimiter', foreground: '79797F' },
      { token: 'delimiter.bracket', foreground: '79797F' },
      { token: 'delimiter.parenthesis', foreground: '79797F' },
      { token: 'delimiter.square', foreground: '79797F' },
      { token: 'delimiter.curly', foreground: '79797F' },
      { token: 'delimiter.angle', foreground: '79797F' },
      { token: 'delimiter.array', foreground: '79797F' },

      // HTML/JSX tags & attributes
      { token: 'tag', foreground: 'ff6762' },
      { token: 'metatag', foreground: '79797F' },
      { token: 'attribute.name', foreground: '61d5c0' },
      { token: 'attribute.value', foreground: '5ecc71' },

      // Regexp
      { token: 'regexp', foreground: '64d1db' },

      // Namespace & annotations
      { token: 'namespace', foreground: 'ffca00' },
      { token: 'annotation', foreground: '08c0ef' },

      // JSON
      { token: 'string.key.json', foreground: 'ff6762' },
      { token: 'string.value.json', foreground: '5ecc71' },

      // CSS
      { token: 'tag.css', foreground: 'ff6762' },
      { token: 'attribute.value.css', foreground: 'ffd452' },
      { token: 'attribute.value.number.css', foreground: '68cdf2' },
      { token: 'attribute.value.unit.css', foreground: 'ff6762' },
      { token: 'attribute.value.hex.css', foreground: '68cdf2' },
    ],
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
    rules: [
      // Comments
      { token: 'comment', foreground: '84848A' },

      // Strings
      { token: 'string', foreground: '199f43' },
      { token: 'string.escape', foreground: '1ca1c7' },

      // Numbers & booleans
      { token: 'number', foreground: '1ca1c7' },
      { token: 'number.hex', foreground: '1ca1c7' },
      { token: 'number.float', foreground: '1ca1c7' },

      // Constants
      { token: 'constant', foreground: 'd5a910' },

      // Keywords & storage
      { token: 'keyword', foreground: 'fc2b73' },
      { token: 'keyword.control', foreground: 'fc2b73' },
      { token: 'keyword.flow', foreground: 'fc2b73' },

      // Types & classes
      { token: 'type', foreground: 'c635e4' },
      { token: 'type.identifier', foreground: 'c635e4' },

      // Functions
      { token: 'function', foreground: '7b43f8' },

      // Variables
      { token: 'variable', foreground: 'd47628' },
      { token: 'variable.predefined', foreground: 'd5a910' },
      { token: 'variable.parameter', foreground: '79797F' },

      // Operators
      { token: 'operator', foreground: '79797F' },

      // Delimiters & punctuation
      { token: 'delimiter', foreground: '79797F' },
      { token: 'delimiter.bracket', foreground: '79797F' },
      { token: 'delimiter.parenthesis', foreground: '79797F' },
      { token: 'delimiter.square', foreground: '79797F' },
      { token: 'delimiter.curly', foreground: '79797F' },
      { token: 'delimiter.angle', foreground: '79797F' },
      { token: 'delimiter.array', foreground: '79797F' },

      // HTML/JSX tags & attributes
      { token: 'tag', foreground: 'd52c36' },
      { token: 'metatag', foreground: '79797F' },
      { token: 'attribute.name', foreground: '16a994' },
      { token: 'attribute.value', foreground: '199f43' },

      // Regexp
      { token: 'regexp', foreground: '17a5af' },

      // Namespace & annotations
      { token: 'namespace', foreground: 'd5a910' },
      { token: 'annotation', foreground: '08c0ef' },

      // JSON
      { token: 'string.key.json', foreground: 'd52c36' },
      { token: 'string.value.json', foreground: '199f43' },

      // CSS
      { token: 'tag.css', foreground: 'd52c36' },
      { token: 'attribute.value.css', foreground: 'd5a910' },
      { token: 'attribute.value.number.css', foreground: '1ca1c7' },
      { token: 'attribute.value.unit.css', foreground: 'd52c36' },
      { token: 'attribute.value.hex.css', foreground: '1ca1c7' },
    ],
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
