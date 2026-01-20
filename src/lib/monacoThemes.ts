import { loader } from '@monaco-editor/react';

// Import all theme JSON files from local copy
import monokaiTheme from '@/lib/themes/Monokai.json';
import draculaTheme from '@/lib/themes/Dracula.json';
import nordTheme from '@/lib/themes/Nord.json';
import nightOwlTheme from '@/lib/themes/Night Owl.json';
import githubDarkTheme from '@/lib/themes/GitHub Dark.json';
import oceanicNextTheme from '@/lib/themes/Oceanic Next.json';
import tomorrowNightTheme from '@/lib/themes/Tomorrow-Night.json';
import cobalt2Theme from '@/lib/themes/Cobalt2.json';
import solarizedDarkTheme from '@/lib/themes/Solarized-dark.json';
import githubLightTheme from '@/lib/themes/GitHub Light.json';
import solarizedLightTheme from '@/lib/themes/Solarized-light.json';
import tomorrowTheme from '@/lib/themes/Tomorrow.json';
import xcodeTheme from '@/lib/themes/Xcode_default.json';

// Theme definition with metadata
export interface EditorTheme {
  id: string;
  name: string;
  isDark: boolean;
}

// Curated list of popular editor themes
// Ordered: built-in first, then dark themes, then light themes
export const EDITOR_THEMES: EditorTheme[] = [
  // Built-in themes
  { id: 'vs-dark', name: 'Dark (Default)', isDark: true },
  { id: 'vs', name: 'Light (Default)', isDark: false },

  // Popular dark themes
  { id: 'monokai', name: 'Monokai', isDark: true },
  { id: 'dracula', name: 'Dracula', isDark: true },
  { id: 'nord', name: 'Nord', isDark: true },
  { id: 'night-owl', name: 'Night Owl', isDark: true },
  { id: 'github-dark', name: 'GitHub Dark', isDark: true },
  { id: 'oceanic-next', name: 'Oceanic Next', isDark: true },
  { id: 'tomorrow-night', name: 'Tomorrow Night', isDark: true },
  { id: 'cobalt2', name: 'Cobalt2', isDark: true },
  { id: 'solarized-dark', name: 'Solarized Dark', isDark: true },

  // Popular light themes
  { id: 'github-light', name: 'GitHub Light', isDark: false },
  { id: 'solarized-light', name: 'Solarized Light', isDark: false },
  { id: 'tomorrow', name: 'Tomorrow', isDark: false },
  { id: 'xcode', name: 'Xcode', isDark: false },
];

// Map theme IDs to their imported data
const themeDataMap: Record<string, unknown> = {
  monokai: monokaiTheme,
  dracula: draculaTheme,
  nord: nordTheme,
  'night-owl': nightOwlTheme,
  'github-dark': githubDarkTheme,
  'oceanic-next': oceanicNextTheme,
  'tomorrow-night': tomorrowNightTheme,
  cobalt2: cobalt2Theme,
  'solarized-dark': solarizedDarkTheme,
  'github-light': githubLightTheme,
  'solarized-light': solarizedLightTheme,
  tomorrow: tomorrowTheme,
  xcode: xcodeTheme,
};

// Cache for registered themes
const registeredThemes = new Set<string>(['vs', 'vs-dark', 'hc-black', 'hc-light']);

/**
 * Register a Monaco theme from the monaco-themes package.
 * Returns the theme ID to use with Monaco.
 * Built-in themes are returned immediately without registration.
 */
export async function registerMonacoTheme(themeId: string): Promise<string> {
  // Already registered or built-in
  if (registeredThemes.has(themeId)) {
    return themeId;
  }

  const themeData = themeDataMap[themeId];
  if (!themeData) {
    // Unknown theme, fall back to vs-dark
    console.warn(`Unknown editor theme: ${themeId}, falling back to vs-dark`);
    return 'vs-dark';
  }

  try {
    const monaco = await loader.init();

    // Register the theme with Monaco
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    monaco.editor.defineTheme(themeId, themeData as any);
    registeredThemes.add(themeId);

    return themeId;
  } catch (error) {
    console.error(`Failed to load editor theme: ${themeId}`, error);
    return 'vs-dark';
  }
}

/**
 * Get theme metadata by ID
 */
export function getThemeById(themeId: string): EditorTheme | undefined {
  return EDITOR_THEMES.find((t) => t.id === themeId);
}
