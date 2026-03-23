import { describe, it, expect } from 'vitest';
import { classifyCloneError } from '../clone-errors';

describe('classifyCloneError', () => {
  // ============================================================================
  // Signal-based abort handling
  // ============================================================================

  describe('abort signal handling', () => {
    it('returns timeout message for clone_timeout abort', () => {
      const controller = new AbortController();
      controller.abort('clone_timeout');
      const result = classifyCloneError(new Error('aborted'), controller.signal);
      expect(result).toBe('Clone timed out. The repository may be too large or the server is unreachable.');
    });

    it('returns cancelled message for user-initiated abort', () => {
      const controller = new AbortController();
      controller.abort();
      const result = classifyCloneError(new Error('aborted'), controller.signal);
      expect(result).toBe('Clone was cancelled.');
    });
  });

  // ============================================================================
  // Error message classification
  // ============================================================================

  describe('error classification', () => {
    it('classifies "already exists" errors', () => {
      const result = classifyCloneError(new Error('fatal: destination path already exists'));
      expect(result).toBe('A directory with this name already exists at the selected location.');
    });

    it('classifies "authentication failed" errors', () => {
      const result = classifyCloneError(new Error('fatal: authentication failed'));
      expect(result).toBe('Authentication failed. Please check your credentials or SSH key setup.');
    });

    it('classifies "SSH authentication" errors', () => {
      const result = classifyCloneError(new Error('SSH authentication failed for host'));
      expect(result).toBe('Authentication failed. Please check your credentials or SSH key setup.');
    });

    it('classifies "not found" errors', () => {
      const result = classifyCloneError(new Error('repository not found'));
      expect(result).toBe('Repository not found. Please check the URL and your access permissions.');
    });

    it('classifies "timed out" errors', () => {
      const result = classifyCloneError(new Error('connection timed out'));
      expect(result).toBe('Clone timed out. The repository may be too large or the server is unreachable.');
    });

    it('classifies "clone failed" errors', () => {
      const result = classifyCloneError(new Error('clone failed'));
      expect(result).toBe('Git clone failed. Please check the URL and try again.');
    });

    it('classifies "BAD_GATEWAY" errors', () => {
      const result = classifyCloneError(new Error('BAD_GATEWAY'));
      expect(result).toBe('Git clone failed. Please check the URL and try again.');
    });

    it('returns original message for unknown errors', () => {
      const result = classifyCloneError(new Error('some unusual error'));
      expect(result).toBe('some unusual error');
    });
  });

  // ============================================================================
  // Non-Error inputs
  // ============================================================================

  describe('non-Error inputs', () => {
    it('returns "Clone failed" for string input', () => {
      const result = classifyCloneError('string error');
      expect(result).toBe('Clone failed');
    });

    it('returns "Clone failed" for null input', () => {
      const result = classifyCloneError(null);
      expect(result).toBe('Clone failed');
    });

    it('returns "Clone failed" for undefined input', () => {
      const result = classifyCloneError(undefined);
      expect(result).toBe('Clone failed');
    });
  });
});
