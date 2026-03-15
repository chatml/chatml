/**
 * Lightweight shim for the 'shiki' package.
 *
 * Re-exports only what Pierre (@pierre/diffs) and pierrePreload.ts need,
 * sourced from shiki/core and shiki/engine/javascript subpaths. This
 * completely bypasses shiki's main entry (bundle-full.mjs) which statically
 * imports the Oniguruma WASM engine and hundreds of dynamic import() calls
 * for bundled languages/themes — all of which fail in Tauri release builds
 * where the frontend is served via the tauri:// asset protocol.
 *
 * The Turbopack resolveAlias for 'shiki' only matches the bare specifier,
 * so 'shiki/core' and 'shiki/engine/javascript' resolve to the real package.
 *
 * Themes and languages are pre-populated by pierrePreload.ts, so the
 * bundledLanguages / bundledThemes fallbacks are never reached at runtime.
 */

// --- From shiki/core (re-exports @shikijs/core) ---
export {
  // Used by Pierre's shared_highlighter.js. Aliased from createHighlighterCore
  // because Pierre passes explicit engine/themes/langs options, so the core
  // API is compatible. If Pierre upgrades and starts relying on
  // createHighlighter's implicit bundled defaults, this alias will break.
  createHighlighterCore as createHighlighter,
  // Used by Pierre's resolveTheme.js and pierrePreload.ts
  normalizeTheme,
  // Used by Pierre's index.js
  codeToHtml,
  // Used by Pierre's index.js and registerCustomCSSVariableTheme.js
  createCssVariablesTheme,
  // Used by Pierre's createSpanNodeFromToken.js
  getTokenStyleObject,
  stringifyTokenStyle,
} from 'shiki/core';

// --- From shiki/engine/javascript ---
// Used by Pierre's shared_highlighter.js — JS regex engine, no WASM required
export { createJavaScriptRegexEngine } from 'shiki/engine/javascript';

// --- From shiki/engine/oniguruma ---
// Pierre 1.1.0 imports createOnigurumaEngine but only uses it as a fallback
// when no engine option is provided. Our pierrePreload.ts always supplies the
// JS regex engine, so this is never called at runtime. Export it so the import
// resolves, but it will throw if actually invoked (we can't load WASM in Tauri).
export { createOnigurumaEngine } from 'shiki/engine/oniguruma';

// --- Empty stubs ---
// pierrePreload.ts pre-populates common languages/themes into Pierre's
// ResolvedLanguages / ResolvedThemes maps, so these bundled fallbacks are
// never accessed at runtime for pre-loaded languages. Any language NOT
// pre-loaded in pierrePreload.ts will fail to highlight because Pierre's
// resolveLanguage() looks up bundledLanguages[lang] and throws when it
// finds undefined. To support a new language, add it to pierrePreload.ts.
export const bundledLanguages: Record<string, unknown> = {};
export const bundledThemes: Record<string, unknown> = {};
