import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ContextMeter } from '../ContextMeter';
import { useAppStore } from '@/stores/appStore';
import type { ContextUsage } from '@/lib/types';

const CONV_ID = 'conv-1';

function makeContextUsage(overrides: Partial<ContextUsage> = {}): ContextUsage {
  return {
    inputTokens: 70400,
    outputTokens: 3000,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
    contextWindow: 200000,
    lastUpdated: Date.now(),
    ...overrides,
  };
}

describe('ContextMeter', () => {
  beforeEach(() => {
    useAppStore.setState({ contextUsage: {} });
  });

  // ==========================================================================
  // Null/hidden states
  // ==========================================================================

  it('returns null when conversationId is null', () => {
    const { container } = render(<ContextMeter conversationId={null} />);
    expect(container.innerHTML).toBe('');
  });

  it('returns null when no contextUsage data for conversationId', () => {
    const { container } = render(<ContextMeter conversationId={CONV_ID} />);
    expect(container.innerHTML).toBe('');
  });

  it('returns null when inputTokens is 0', () => {
    useAppStore.setState({
      contextUsage: { [CONV_ID]: makeContextUsage({ inputTokens: 0 }) },
    });
    const { container } = render(<ContextMeter conversationId={CONV_ID} />);
    expect(container.innerHTML).toBe('');
  });

  // ==========================================================================
  // Rendering
  // ==========================================================================

  it('renders when contextUsage data exists', () => {
    useAppStore.setState({
      contextUsage: { [CONV_ID]: makeContextUsage() },
    });
    const { container } = render(<ContextMeter conversationId={CONV_ID} />);
    expect(container.innerHTML).not.toBe('');
  });

  it('renders a button with aria-label', () => {
    useAppStore.setState({
      contextUsage: { [CONV_ID]: makeContextUsage() },
    });
    render(<ContextMeter conversationId={CONV_ID} />);
    const button = screen.getByRole('button');
    expect(button).toHaveAttribute('aria-label', expect.stringContaining('Context usage'));
  });

  it('renders SVG circular indicator', () => {
    useAppStore.setState({
      contextUsage: { [CONV_ID]: makeContextUsage() },
    });
    const { container } = render(<ContextMeter conversationId={CONV_ID} />);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    const circles = container.querySelectorAll('circle');
    expect(circles.length).toBe(2); // background + progress
  });

  // ==========================================================================
  // Token formatting
  // ==========================================================================

  it('formats large tokens with "k" notation', () => {
    useAppStore.setState({
      contextUsage: { [CONV_ID]: makeContextUsage({ inputTokens: 70400 }) },
    });
    render(<ContextMeter conversationId={CONV_ID} />);
    expect(screen.getByText('70.4k')).toBeInTheDocument();
  });

  it('displays small token counts as raw numbers', () => {
    useAppStore.setState({
      contextUsage: { [CONV_ID]: makeContextUsage({ inputTokens: 500 }) },
    });
    render(<ContextMeter conversationId={CONV_ID} />);
    expect(screen.getByText('500')).toBeInTheDocument();
  });

  it('formats 1000 tokens as "1.0k"', () => {
    useAppStore.setState({
      contextUsage: { [CONV_ID]: makeContextUsage({ inputTokens: 1000 }) },
    });
    render(<ContextMeter conversationId={CONV_ID} />);
    expect(screen.getByText('1.0k')).toBeInTheDocument();
  });

  // ==========================================================================
  // Color coding
  // ==========================================================================

  it('uses default color when usage < 80%', () => {
    useAppStore.setState({
      contextUsage: {
        [CONV_ID]: makeContextUsage({ inputTokens: 100000, contextWindow: 200000 }),
      },
    });
    const { container } = render(<ContextMeter conversationId={CONV_ID} />);
    const button = container.querySelector('button');
    expect(button?.className).toContain('text-muted-foreground');
    expect(button?.className).not.toContain('text-amber');
    expect(button?.className).not.toContain('text-red');
  });

  it('uses amber color when usage >= 80%', () => {
    useAppStore.setState({
      contextUsage: {
        [CONV_ID]: makeContextUsage({ inputTokens: 160000, contextWindow: 200000 }),
      },
    });
    const { container } = render(<ContextMeter conversationId={CONV_ID} />);
    const button = container.querySelector('button');
    expect(button?.className).toContain('text-amber-500');
  });

  it('uses red color when usage >= 95%', () => {
    useAppStore.setState({
      contextUsage: {
        [CONV_ID]: makeContextUsage({ inputTokens: 195000, contextWindow: 200000 }),
      },
    });
    const { container } = render(<ContextMeter conversationId={CONV_ID} />);
    const button = container.querySelector('button');
    expect(button?.className).toContain('text-red-500');
  });

  // ==========================================================================
  // Popover
  // ==========================================================================

  it('shows popover header with token counts on click', () => {
    useAppStore.setState({
      contextUsage: {
        [CONV_ID]: makeContextUsage({ inputTokens: 70400, contextWindow: 200000 }),
      },
    });
    render(<ContextMeter conversationId={CONV_ID} />);

    fireEvent.click(screen.getByRole('button'));

    expect(screen.getByText('Context')).toBeInTheDocument();
    // The popover header shows "70.4k / 200.0k"
    expect(screen.getByText('70.4k / 200.0k')).toBeInTheDocument();
  });

  it('shows progress bar in popover', () => {
    useAppStore.setState({
      contextUsage: {
        [CONV_ID]: makeContextUsage({ inputTokens: 100000, contextWindow: 200000 }),
      },
    });
    render(<ContextMeter conversationId={CONV_ID} />);

    fireEvent.click(screen.getByRole('button'));

    // Popover renders in a portal, so query document.body directly
    const progressBars = document.body.querySelectorAll('[style*="width"]');
    expect(progressBars.length).toBeGreaterThan(0);
    // 100000/200000 = 50%
    const bar = Array.from(progressBars).find(el =>
      (el as HTMLElement).style.width === '50%'
    );
    expect(bar).toBeDefined();
  });

  it('shows input tokens with percentage in breakdown', () => {
    useAppStore.setState({
      contextUsage: {
        [CONV_ID]: makeContextUsage({ inputTokens: 100000, contextWindow: 200000 }),
      },
    });
    render(<ContextMeter conversationId={CONV_ID} />);

    fireEvent.click(screen.getByRole('button'));

    expect(screen.getByText('Input tokens')).toBeInTheDocument();
    // 100000/200000 = 50.0%
    expect(screen.getByText('100.0k (50.0%)')).toBeInTheDocument();
  });

  it('shows output tokens in breakdown', () => {
    useAppStore.setState({
      contextUsage: {
        [CONV_ID]: makeContextUsage({ inputTokens: 50000, outputTokens: 3000 }),
      },
    });
    render(<ContextMeter conversationId={CONV_ID} />);

    fireEvent.click(screen.getByRole('button'));

    expect(screen.getByText('Output tokens')).toBeInTheDocument();
    expect(screen.getByText('3.0k')).toBeInTheDocument();
  });

  it('hides cache read row when zero', () => {
    useAppStore.setState({
      contextUsage: {
        [CONV_ID]: makeContextUsage({ inputTokens: 50000, cacheReadInputTokens: 0 }),
      },
    });
    render(<ContextMeter conversationId={CONV_ID} />);

    fireEvent.click(screen.getByRole('button'));

    expect(screen.queryByText('Cache read')).not.toBeInTheDocument();
  });

  it('shows cache read row when nonzero', () => {
    useAppStore.setState({
      contextUsage: {
        [CONV_ID]: makeContextUsage({ inputTokens: 50000, cacheReadInputTokens: 5000 }),
      },
    });
    render(<ContextMeter conversationId={CONV_ID} />);

    fireEvent.click(screen.getByRole('button'));

    expect(screen.getByText('Cache read')).toBeInTheDocument();
    expect(screen.getByText('5.0k')).toBeInTheDocument();
  });

  it('hides cache creation row when zero', () => {
    useAppStore.setState({
      contextUsage: {
        [CONV_ID]: makeContextUsage({ inputTokens: 50000, cacheCreationInputTokens: 0 }),
      },
    });
    render(<ContextMeter conversationId={CONV_ID} />);

    fireEvent.click(screen.getByRole('button'));

    expect(screen.queryByText('Cache creation')).not.toBeInTheDocument();
  });

  it('shows cache creation row when nonzero', () => {
    useAppStore.setState({
      contextUsage: {
        [CONV_ID]: makeContextUsage({ inputTokens: 50000, cacheCreationInputTokens: 2000 }),
      },
    });
    render(<ContextMeter conversationId={CONV_ID} />);

    fireEvent.click(screen.getByRole('button'));

    expect(screen.getByText('Cache creation')).toBeInTheDocument();
    expect(screen.getByText('2.0k')).toBeInTheDocument();
  });

  // ==========================================================================
  // Edge cases
  // ==========================================================================

  it('caps percentage at 100% when inputTokens exceeds contextWindow', () => {
    useAppStore.setState({
      contextUsage: {
        [CONV_ID]: makeContextUsage({ inputTokens: 250000, contextWindow: 200000 }),
      },
    });
    render(<ContextMeter conversationId={CONV_ID} />);

    fireEvent.click(screen.getByRole('button'));

    // Popover renders in a portal, so query document.body directly
    const progressBars = document.body.querySelectorAll('[style*="width"]');
    const bar = Array.from(progressBars).find(el =>
      (el as HTMLElement).style.width === '100%'
    );
    expect(bar).toBeDefined();
  });

  it('uses default contextWindow of 200000 when contextWindow is 0', () => {
    useAppStore.setState({
      contextUsage: {
        [CONV_ID]: makeContextUsage({ inputTokens: 50000, contextWindow: 0 }),
      },
    });
    render(<ContextMeter conversationId={CONV_ID} />);

    fireEvent.click(screen.getByRole('button'));

    // Falls back to 200000, so 50000/200000 = 25.0%
    expect(screen.getByText('50.0k / 200.0k')).toBeInTheDocument();
  });
});
