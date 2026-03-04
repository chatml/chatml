/**
 * Pre-loads Pierre's Shiki themes and common language grammars statically,
 * bypassing dynamic import() calls that fail in Tauri release builds.
 *
 * Same pattern as vscodeIcons.ts — bundle the data at build time instead of
 * relying on runtime chunk loading.
 *
 * Pierre's `getResolvedOrResolveTheme` / `getResolvedOrResolveLanguage`
 * check ResolvedThemes / ResolvedLanguages first, so pre-populating these
 * maps means the dynamic-import loaders are never invoked.
 */

import {
  ResolvedThemes,
  ResolvedLanguages,
  RegisteredCustomThemes,
} from '@pierre/diffs';
import { normalizeTheme } from 'shiki';
import type { LanguageRegistration } from '@shikijs/types';

// --- Themes: import from our local JSON copies ---
// (Pierre's package exports map blocks direct imports from dist/themes/,
//  so we extracted the theme data into src/lib/pierre-themes/.)
import pierreDarkRaw from '@/lib/pierre-themes/pierre-dark.json';
import pierreLightRaw from '@/lib/pierre-themes/pierre-light.json';

// Pre-normalize and cache so Pierre skips its dynamic import() loaders entirely.
if (!ResolvedThemes.has('pierre-dark')) {
  ResolvedThemes.set(
    'pierre-dark',
    normalizeTheme(pierreDarkRaw as Parameters<typeof normalizeTheme>[0]),
  );
}
if (!ResolvedThemes.has('pierre-light')) {
  ResolvedThemes.set(
    'pierre-light',
    normalizeTheme(pierreLightRaw as Parameters<typeof normalizeTheme>[0]),
  );
}

// Also override the registered loaders so any code path that bypasses the
// ResolvedThemes cache still gets static data instead of a failing import().
// eslint-disable-next-line @typescript-eslint/no-explicit-any
RegisteredCustomThemes.set('pierre-dark', () => Promise.resolve(pierreDarkRaw as any));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
RegisteredCustomThemes.set('pierre-light', () => Promise.resolve(pierreLightRaw as any));

// --- Languages: statically import grammars for the languages we use ---
// Each @shikijs/langs/* module default-exports a LanguageRegistration[].
// Pierre stores resolved languages as { name, data: LanguageRegistration[] }.
import tsGrammar from '@shikijs/langs/typescript';
import jsGrammar from '@shikijs/langs/javascript';
import tsxGrammar from '@shikijs/langs/tsx';
import jsxGrammar from '@shikijs/langs/jsx';
import jsonGrammar from '@shikijs/langs/json';
import htmlGrammar from '@shikijs/langs/html';
import cssGrammar from '@shikijs/langs/css';
import pythonGrammar from '@shikijs/langs/python';
import rustGrammar from '@shikijs/langs/rust';
import goGrammar from '@shikijs/langs/go';
import bashGrammar from '@shikijs/langs/bash';
import markdownGrammar from '@shikijs/langs/markdown';
import yamlGrammar from '@shikijs/langs/yaml';
import tomlGrammar from '@shikijs/langs/toml';
import sqlGrammar from '@shikijs/langs/sql';
import cppGrammar from '@shikijs/langs/cpp';
import cGrammar from '@shikijs/langs/c';
import javaGrammar from '@shikijs/langs/java';
import rubyGrammar from '@shikijs/langs/ruby';
import phpGrammar from '@shikijs/langs/php';
import swiftGrammar from '@shikijs/langs/swift';
import kotlinGrammar from '@shikijs/langs/kotlin';
import scssGrammar from '@shikijs/langs/scss';
import shellGrammar from '@shikijs/langs/shellscript';
import diffGrammar from '@shikijs/langs/diff';
import dockerfileGrammar from '@shikijs/langs/dockerfile';
import graphqlGrammar from '@shikijs/langs/graphql';

const LANGS: Array<[string, unknown]> = [
  ['typescript', tsGrammar],
  ['javascript', jsGrammar],
  ['tsx', tsxGrammar],
  ['jsx', jsxGrammar],
  ['json', jsonGrammar],
  ['html', htmlGrammar],
  ['css', cssGrammar],
  ['python', pythonGrammar],
  ['rust', rustGrammar],
  ['go', goGrammar],
  ['bash', bashGrammar],
  ['markdown', markdownGrammar],
  ['yaml', yamlGrammar],
  ['toml', tomlGrammar],
  ['sql', sqlGrammar],
  ['cpp', cppGrammar],
  ['c', cGrammar],
  ['java', javaGrammar],
  ['ruby', rubyGrammar],
  ['php', phpGrammar],
  ['swift', swiftGrammar],
  ['kotlin', kotlinGrammar],
  ['scss', scssGrammar],
  ['shellscript', shellGrammar],
  ['diff', diffGrammar],
  ['dockerfile', dockerfileGrammar],
  ['graphql', graphqlGrammar],
];

interface ResolvedLang {
  name: string;
  data: LanguageRegistration[];
}

/** Extract and validate the grammar array from a @shikijs/langs/* module. */
function extractGrammar(langName: string, mod: unknown): LanguageRegistration[] {
  const data = (mod as { default?: unknown }).default ?? mod;
  if (!Array.isArray(data)) {
    console.warn(`[pierrePreload] unexpected grammar shape for "${langName}"`);
    return [];
  }
  return data as LanguageRegistration[];
}

// ResolvedLanguages is typed with SupportedLanguages keys — we know these
// are valid BundledLanguage values, so the cast is safe.
const langMap = ResolvedLanguages as Map<string, ResolvedLang>;
for (const [langName, grammar] of LANGS) {
  if (!langMap.has(langName)) {
    langMap.set(langName, {
      name: langName,
      data: extractGrammar(langName, grammar),
    });
  }
}
