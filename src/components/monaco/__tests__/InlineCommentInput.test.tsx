import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { InlineCommentInput } from '../InlineCommentInput';

describe('InlineCommentInput', () => {
  // ── Rendering ──────────────────────────────────────────────────────

  it('renders textarea with placeholder', () => {
    render(<InlineCommentInput onSubmit={vi.fn()} onCancel={vi.fn()} />);

    expect(
      screen.getByPlaceholderText(/Add a comment/i)
    ).toBeInTheDocument();
  });

  it('renders Submit and Cancel buttons', () => {
    render(<InlineCommentInput onSubmit={vi.fn()} onCancel={vi.fn()} />);

    expect(screen.getByText('Comment')).toBeInTheDocument();
    expect(screen.getByText('Cancel')).toBeInTheDocument();
  });

  it('auto-focuses textarea on mount', () => {
    render(<InlineCommentInput onSubmit={vi.fn()} onCancel={vi.fn()} />);

    const textarea = screen.getByPlaceholderText(/Add a comment/i);
    expect(textarea).toHaveFocus();
  });

  it('disables submit button when textarea is empty', () => {
    render(<InlineCommentInput onSubmit={vi.fn()} onCancel={vi.fn()} />);

    const submitButton = screen.getByText('Comment').closest('button');
    expect(submitButton).toBeDisabled();
  });

  // ── Submit ─────────────────────────────────────────────────────────

  it('calls onSubmit with trimmed text when Comment button is clicked', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();

    render(<InlineCommentInput onSubmit={onSubmit} onCancel={vi.fn()} />);

    const textarea = screen.getByPlaceholderText(/Add a comment/i);
    await user.type(textarea, '  Fix this bug  ');

    const submitButton = screen.getByText('Comment').closest('button')!;
    await user.click(submitButton);

    expect(onSubmit).toHaveBeenCalledWith('Fix this bug');
  });

  it('does not call onSubmit when text is only whitespace', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();

    render(<InlineCommentInput onSubmit={onSubmit} onCancel={vi.fn()} />);

    const textarea = screen.getByPlaceholderText(/Add a comment/i);
    await user.type(textarea, '   ');

    // Button should still be disabled
    const submitButton = screen.getByText('Comment').closest('button')!;
    expect(submitButton).toBeDisabled();
  });

  it('submits on Cmd+Enter', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();

    render(<InlineCommentInput onSubmit={onSubmit} onCancel={vi.fn()} />);

    const textarea = screen.getByPlaceholderText(/Add a comment/i);
    await user.type(textarea, 'A review comment');
    await user.keyboard('{Meta>}{Enter}{/Meta}');

    expect(onSubmit).toHaveBeenCalledWith('A review comment');
  });

  it('submits on Ctrl+Enter', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();

    render(<InlineCommentInput onSubmit={onSubmit} onCancel={vi.fn()} />);

    const textarea = screen.getByPlaceholderText(/Add a comment/i);
    await user.type(textarea, 'Another comment');
    await user.keyboard('{Control>}{Enter}{/Control}');

    expect(onSubmit).toHaveBeenCalledWith('Another comment');
  });

  // ── Cancel ─────────────────────────────────────────────────────────

  it('calls onCancel when Cancel button is clicked', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();

    render(<InlineCommentInput onSubmit={vi.fn()} onCancel={onCancel} />);

    await user.click(screen.getByText('Cancel'));

    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('calls onCancel on Escape key', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();

    render(<InlineCommentInput onSubmit={vi.fn()} onCancel={onCancel} />);

    const textarea = screen.getByPlaceholderText(/Add a comment/i);
    await user.type(textarea, 'some text');
    await user.keyboard('{Escape}');

    expect(onCancel).toHaveBeenCalledOnce();
  });

  // ── Edge cases ─────────────────────────────────────────────────────

  it('enables submit button after typing non-whitespace text', async () => {
    const user = userEvent.setup();

    render(<InlineCommentInput onSubmit={vi.fn()} onCancel={vi.fn()} />);

    const submitButton = screen.getByText('Comment').closest('button')!;
    expect(submitButton).toBeDisabled();

    const textarea = screen.getByPlaceholderText(/Add a comment/i);
    await user.type(textarea, 'text');

    expect(submitButton).not.toBeDisabled();
  });
});
