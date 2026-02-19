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

  it('returns null when all input token types are zero', () => {
    useAppStore.setState({
      contextUsage: {
        [CONV_ID]: makeContextUsage({
          inputTokens: 0,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0,
        }),
      },
    });
    const { container } = render(<ContextMeter conversationId={CONV_ID} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders when inputTokens is 0 but cache tokens are nonzero', () => {
    useAppStore.setState({
      contextUsage: {
        [CONV_ID]: makeContextUsage({
          inputTokens: 0,
          cacheReadInputTokens: 100000,
          cacheCreationInputTokens: 5000,
        }),
      },
    });
    const { container } = render(<ContextMeter conversationId={CONV_ID} />);
    expect(container.innerHTML).not.toBe('');
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
  // Percentage display
  // ==========================================================================

  it('displays percentage for normal usage', () => {
    useAppStore.setState({
      contextUsage: { [CONV_ID]: makeContextUsage({ inputTokens: 70400 }) },
    });
    render(<ContextMeter conversationId={CONV_ID} />);
    // 70400/200000 = 35.2% → rounds to 35%
    expect(screen.getByText('35%')).toBeInTheDocument();
  });

  it('displays 0% for very small usage', () => {
    useAppStore.setState({
      contextUsage: { [CONV_ID]: makeContextUsage({ inputTokens: 500 }) },
    });
    render(<ContextMeter conversationId={CONV_ID} />);
    // 500/200000 = 0.25% → rounds to 0%
    expect(screen.getByText('0%')).toBeInTheDocument();
  });

  it('rounds percentage correctly for small usage', () => {
    useAppStore.setState({
      contextUsage: { [CONV_ID]: makeContextUsage({ inputTokens: 1000 }) },
    });
    render(<ContextMeter conversationId={CONV_ID} />);
    // 1000/200000 = 0.5% → rounds to 1%
    expect(screen.getByText('1%')).toBeInTheDocument();
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

  it('shows input tokens in breakdown without percentage', () => {
    useAppStore.setState({
      contextUsage: {
        [CONV_ID]: makeContextUsage({
          inputTokens: 80000,
          cacheReadInputTokens: 20000,
          contextWindow: 200000,
        }),
      },
    });
    render(<ContextMeter conversationId={CONV_ID} />);

    fireEvent.click(screen.getByRole('button'));

    expect(screen.getByText('Input tokens')).toBeInTheDocument();
    // Should show raw input tokens (80.0k), not total (100.0k), and no percentage
    expect(screen.getByText('80.0k')).toBeInTheDocument();
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

  // ==========================================================================
  // Cache-inclusive context utilization
  // ==========================================================================

  it('caps percentage label at 100% when tokens exceed context window', () => {
    useAppStore.setState({
      contextUsage: {
        [CONV_ID]: makeContextUsage({
          inputTokens: 10,
          cacheReadInputTokens: 800000,
          cacheCreationInputTokens: 3000,
        }),
      },
    });
    render(<ContextMeter conversationId={CONV_ID} />);
    // Total: 10 + 800000 + 3000 = 803010, exceeds 200000 → capped at 100%
    expect(screen.getByText('100%')).toBeInTheDocument();
  });

  it('shows popover header with total input tokens including cache', () => {
    useAppStore.setState({
      contextUsage: {
        [CONV_ID]: makeContextUsage({
          inputTokens: 400,
          cacheReadInputTokens: 150000,
          cacheCreationInputTokens: 10000,
          contextWindow: 200000,
        }),
      },
    });
    render(<ContextMeter conversationId={CONV_ID} />);
    fireEvent.click(screen.getByRole('button'));
    // Total: 400 + 150000 + 10000 = 160400 -> 160.4k
    expect(screen.getByText('160.4k / 200.0k')).toBeInTheDocument();
  });

  it('uses amber color when cache tokens push usage >= 80%', () => {
    useAppStore.setState({
      contextUsage: {
        [CONV_ID]: makeContextUsage({
          inputTokens: 10,
          cacheReadInputTokens: 160000,
          contextWindow: 200000,
        }),
      },
    });
    const { container } = render(<ContextMeter conversationId={CONV_ID} />);
    const button = container.querySelector('button');
    expect(button?.className).toContain('text-amber-500');
  });

  it('aria-label reflects total input tokens including cache', () => {
    useAppStore.setState({
      contextUsage: {
        [CONV_ID]: makeContextUsage({
          inputTokens: 10,
          cacheReadInputTokens: 100000,
          cacheCreationInputTokens: 5000,
        }),
      },
    });
    render(<ContextMeter conversationId={CONV_ID} />);
    const button = screen.getByRole('button');
    // 105010/200000 = 52.505% → rounds to 53%
    expect(button).toHaveAttribute('aria-label', 'Context usage: 53% (105.0k of 200.0k tokens)');
  });

  it('caps percentage at 100% when total tokens exceed contextWindow', () => {
    useAppStore.setState({
      contextUsage: {
        [CONV_ID]: makeContextUsage({
          inputTokens: 10,
          cacheReadInputTokens: 250000,
          contextWindow: 200000,
        }),
      },
    });
    render(<ContextMeter conversationId={CONV_ID} />);
    fireEvent.click(screen.getByRole('button'));
    const progressBars = document.body.querySelectorAll('[style*="width"]');
    const bar = Array.from(progressBars).find(el =>
      (el as HTMLElement).style.width === '100%'
    );
    expect(bar).toBeDefined();
  });
});
