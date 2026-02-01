import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useConnectionStore } from '@/stores/connectionStore';
import { ConnectionIndicator } from '@/components/layout/MainToolbar';

function renderIndicator() {
  return render(
    <TooltipProvider>
      <ConnectionIndicator />
    </TooltipProvider>
  );
}

describe('ConnectionIndicator', () => {
  beforeEach(() => {
    useConnectionStore.setState({
      status: 'connected',
      reconnectAttempt: 0,
      lastDisconnectedAt: null,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not render when connected', () => {
    const { container } = renderIndicator();
    expect(container.querySelector('.rounded-full')).toBeNull();
  });

  it('renders red dot when disconnected', () => {
    useConnectionStore.setState({ status: 'disconnected' });

    const { container } = renderIndicator();
    const dot = container.querySelector('.rounded-full');
    expect(dot).not.toBeNull();
    expect(dot?.className).toContain('bg-destructive');
    expect(dot?.className).not.toContain('animate-pulse');
  });

  it('renders amber pulsing dot when reconnecting', () => {
    useConnectionStore.setState({ status: 'connecting', reconnectAttempt: 2 });

    const { container } = renderIndicator();
    const dot = container.querySelector('.rounded-full');
    expect(dot).not.toBeNull();
    expect(dot?.className).toContain('bg-yellow-500');
    expect(dot?.className).toContain('animate-pulse');
  });

  it('hides when status transitions to connected', () => {
    useConnectionStore.setState({ status: 'disconnected' });

    const { container, rerender } = renderIndicator();
    expect(container.querySelector('.rounded-full')).not.toBeNull();

    useConnectionStore.setState({ status: 'connected' });

    rerender(
      <TooltipProvider>
        <ConnectionIndicator />
      </TooltipProvider>
    );

    expect(container.querySelector('.rounded-full')).toBeNull();
  });
});
