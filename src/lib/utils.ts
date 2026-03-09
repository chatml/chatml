import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Convert an absolute file path to a path relative to the worktree root.
 * Returns the original path if it's not under the worktree or if worktreePath is not provided.
 */
/** Encode a UTF-8 string to base64, safe for non-Latin1 characters. */
export function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function toRelativePath(absolutePath: string, worktreePath: string | undefined | null): string {
  if (!worktreePath || !absolutePath) return absolutePath;

  // Normalize: ensure worktreePath ends with / for prefix matching
  const prefix = worktreePath.endsWith('/') ? worktreePath : worktreePath + '/';

  if (absolutePath.startsWith(prefix)) {
    return absolutePath.slice(prefix.length);
  }

  // Exact match (path IS the worktree root)
  if (absolutePath === worktreePath) {
    return '.';
  }

  return absolutePath;
}
