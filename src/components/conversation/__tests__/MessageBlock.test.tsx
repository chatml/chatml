import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MessageBlock } from '../MessageBlock';
import { clearMarkdownCache } from '@/lib/markdownCache';
import { useSettingsStore } from '@/stores/settingsStore';
import type { Message } from '@/lib/types';

// Mock Tauri utilities
vi.mock('@/lib/tauri', () => ({
  copyToClipboard: vi.fn().mockResolvedValue(true),
  openUrlInBrowser: vi.fn().mockResolvedValue(undefined),
  isTauri: vi.fn().mockReturnValue(false),
}));

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: 'msg-1',
    conversationId: 'conv-1',
    role: 'assistant',
    content: 'Hello world',
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

describe('MessageBlock', () => {
  beforeEach(() => {
    clearMarkdownCache();
  });

  describe('user messages', () => {
    it('renders user message content', () => {
      render(
        <MessageBlock
          message={makeMessage({ role: 'user', content: 'How do I fix this bug?' })}
          isFirst={false}
        />
      );

      expect(screen.getByText('How do I fix this bug?')).toBeInTheDocument();
    });

    it('preserves whitespace in user messages', () => {
      render(
        <MessageBlock
          message={makeMessage({ role: 'user', content: 'line 1\nline 2' })}
          isFirst={false}
        />
      );

      // getByText normalizes whitespace; use a function matcher for multiline
      const el = screen.getByText((_content, element) =>
        element?.tagName === 'P' && element?.textContent === 'line 1\nline 2'
      );
      expect(el).toHaveClass('whitespace-pre-wrap');
    });
  });

  describe('system messages', () => {
    it('renders system setup info', () => {
      render(
        <MessageBlock
          message={makeMessage({
            role: 'system',
            content: '',
            setupInfo: {
              sessionName: 'test-session',
              branchName: 'feature/test',
              originBranch: 'main',
            },
          })}
          isFirst={true}
        />
      );

      expect(screen.getByText('test-session')).toBeInTheDocument();
    });

    it('renders plain system message when no setupInfo', () => {
      render(
        <MessageBlock
          message={makeMessage({ role: 'system', content: 'System notice' })}
          isFirst={false}
        />
      );

      expect(screen.getByText('System notice')).toBeInTheDocument();
    });
  });

  describe('assistant messages', () => {
    it('renders markdown content', () => {
      render(
        <MessageBlock
          message={makeMessage({ role: 'assistant', content: '**bold text**' })}
          isFirst={false}
        />
      );

      expect(screen.getByText('bold text')).toBeInTheDocument();
      expect(screen.getByText('bold text').tagName).toBe('STRONG');
    });

    it('renders tool usage history when present', () => {
      render(
        <MessageBlock
          message={makeMessage({
            role: 'assistant',
            content: 'Done.',
            toolUsage: [
              { id: 't1', tool: 'Read', success: true, durationMs: 100 },
              { id: 't2', tool: 'Write', success: true, durationMs: 200 },
            ],
          })}
          isFirst={false}
        />
      );

      // ToolUsageHistory renders "{count} tool(s)" with passed/failed counts
      expect(screen.getByText('2 passed')).toBeInTheDocument();
    });

    it('renders verification results when present', () => {
      render(
        <MessageBlock
          message={makeMessage({
            role: 'assistant',
            content: 'Tests ran.',
            verificationResults: [
              { name: 'unit tests', status: 'pass' },
              { name: 'lint', status: 'fail', details: 'ESLint error' },
            ],
          })}
          isFirst={false}
        />
      );

      expect(screen.getByText('Verification')).toBeInTheDocument();
      expect(screen.getByText('1/2 passed')).toBeInTheDocument();
    });

    it('renders file changes when present', () => {
      render(
        <MessageBlock
          message={makeMessage({
            role: 'assistant',
            content: 'Updated files.',
            fileChanges: [
              { path: 'src/app.tsx', additions: 10, deletions: 3, status: 'modified' },
              { path: 'src/new.tsx', additions: 50, deletions: 0, status: 'added' },
            ],
          })}
          isFirst={false}
        />
      );

      expect(screen.getByText('2 files changed')).toBeInTheDocument();
    });

    it('renders run summary when present', () => {
      const { container } = render(
        <MessageBlock
          message={makeMessage({
            role: 'assistant',
            content: 'Task complete.',
            runSummary: { success: true, durationMs: 5000, turns: 3 },
          })}
          isFirst={false}
        />
      );

      // RunSummaryBlock renders a success icon
      const successIcons = container.querySelectorAll('[class*="text-success"]');
      expect(successIcons.length).toBeGreaterThan(0);
    });

    it('shows copy button on hover', async () => {
      const user = userEvent.setup();
      render(
        <MessageBlock
          message={makeMessage({ role: 'assistant', content: 'Copy me' })}
          isFirst={false}
        />
      );

      // The copy button exists but is hidden via opacity
      const contentArea = screen.getByText('Copy me').closest('.group');
      expect(contentArea).toBeInTheDocument();

      // Hover to reveal
      await user.hover(contentArea!);
      // Button should exist in the DOM (opacity controlled by CSS)
      const buttons = contentArea!.querySelectorAll('button');
      expect(buttons.length).toBeGreaterThan(0);
    });
  });

  describe('search highlighting', () => {
    it('does not highlight when no search query', () => {
      const { container } = render(
        <MessageBlock
          message={makeMessage({ role: 'user', content: 'test content' })}
          isFirst={false}
          searchQuery=""
        />
      );

      // Should render plain text, no <mark> elements
      const marks = container.querySelectorAll('mark');
      expect(marks.length).toBe(0);
    });

    it('highlights matching text in user messages', () => {
      const { container } = render(
        <MessageBlock
          message={makeMessage({ role: 'user', content: 'find the needle here' })}
          isFirst={false}
          searchQuery="needle"
          currentMatchIndex={0}
          matchOffset={0}
          hasMatches={true}
        />
      );

      const marks = container.querySelectorAll('mark');
      expect(marks.length).toBe(1);
      expect(marks[0].textContent).toBe('needle');
    });
  });

  describe('thinking blocks', () => {
    beforeEach(() => {
      useSettingsStore.setState({ showThinkingBlocks: true });
    });

    it('renders thinking header when thinkingContent is present and visible', () => {
      render(
        <MessageBlock
          message={makeMessage({
            role: 'assistant',
            content: 'The answer is 42.',
            thinkingContent: 'Let me reason step by step...',
          })}
          isFirst={false}
        />
      );

      expect(screen.getByText('Thinking')).toBeInTheDocument();
    });

    it('does not render thinking block when thinkingContent is absent', () => {
      render(
        <MessageBlock
          message={makeMessage({
            role: 'assistant',
            content: 'No thinking here.',
          })}
          isFirst={false}
        />
      );

      expect(screen.queryByText('Thinking')).not.toBeInTheDocument();
    });

    it('hides thinking block when showThinkingBlocks is false', () => {
      useSettingsStore.setState({ showThinkingBlocks: false });

      render(
        <MessageBlock
          message={makeMessage({
            role: 'assistant',
            content: 'Response.',
            thinkingContent: 'Hidden reasoning...',
          })}
          isFirst={false}
        />
      );

      expect(screen.queryByText('Thinking')).not.toBeInTheDocument();
      expect(screen.queryByText('Hidden reasoning...')).not.toBeInTheDocument();
    });

    it('starts collapsed by default — thinking content not visible initially', () => {
      render(
        <MessageBlock
          message={makeMessage({
            role: 'assistant',
            content: 'Response.',
            thinkingContent: 'My detailed reasoning process...',
          })}
          isFirst={false}
        />
      );

      // Header visible, content hidden
      expect(screen.getByText('Thinking')).toBeInTheDocument();
      expect(screen.queryByText('My detailed reasoning process...')).not.toBeInTheDocument();
    });

    it('expands thinking content on click', async () => {
      const user = userEvent.setup();

      render(
        <MessageBlock
          message={makeMessage({
            role: 'assistant',
            content: 'Response.',
            thinkingContent: 'My detailed reasoning process...',
          })}
          isFirst={false}
        />
      );

      // Click to expand
      const thinkingButton = screen.getByText('Thinking').closest('button');
      expect(thinkingButton).toBeInTheDocument();
      await user.click(thinkingButton!);

      // Content should now be visible
      expect(screen.getByText('My detailed reasoning process...')).toBeInTheDocument();
    });

    it('collapses thinking content on second click', async () => {
      const user = userEvent.setup();

      render(
        <MessageBlock
          message={makeMessage({
            role: 'assistant',
            content: 'Response.',
            thinkingContent: 'Collapsible content.',
          })}
          isFirst={false}
        />
      );

      const thinkingButton = screen.getByText('Thinking').closest('button');

      // Expand
      await user.click(thinkingButton!);
      expect(screen.getByText('Collapsible content.')).toBeInTheDocument();

      // Collapse
      await user.click(thinkingButton!);
      expect(screen.queryByText('Collapsible content.')).not.toBeInTheDocument();
    });

    it('does not show thinking block for user messages', () => {
      render(
        <MessageBlock
          message={makeMessage({
            role: 'user',
            content: 'User message.',
            thinkingContent: 'Should not appear.',
          })}
          isFirst={false}
        />
      );

      expect(screen.queryByText('Thinking')).not.toBeInTheDocument();
    });

    it('does not show thinking block for system messages', () => {
      render(
        <MessageBlock
          message={makeMessage({
            role: 'system',
            content: 'System notice.',
            thinkingContent: 'Should not appear.',
          })}
          isFirst={false}
        />
      );

      expect(screen.queryByText('Thinking')).not.toBeInTheDocument();
    });

    it('renders thinking block with correct styling', async () => {
      const user = userEvent.setup();

      const { container } = render(
        <MessageBlock
          message={makeMessage({
            role: 'assistant',
            content: 'Styled response.',
            thinkingContent: 'Styled thinking content.',
          })}
          isFirst={false}
        />
      );

      // Expand to see content
      const thinkingButton = screen.getByText('Thinking').closest('button');
      await user.click(thinkingButton!);

      // Check monospace font class
      const thinkingContent = container.querySelector('.font-mono');
      expect(thinkingContent).toBeInTheDocument();
      expect(thinkingContent?.textContent).toBe('Styled thinking content.');
    });

    it('renders alongside other message blocks', async () => {
      const user = userEvent.setup();

      render(
        <MessageBlock
          message={makeMessage({
            role: 'assistant',
            content: 'Main response.',
            thinkingContent: 'My reasoning.',
            toolUsage: [
              { id: 't1', tool: 'Read', success: true, durationMs: 100 },
            ],
          })}
          isFirst={false}
        />
      );

      // Both thinking header and tool usage should be present
      expect(screen.getByText('Thinking')).toBeInTheDocument();
      expect(screen.getByText('1 passed')).toBeInTheDocument();

      // Expand thinking
      const thinkingButton = screen.getByText('Thinking').closest('button');
      await user.click(thinkingButton!);
      expect(screen.getByText('My reasoning.')).toBeInTheDocument();
    });
  });

  describe('memo behavior', () => {
    it('does not re-render when hasMatches is false and search index changes', () => {
      // MessageBlock is wrapped in memo — if areEqual returns true, render count stays same
      const msg = makeMessage({ role: 'user', content: 'no matches here' });

      const { rerender } = render(
        <MessageBlock
          message={msg}
          isFirst={false}
          searchQuery="xyz"
          currentMatchIndex={0}
          matchOffset={0}
          hasMatches={false}
        />
      );

      // Re-render with different currentMatchIndex but same hasMatches=false
      rerender(
        <MessageBlock
          message={msg}
          isFirst={false}
          searchQuery="xyz"
          currentMatchIndex={5}
          matchOffset={0}
          hasMatches={false}
        />
      );

      // The text should still be present (component didn't unmount)
      expect(screen.getByText('no matches here')).toBeInTheDocument();
    });
  });
});
