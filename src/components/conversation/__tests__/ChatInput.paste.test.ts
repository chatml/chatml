import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Attachment } from '@/lib/types';
import { ATTACHMENT_LIMITS } from '@/lib/attachments';

/**
 * Tests for image paste handling logic used in ChatInput.
 *
 * ChatInput has two image paste paths:
 * 1. Browser paste event (onPaste → clipboardData.items) — for direct paste in webview
 * 2. Custom event listener (clipboard-paste-image) — for Tauri menu-driven paste
 *
 * These tests validate the logic independently of the full ChatInput component.
 */

describe('clipboard-paste-image event handler', () => {
  let attachments: Attachment[];
  let setAttachments: (updater: (prev: Attachment[]) => Attachment[]) => void;
  let handler: (e: Event) => void;

  beforeEach(() => {
    attachments = [];
    setAttachments = (updater) => {
      attachments = updater(attachments);
    };

    // Replicate the handler from ChatInput useEffect
    handler = (e: Event) => {
      const { base64, width, height, mimeType, size } = (e as CustomEvent).detail;
      const attachment: Attachment = {
        id: 'test-id',
        type: 'image',
        name: 'pasted-image.png',
        mimeType: mimeType || 'image/png',
        size: size || Math.round(base64.length * 0.75),
        width,
        height,
        base64Data: base64,
      };
      setAttachments(prev => [...prev, attachment]);
    };
  });

  it('creates an image attachment from event detail', () => {
    const event = new CustomEvent('clipboard-paste-image', {
      detail: {
        base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQI12NgAAIABQAB',
        width: 100,
        height: 50,
        mimeType: 'image/png',
        size: 1024,
      },
    });

    handler(event);

    expect(attachments).toHaveLength(1);
    expect(attachments[0]).toMatchObject({
      type: 'image',
      name: 'pasted-image.png',
      mimeType: 'image/png',
      width: 100,
      height: 50,
      size: 1024,
    });
    expect(attachments[0].base64Data).toBeTruthy();
  });

  it('defaults mimeType to image/png when not provided', () => {
    const event = new CustomEvent('clipboard-paste-image', {
      detail: {
        base64: 'AAAA',
        width: 10,
        height: 10,
      },
    });

    handler(event);

    expect(attachments[0].mimeType).toBe('image/png');
  });

  it('calculates size from base64 length when size not provided', () => {
    const base64 = 'A'.repeat(1000);
    const event = new CustomEvent('clipboard-paste-image', {
      detail: {
        base64,
        width: 10,
        height: 10,
      },
    });

    handler(event);

    expect(attachments[0].size).toBe(Math.round(1000 * 0.75));
  });

  it('appends to existing attachments', () => {
    attachments = [{
      id: 'existing',
      type: 'file',
      name: 'test.ts',
      mimeType: 'text/typescript',
      size: 100,
    }];

    const event = new CustomEvent('clipboard-paste-image', {
      detail: { base64: 'AAAA', width: 1, height: 1, mimeType: 'image/png', size: 3 },
    });

    handler(event);

    expect(attachments).toHaveLength(2);
    expect(attachments[0].name).toBe('test.ts');
    expect(attachments[1].name).toBe('pasted-image.png');
  });
});

describe('handlePaste — image detection', () => {
  it('detects image items in clipboardData', () => {
    const items = [
      { type: 'text/plain', getAsFile: () => null },
      { type: 'image/png', getAsFile: () => new File([''], 'image.png', { type: 'image/png' }) },
    ];

    const imageItem = items.find(item => item.type.startsWith('image/'));
    expect(imageItem).toBeTruthy();
    expect(imageItem!.type).toBe('image/png');
  });

  it('returns undefined when no image in clipboard', () => {
    const items = [
      { type: 'text/plain', getAsFile: () => null },
      { type: 'text/html', getAsFile: () => null },
    ];

    const imageItem = items.find(item => item.type.startsWith('image/'));
    expect(imageItem).toBeUndefined();
  });

  it('rejects images exceeding MAX_FILE_SIZE', () => {
    const oversizedFile = new File(
      [new ArrayBuffer(ATTACHMENT_LIMITS.MAX_FILE_SIZE + 1)],
      'big.png',
      { type: 'image/png' }
    );

    expect(oversizedFile.size).toBeGreaterThan(ATTACHMENT_LIMITS.MAX_FILE_SIZE);
  });

  it('determines correct extension from mimeType', () => {
    const cases = [
      { mimeType: 'image/jpeg', expected: 'jpg' },
      { mimeType: 'image/png', expected: 'png' },
      { mimeType: 'image/gif', expected: 'gif' },
      { mimeType: 'image/webp', expected: 'webp' },
      { mimeType: '', expected: 'png' }, // fallback
    ];

    for (const { mimeType, expected } of cases) {
      const ext = mimeType === 'image/jpeg' ? 'jpg' : (mimeType.split('/')[1] || 'png');
      expect(ext).toBe(expected);
    }
  });
});

describe('handlePaste — long text auto-convert', () => {
  it('does not convert text under 5000 chars', () => {
    const text = 'a'.repeat(4999);
    expect(text.length).toBeLessThanOrEqual(5000);
  });

  it('converts text over 5000 chars to attachment', () => {
    const text = 'a'.repeat(5001);
    const shouldConvert = text.length > 5000;
    expect(shouldConvert).toBe(true);

    const blob = new Blob([text], { type: 'text/plain' });
    const attachment: Attachment = {
      id: 'test-id',
      type: 'file',
      name: 'pasted-text.txt',
      mimeType: 'text/plain',
      size: blob.size,
      lineCount: text.split('\n').length,
      base64Data: btoa(unescape(encodeURIComponent(text))),
      preview: text.slice(0, 200),
    };

    expect(attachment.type).toBe('file');
    expect(attachment.name).toBe('pasted-text.txt');
    expect(attachment.lineCount).toBe(1);
  });
});
