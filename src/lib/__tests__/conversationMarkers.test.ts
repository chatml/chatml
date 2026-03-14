import { describe, it, expect } from 'vitest';
import { extractMarkers } from '../conversationMarkers';
import type { Message } from '@/lib/types';

function makeMessage(overrides: Partial<Message> & { id: string; role: Message['role'] }): Message {
  return {
    content: '',
    timestamp: Date.now(),
    ...overrides,
  } as Message;
}

describe('extractMarkers', () => {
  it('returns empty array for no messages', () => {
    expect(extractMarkers([])).toEqual([]);
  });

  it('creates user markers for user messages with content', () => {
    const messages = [
      makeMessage({ id: 'u1', role: 'user', content: 'Hello world' }),
      makeMessage({ id: 'a1', role: 'assistant', content: 'Hi there' }),
    ];
    const markers = extractMarkers(messages);
    expect(markers).toHaveLength(1);
    expect(markers[0]).toEqual({
      id: 'u1',
      index: 0,
      type: 'user',
      title: 'Hello world',
    });
  });

  it('skips user messages with only whitespace', () => {
    const messages = [
      makeMessage({ id: 'u1', role: 'user', content: '   ' }),
    ];
    expect(extractMarkers(messages)).toEqual([]);
  });

  it('creates plan markers from planContent', () => {
    const messages = [
      makeMessage({ id: 'a1', role: 'assistant', content: 'response', planContent: '# My Plan\nStep 1' }),
    ];
    const markers = extractMarkers(messages);
    expect(markers).toHaveLength(1);
    expect(markers[0]).toEqual({
      id: 'a1-plan',
      index: 0,
      type: 'plan',
      title: 'My Plan Step 1',
    });
  });

  it('creates plan markers from timeline plan entries', () => {
    const messages = [
      makeMessage({
        id: 'a1',
        role: 'assistant',
        content: '',
        timeline: [{ type: 'plan', content: 'Plan from timeline' }],
      }),
    ];
    const markers = extractMarkers(messages);
    expect(markers).toHaveLength(1);
    expect(markers[0].type).toBe('plan');
    expect(markers[0].title).toBe('Plan from timeline');
  });

  it('truncates long titles to 60 chars with ellipsis', () => {
    const longContent = 'A'.repeat(100);
    const messages = [
      makeMessage({ id: 'u1', role: 'user', content: longContent }),
    ];
    const markers = extractMarkers(messages);
    expect(markers[0].title).toHaveLength(61); // 60 chars + ellipsis
    expect(markers[0].title.endsWith('…')).toBe(true);
  });

  it('strips markdown heading prefixes', () => {
    const messages = [
      makeMessage({ id: 'a1', role: 'assistant', content: '', planContent: '### My Plan Title' }),
    ];
    const markers = extractMarkers(messages);
    expect(markers[0].title).toBe('My Plan Title');
  });

  it('creates both user and plan markers from same message list', () => {
    const messages = [
      makeMessage({ id: 'u1', role: 'user', content: 'Please plan' }),
      makeMessage({ id: 'a1', role: 'assistant', content: 'Here is my plan', planContent: 'Step 1: do stuff' }),
    ];
    const markers = extractMarkers(messages);
    expect(markers).toHaveLength(2);
    expect(markers[0].type).toBe('user');
    expect(markers[1].type).toBe('plan');
  });

  it('preserves message index correctly', () => {
    const messages = [
      makeMessage({ id: 'a0', role: 'assistant', content: 'greeting' }),
      makeMessage({ id: 'u1', role: 'user', content: 'question' }),
      makeMessage({ id: 'a1', role: 'assistant', content: 'answer' }),
      makeMessage({ id: 'u2', role: 'user', content: 'follow up' }),
    ];
    const markers = extractMarkers(messages);
    expect(markers).toHaveLength(2);
    expect(markers[0].index).toBe(1);
    expect(markers[1].index).toBe(3);
  });
});
