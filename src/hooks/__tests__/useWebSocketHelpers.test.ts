import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  normalizeUsage,
  isAuthErrorMessage,
  isAgentEvent,
  isAgentTodoItemArray,
  isValidConversationStatus,
  isModelUsageRecord,
  isUserQuestionArray,
  isMcpServerStatusArray,
  getWsUrl,
  mapStatus,
  notifyBackgroundSession,
  BATCHABLE_EVENTS,
  RECONCILIATION_SUPPRESSED_EVENTS,
  DROP_STATS_DEBOUNCE_MS,
  getLastDropStatsFetchTime,
  updateLastDropStatsFetchTime,
} from '../useWebSocketHelpers';
import { useAppStore } from '@/stores/appStore';
import { useSettingsStore } from '@/stores/settingsStore';

// Lightweight mock for playSound — sound playback is a side effect we just want to observe.
vi.mock('@/lib/sounds', () => ({
  playSound: vi.fn(),
}));

import { playSound } from '@/lib/sounds';

describe('lib hooks/useWebSocketHelpers', () => {
  describe('normalizeUsage', () => {
    it('returns undefined for undefined input', () => {
      expect(normalizeUsage(undefined)).toBeUndefined();
    });

    it('returns undefined when both token counts are missing', () => {
      expect(normalizeUsage({})).toBeUndefined();
      expect(normalizeUsage({ cache_read_input_tokens: 5 })).toBeUndefined();
    });

    it('normalizes snake_case keys to camelCase', () => {
      const usage = normalizeUsage({
        input_tokens: 100,
        output_tokens: 50,
        cache_read_input_tokens: 20,
        cache_creation_input_tokens: 10,
      });
      expect(usage).toEqual({
        inputTokens: 100,
        outputTokens: 50,
        cacheReadInputTokens: 20,
        cacheCreationInputTokens: 10,
      });
    });

    it('accepts already-camelCase keys', () => {
      const usage = normalizeUsage({
        inputTokens: 100,
        outputTokens: 50,
      });
      expect(usage?.inputTokens).toBe(100);
      expect(usage?.outputTokens).toBe(50);
    });

    it('snake_case takes precedence when both forms are present', () => {
      const usage = normalizeUsage({
        input_tokens: 100,
        inputTokens: 999,
      });
      expect(usage?.inputTokens).toBe(100);
    });

    it('treats missing output as 0', () => {
      const usage = normalizeUsage({ input_tokens: 100 });
      expect(usage?.outputTokens).toBe(0);
    });

    it('skips non-numeric values via num() helper', () => {
      const usage = normalizeUsage({
        input_tokens: '100' as unknown as number,
        output_tokens: 50,
      });
      // input becomes 0 (unrecognized string), output stays at 50
      expect(usage?.inputTokens).toBe(0);
      expect(usage?.outputTokens).toBe(50);
    });
  });

  describe('isAuthErrorMessage', () => {
    it.each([
      ['Authentication failed'],
      ['Invalid API key'],
      ['OAuth token expired'],
      ['AWS credentials missing'],
    ])('matches %s', (msg) => {
      expect(isAuthErrorMessage(msg)).toBe(true);
    });

    it.each([
      ['Network error'],
      ['Timeout'],
      ['Internal server error'],
    ])('does not match %s', (msg) => {
      expect(isAuthErrorMessage(msg)).toBe(false);
    });

    it('is case-insensitive', () => {
      expect(isAuthErrorMessage('AUTHENTICATION ERROR')).toBe(true);
      expect(isAuthErrorMessage('api key invalid')).toBe(true);
    });
  });

  describe('isAgentEvent', () => {
    it('rejects non-objects', () => {
      expect(isAgentEvent(null)).toBe(false);
      expect(isAgentEvent(undefined)).toBe(false);
      expect(isAgentEvent('text')).toBe(false);
      expect(isAgentEvent(42)).toBe(false);
    });

    it('accepts objects with type field', () => {
      expect(isAgentEvent({ type: 'foo' })).toBe(true);
    });

    it('accepts objects with content field', () => {
      expect(isAgentEvent({ content: 'hello' })).toBe(true);
    });

    it('accepts objects with todos array', () => {
      expect(isAgentEvent({ todos: [] })).toBe(true);
    });

    it('rejects objects without recognized fields', () => {
      expect(isAgentEvent({ random: 1 })).toBe(false);
    });
  });

  describe('isAgentTodoItemArray', () => {
    it('accepts valid array of todos', () => {
      expect(isAgentTodoItemArray([
        { content: 'Do thing', status: 'pending', activeForm: 'Doing thing' },
        { content: 'Do other', status: 'completed', activeForm: 'Doing other' },
      ])).toBe(true);
    });

    it('rejects non-arrays', () => {
      expect(isAgentTodoItemArray({})).toBe(false);
      expect(isAgentTodoItemArray(null)).toBe(false);
    });

    it('rejects array with invalid status', () => {
      expect(isAgentTodoItemArray([
        { content: 'Do thing', status: 'unknown', activeForm: 'Doing' },
      ])).toBe(false);
    });

    it('rejects array missing required fields', () => {
      expect(isAgentTodoItemArray([{ content: 'foo' }])).toBe(false);
    });
  });

  describe('isValidConversationStatus', () => {
    it.each([
      ['active', true],
      ['idle', true],
      ['completed', true],
      ['running', false],
      ['error', false],
      ['', false],
      [42, false],
      [null, false],
    ])('returns %s for input %p', (input, expected) => {
      expect(isValidConversationStatus(input)).toBe(expected);
    });
  });

  describe('isModelUsageRecord', () => {
    it('accepts record with model usage entries', () => {
      expect(isModelUsageRecord({
        'claude-sonnet-4-6': { inputTokens: 100, outputTokens: 50 },
      })).toBe(true);
    });

    it('accepts empty record', () => {
      expect(isModelUsageRecord({})).toBe(true);
    });

    it('rejects null', () => {
      expect(isModelUsageRecord(null)).toBe(false);
    });

    it('rejects entries missing input/output token numbers', () => {
      expect(isModelUsageRecord({
        'claude-sonnet-4-6': { inputTokens: 100 },
      })).toBe(false);
    });

    it('rejects entries with non-numeric tokens', () => {
      expect(isModelUsageRecord({
        'claude-sonnet-4-6': { inputTokens: '100', outputTokens: 50 },
      })).toBe(false);
    });
  });

  describe('isUserQuestionArray', () => {
    it('accepts well-formed user question array', () => {
      expect(isUserQuestionArray([
        { question: 'Pick one', header: 'Choice', options: [] },
      ])).toBe(true);
    });

    it('rejects non-arrays', () => {
      expect(isUserQuestionArray({})).toBe(false);
    });

    it('rejects entries missing required fields', () => {
      expect(isUserQuestionArray([{ question: 'a' }])).toBe(false);
    });

    it('rejects entries where options is not array', () => {
      expect(isUserQuestionArray([
        { question: 'a', header: 'b', options: 'not array' },
      ])).toBe(false);
    });
  });

  describe('isMcpServerStatusArray', () => {
    it('accepts well-formed mcp status array', () => {
      expect(isMcpServerStatusArray([
        { name: 'github', status: 'connected' },
      ])).toBe(true);
    });

    it('rejects non-arrays', () => {
      expect(isMcpServerStatusArray('connected')).toBe(false);
    });

    it('rejects entries missing fields', () => {
      expect(isMcpServerStatusArray([{ name: 'github' }])).toBe(false);
    });
  });

  describe('getWsUrl', () => {
    afterEach(() => {
      Object.defineProperty(window, '__TAURI__', { value: undefined, writable: true });
      vi.unstubAllEnvs();
    });

    it('falls back to the hardcoded default when not in Tauri and no env override', () => {
      vi.stubEnv('NEXT_PUBLIC_WS_URL', '');
      // Pin the exact default so a typo in the constant fails the test.
      expect(getWsUrl()).toBe('ws://localhost:9876/ws');
    });

    it('uses NEXT_PUBLIC_WS_URL when set and not in Tauri', () => {
      vi.stubEnv('NEXT_PUBLIC_WS_URL', 'wss://staging.example.com/ws');
      expect(getWsUrl()).toBe('wss://staging.example.com/ws');
    });

    it('uses the dynamic backend port when running inside Tauri (env override is ignored)', () => {
      // Tauri detection wins: the backend port is dynamic and only known in
      // the Tauri runtime, so the env override is intentionally bypassed.
      vi.stubEnv('NEXT_PUBLIC_WS_URL', 'wss://staging.example.com/ws');
      Object.defineProperty(window, '__TAURI__', { value: {}, writable: true });
      const url = getWsUrl();
      expect(url).not.toBe('wss://staging.example.com/ws');
      expect(url).toMatch(/^ws:\/\/localhost:\d+\/ws$/);
    });
  });

  describe('mapStatus', () => {
    it.each([
      ['running', 'active'],
      ['pending', 'idle'],
      ['done', 'done'],
      ['error', 'error'],
      ['unknown', 'idle'],
      ['', 'idle'],
    ])('maps %s → %s', (input, expected) => {
      expect(mapStatus(input)).toBe(expected);
    });
  });

  describe('BATCHABLE_EVENTS / RECONCILIATION_SUPPRESSED_EVENTS', () => {
    it('BATCHABLE_EVENTS includes core streaming events', () => {
      expect(BATCHABLE_EVENTS.has('assistant_text')).toBe(true);
      expect(BATCHABLE_EVENTS.has('thinking_delta')).toBe(true);
      expect(BATCHABLE_EVENTS.has('todo_update')).toBe(true);
    });

    it('BATCHABLE_EVENTS does NOT include lifecycle events', () => {
      expect(BATCHABLE_EVENTS.has('init')).toBe(false);
      expect(BATCHABLE_EVENTS.has('result')).toBe(false);
      expect(BATCHABLE_EVENTS.has('turn_complete')).toBe(false);
    });

    it('RECONCILIATION_SUPPRESSED_EVENTS includes content events', () => {
      expect(RECONCILIATION_SUPPRESSED_EVENTS.has('assistant_text')).toBe(true);
      expect(RECONCILIATION_SUPPRESSED_EVENTS.has('tool_start')).toBe(true);
    });

    it('RECONCILIATION_SUPPRESSED_EVENTS does NOT include lifecycle events', () => {
      expect(RECONCILIATION_SUPPRESSED_EVENTS.has('result')).toBe(false);
      expect(RECONCILIATION_SUPPRESSED_EVENTS.has('turn_complete')).toBe(false);
      expect(RECONCILIATION_SUPPRESSED_EVENTS.has('conversation_status')).toBe(false);
    });
  });

  describe('drop stats fetch debounce', () => {
    afterEach(() => {
      // Reset module-level state between tests
      updateLastDropStatsFetchTime(0);
    });

    it('exposes a debounce constant of 3000ms', () => {
      expect(DROP_STATS_DEBOUNCE_MS).toBe(3000);
    });

    it('starts at 0 and updates monotonically', () => {
      expect(getLastDropStatsFetchTime()).toBe(0);
      updateLastDropStatsFetchTime(1000);
      expect(getLastDropStatsFetchTime()).toBe(1000);
      updateLastDropStatsFetchTime(2000);
      expect(getLastDropStatsFetchTime()).toBe(2000);
    });
  });

  describe('notifyBackgroundSession', () => {
    beforeEach(() => {
      vi.mocked(playSound).mockClear();
    });

    it('does nothing when conversation is not found', () => {
      useAppStore.setState({ conversations: [], selectedSessionId: null });
      expect(() => notifyBackgroundSession('missing-conv')).not.toThrow();
      expect(playSound).not.toHaveBeenCalled();
    });

    it('does nothing when conversation belongs to currently-selected session', () => {
      useAppStore.setState({
        conversations: [
          { id: 'conv-1', sessionId: 'session-foreground' } as never,
        ],
        selectedSessionId: 'session-foreground',
      });
      const markUnread = vi.fn();
      useSettingsStore.setState({ markSessionUnread: markUnread } as never);

      notifyBackgroundSession('conv-1');

      expect(markUnread).not.toHaveBeenCalled();
      expect(playSound).not.toHaveBeenCalled();
    });

    it('marks session unread when conversation is in a background session', () => {
      const markUnread = vi.fn();
      useAppStore.setState({
        conversations: [{ id: 'conv-1', sessionId: 'session-bg' } as never],
        selectedSessionId: 'session-foreground',
      });
      useSettingsStore.setState({
        markSessionUnread: markUnread,
        soundEffects: false,
      } as never);

      notifyBackgroundSession('conv-1');

      expect(markUnread).toHaveBeenCalledWith('session-bg');
    });

    it('plays sound when document is focused and sound effects are enabled', () => {
      const markUnread = vi.fn();
      useAppStore.setState({
        conversations: [{ id: 'conv-1', sessionId: 'session-bg' } as never],
        selectedSessionId: 'session-foreground',
      });
      useSettingsStore.setState({
        markSessionUnread: markUnread,
        soundEffects: true,
        soundEffectType: 'classic',
      } as never);

      const focusSpy = vi.spyOn(document, 'hasFocus').mockReturnValue(true);
      notifyBackgroundSession('conv-1');
      focusSpy.mockRestore();

      expect(playSound).toHaveBeenCalledWith('classic');
    });

    it('does not play sound when document is not focused', () => {
      const markUnread = vi.fn();
      useAppStore.setState({
        conversations: [{ id: 'conv-1', sessionId: 'session-bg' } as never],
        selectedSessionId: 'session-foreground',
      });
      useSettingsStore.setState({
        markSessionUnread: markUnread,
        soundEffects: true,
        soundEffectType: 'classic',
      } as never);

      const focusSpy = vi.spyOn(document, 'hasFocus').mockReturnValue(false);
      notifyBackgroundSession('conv-1');
      focusSpy.mockRestore();

      expect(playSound).not.toHaveBeenCalled();
    });

    it('does not play sound when soundEffects is disabled', () => {
      const markUnread = vi.fn();
      useAppStore.setState({
        conversations: [{ id: 'conv-1', sessionId: 'session-bg' } as never],
        selectedSessionId: 'session-foreground',
      });
      useSettingsStore.setState({
        markSessionUnread: markUnread,
        soundEffects: false,
        soundEffectType: 'classic',
      } as never);

      const focusSpy = vi.spyOn(document, 'hasFocus').mockReturnValue(true);
      notifyBackgroundSession('conv-1');
      focusSpy.mockRestore();

      expect(playSound).not.toHaveBeenCalled();
    });
  });
});
