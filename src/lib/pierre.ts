/**
 * Barrel module for Pierre (@pierre/diffs).
 *
 * The side-effect import of pierrePreload ensures that themes and language
 * grammars are pre-populated in Pierre's internal Maps before any component
 * tries to render. This prevents dynamic import() calls that fail in Tauri
 * release builds.
 *
 * All Pierre consumers should import from '@/lib/pierre' instead of
 * '@pierre/diffs' or '@pierre/diffs/react' directly.
 */
import '@/lib/pierrePreload';

// ⚠️ DO NOT import from '@pierre/diffs' or '@pierre/diffs/react' directly.
// Add new exports here so the pierrePreload side-effect always runs first.

// React components
export { File, FileDiff } from '@pierre/diffs/react';

// Types from react entry
export type { FileContents, FileOptions, DiffLineAnnotation } from '@pierre/diffs/react';

// Utilities from main entry
export { parseDiffFromFile } from '@pierre/diffs';

// Types from main entry
export type { FileDiffOptions, FileDiffMetadata, OnDiffLineClickProps } from '@pierre/diffs';
