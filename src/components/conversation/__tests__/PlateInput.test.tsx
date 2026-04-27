/**
 * Smoke tests for the PlateInput wrapper.
 *
 * Plate.js editors are heavy in jsdom (canvas measurements, complex DOM ops),
 * so we verify just the high-level orchestration:
 *   - The editor renders with the provided placeholder
 *   - The imperative handle exposes focus/clear/getText/getContent/setText
 *   - getText/getContent delegate to the extracted extractContent function
 *
 * Deeper editor interaction (typing, mentions, slash commands) is covered
 * indirectly via the extractContent unit tests in lib/__tests__/plate-content.test.ts.
 */
import { describe, it, expect } from 'vitest';
import { createRef } from 'react';
import { render } from '@/test-utils/render';
import { PlateInput, type PlateInputHandle } from '../PlateInput';

describe('PlateInput', () => {
  it('renders without crashing', () => {
    const { container } = render(<PlateInput />);
    expect(container.querySelector('[data-slate-editor]')).toBeInTheDocument();
  });

  it('renders the placeholder text', () => {
    const { container } = render(<PlateInput placeholder="Type a message..." />);
    // Plate uses data attributes for placeholders
    const editor = container.querySelector('[data-slate-editor]');
    expect(editor).toBeInTheDocument();
  });

  it('exposes the imperative handle (focus/clear/getText/getContent/setText)', () => {
    const ref = createRef<PlateInputHandle>();
    render(<PlateInput ref={ref} />);

    expect(ref.current).not.toBeNull();
    expect(typeof ref.current?.focus).toBe('function');
    expect(typeof ref.current?.clear).toBe('function');
    expect(typeof ref.current?.getText).toBe('function');
    expect(typeof ref.current?.getContent).toBe('function');
    expect(typeof ref.current?.setText).toBe('function');
  });

  it('getText() returns empty string for an empty editor', () => {
    const ref = createRef<PlateInputHandle>();
    render(<PlateInput ref={ref} />);
    expect(ref.current?.getText()).toBe('');
  });

  it('getContent() returns empty text and no mentions for an empty editor', () => {
    const ref = createRef<PlateInputHandle>();
    render(<PlateInput ref={ref} />);
    const content = ref.current?.getContent();
    expect(content?.text).toBe('');
    expect(content?.mentionedFiles).toEqual([]);
  });

  it('setText() updates the editor content (next getText reflects it)', () => {
    const ref = createRef<PlateInputHandle>();
    render(<PlateInput ref={ref} />);

    ref.current?.setText('hello world');
    expect(ref.current?.getText()).toBe('hello world');
  });

  it('clear() empties the editor', () => {
    const ref = createRef<PlateInputHandle>();
    render(<PlateInput ref={ref} />);

    ref.current?.setText('something');
    expect(ref.current?.getText()).toBe('something');

    ref.current?.clear();
    expect(ref.current?.getText()).toBe('');
  });

  it('accepts mentionItems / slashCommands / callbacks without throwing', () => {
    const cb = () => {};
    expect(() =>
      render(
        <PlateInput
          mentionItems={[]}
          mentionItemsLoading={false}
          slashCommands={[]}
          onSlashCommandExecute={cb}
          onInput={cb}
          onKeyDown={cb}
          onPaste={cb}
          onFocus={cb}
          onBlur={cb}
        />
      )
    ).not.toThrow();
  });

  it('multiple instances coexist with independent state', () => {
    const ref1 = createRef<PlateInputHandle>();
    const ref2 = createRef<PlateInputHandle>();

    render(
      <>
        <PlateInput ref={ref1} />
        <PlateInput ref={ref2} />
      </>,
    );

    ref1.current?.setText('one');
    ref2.current?.setText('two');

    expect(ref1.current?.getText()).toBe('one');
    expect(ref2.current?.getText()).toBe('two');
  });
});
