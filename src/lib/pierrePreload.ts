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
import luaGrammar from '@shikijs/langs/lua';
import csharpGrammar from '@shikijs/langs/csharp';
import dartGrammar from '@shikijs/langs/dart';
import elixirGrammar from '@shikijs/langs/elixir';
import haskellGrammar from '@shikijs/langs/haskell';
import perlGrammar from '@shikijs/langs/perl';
import rGrammar from '@shikijs/langs/r';
import scalaGrammar from '@shikijs/langs/scala';
import zigGrammar from '@shikijs/langs/zig';
import xmlGrammar from '@shikijs/langs/xml';
import vueGrammar from '@shikijs/langs/vue';
import svelteGrammar from '@shikijs/langs/svelte';
import makeGrammar from '@shikijs/langs/makefile';
import powershellGrammar from '@shikijs/langs/powershell';
import latexGrammar from '@shikijs/langs/latex';
import objcGrammar from '@shikijs/langs/objective-c';
import jsoncGrammar from '@shikijs/langs/jsonc';
import iniGrammar from '@shikijs/langs/ini';
import hclGrammar from '@shikijs/langs/hcl';
import protobufGrammar from '@shikijs/langs/proto';

// Languages that are statically bundled and available in Tauri release builds.
// Any language NOT listed here will fail to highlight because the shiki shim
// stubs out bundledLanguages with an empty object, preventing dynamic imports.
// To add a new language: import its grammar above and add an entry below.
const LANGS: Array<[string, unknown]> = [
  ['typescript', tsGrammar],
  ['javascript', jsGrammar],
  ['tsx', tsxGrammar],
  ['jsx', jsxGrammar],
  ['json', jsonGrammar],
  ['jsonc', jsoncGrammar],
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
  ['zsh', shellGrammar],        // Pierre's getFiletypeFromFileName maps .sh/.bash → "zsh"
  ['diff', diffGrammar],
  ['dockerfile', dockerfileGrammar],
  ['graphql', graphqlGrammar],
  ['lua', luaGrammar],
  ['csharp', csharpGrammar],
  ['dart', dartGrammar],
  ['elixir', elixirGrammar],
  ['haskell', haskellGrammar],
  ['perl', perlGrammar],
  ['r', rGrammar],
  ['scala', scalaGrammar],
  ['zig', zigGrammar],
  ['xml', xmlGrammar],
  ['vue', vueGrammar],
  ['svelte', svelteGrammar],
  ['makefile', makeGrammar],
  ['powershell', powershellGrammar],
  ['latex', latexGrammar],
  ['objective-c', objcGrammar],
  ['ini', iniGrammar],
  ['hcl', hclGrammar],
  ['proto', protobufGrammar],
  ['protobuf', protobufGrammar], // Pierre's getFiletypeFromFileName maps .proto → "protobuf"
  ['tex', latexGrammar],         // Pierre's getFiletypeFromFileName maps .tex → "tex"
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

// Also register aliases declared in each grammar's metadata.
// Pierre's internal getFiletypeFromFileName may return non-canonical IDs
// (e.g. "yml" instead of "yaml") that differ from Shiki's canonical names.
// parseDiffFromFile() does NOT copy the `lang` field from FileContents to
// FileDiffMetadata, so the diff view always falls back to
// getFiletypeFromFileName(filename) — making alias coverage critical.
for (const [langName] of LANGS) {
  const resolved = langMap.get(langName);
  if (!resolved || resolved.data.length === 0) continue;
  const aliases = (resolved.data[0] as { aliases?: string[] }).aliases;
  if (!aliases) continue;
  for (const alias of aliases) {
    if (!langMap.has(alias)) {
      langMap.set(alias, { name: langName, data: resolved.data });
    }
  }
}
