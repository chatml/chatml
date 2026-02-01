/**
 * Shared formatting utilities.
 */

/** Format a token count as a compact string (e.g. 1.2M, 45.3K, 800). */
export const formatTokens = (tokens: number) => {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`;
  return tokens.toString();
};
