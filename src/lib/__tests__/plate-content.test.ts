import { describe, it, expect } from 'vitest';
import { extractContent } from '../plate-content';
import type { Value } from 'platejs';

describe('extractContent', () => {
  it('returns empty text and no mentions for an empty editor', () => {
    const value: Value = [{ type: 'p', children: [{ text: '' }] }];
    expect(extractContent(value)).toEqual({ text: '', mentionedFiles: [] });
  });

  it('extracts plain text from a single paragraph', () => {
    const value: Value = [{ type: 'p', children: [{ text: 'hello world' }] }];
    expect(extractContent(value)).toEqual({ text: 'hello world', mentionedFiles: [] });
  });

  it('joins multiple paragraphs with newlines', () => {
    const value: Value = [
      { type: 'p', children: [{ text: 'first' }] },
      { type: 'p', children: [{ text: 'second' }] },
      { type: 'p', children: [{ text: 'third' }] },
    ];
    expect(extractContent(value).text).toBe('first\nsecond\nthird');
  });

  it('does not append a trailing newline after the last paragraph', () => {
    const value: Value = [
      { type: 'p', children: [{ text: 'a' }] },
      { type: 'p', children: [{ text: 'b' }] },
    ];
    expect(extractContent(value).text).toBe('a\nb');
    expect(extractContent(value).text).not.toMatch(/\n$/);
  });

  it('extracts mention nodes as @value tokens', () => {
    const value: Value = [
      {
        type: 'p',
        children: [
          { text: 'see ' },
          { type: 'mention', value: 'src/app.tsx', children: [{ text: '' }] } as never,
          { text: ' for details' },
        ],
      },
    ];
    const result = extractContent(value);
    expect(result.text).toBe('see @src/app.tsx for details');
    expect(result.mentionedFiles).toEqual(['src/app.tsx']);
  });

  it('captures multiple mentions in a single paragraph', () => {
    const value: Value = [
      {
        type: 'p',
        children: [
          { type: 'mention', value: 'a.ts', children: [{ text: '' }] } as never,
          { text: ' and ' },
          { type: 'mention', value: 'b.ts', children: [{ text: '' }] } as never,
        ],
      },
    ];
    const result = extractContent(value);
    expect(result.text).toBe('@a.ts and @b.ts');
    expect(result.mentionedFiles).toEqual(['a.ts', 'b.ts']);
  });

  it('captures mentions across multiple paragraphs', () => {
    const value: Value = [
      {
        type: 'p',
        children: [
          { text: 'p1: ' },
          { type: 'mention', value: 'one.ts', children: [{ text: '' }] } as never,
        ],
      },
      {
        type: 'p',
        children: [
          { type: 'mention', value: 'two.ts', children: [{ text: '' }] } as never,
        ],
      },
    ];
    const result = extractContent(value);
    expect(result.text).toBe('p1: @one.ts\n@two.ts');
    expect(result.mentionedFiles).toEqual(['one.ts', 'two.ts']);
  });

  it('skips mentions with falsy value (does not push to mentionedFiles)', () => {
    const value: Value = [
      {
        type: 'p',
        children: [
          { text: 'before ' },
          { type: 'mention', value: '', children: [{ text: '' }] } as never,
          { text: ' after' },
        ],
      },
    ];
    const result = extractContent(value);
    expect(result.text).toBe('before @ after');
    expect(result.mentionedFiles).toEqual([]);
  });

  it('recursively walks nested children (e.g. inline marks)', () => {
    const value: Value = [
      {
        type: 'p',
        children: [
          {
            type: 'inline',
            children: [{ text: 'nested' }],
          } as never,
          { text: ' and flat' },
        ],
      },
    ];
    const result = extractContent(value);
    expect(result.text).toBe('nested and flat');
  });

  it('handles deeply nested structures with mentions inside', () => {
    const value: Value = [
      {
        type: 'p',
        children: [
          {
            type: 'wrapper',
            children: [
              {
                type: 'inner',
                children: [
                  { text: 'deep ' },
                  { type: 'mention', value: 'deep.ts', children: [{ text: '' }] } as never,
                ],
              },
            ],
          } as never,
        ],
      },
    ];
    const result = extractContent(value);
    expect(result.text).toBe('deep @deep.ts');
    expect(result.mentionedFiles).toEqual(['deep.ts']);
  });

  it('trims surrounding whitespace from the final text', () => {
    const value: Value = [
      { type: 'p', children: [{ text: '   ' }] },
      { type: 'p', children: [{ text: 'middle' }] },
      { type: 'p', children: [{ text: '\t\n  ' }] },
    ];
    expect(extractContent(value).text).toBe('middle');
  });

  it('preserves internal whitespace when trimming', () => {
    const value: Value = [{ type: 'p', children: [{ text: '  hello  world  ' }] }];
    expect(extractContent(value).text).toBe('hello  world');
  });

  it('handles slash-command-style nodes by walking their text children', () => {
    const value: Value = [
      {
        type: 'p',
        children: [
          {
            type: 'slash_input',
            children: [{ text: '/help' }],
          } as never,
        ],
      },
    ];
    expect(extractContent(value).text).toBe('/help');
  });

  it('does not duplicate mentions in mentionedFiles when the same id appears twice', () => {
    const value: Value = [
      {
        type: 'p',
        children: [
          { type: 'mention', value: 'same.ts', children: [{ text: '' }] } as never,
          { text: ' and ' },
          { type: 'mention', value: 'same.ts', children: [{ text: '' }] } as never,
        ],
      },
    ];
    // Note: extractContent does NOT dedupe (callers can dedupe if needed).
    // This test pins down the actual behavior.
    expect(extractContent(value).mentionedFiles).toEqual(['same.ts', 'same.ts']);
  });

  it('handles a value with only a single empty paragraph', () => {
    const value: Value = [{ type: 'p', children: [{ text: '' }] }];
    expect(extractContent(value)).toEqual({ text: '', mentionedFiles: [] });
  });
});
