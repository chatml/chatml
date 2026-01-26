import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ToastProvider, useToast } from '../ui/toast';
import { useRef, useEffect } from 'react';

// Test component that triggers toast on mount (only once via ref)
function ToastTrigger({
  type,
  message,
  title,
}: {
  type: 'error' | 'success' | 'info' | 'warning';
  message: string;
  title?: string;
}) {
  const toast = useToast();
  const triggeredRef = useRef(false);

  useEffect(() => {
    if (!triggeredRef.current) {
      triggeredRef.current = true;
      toast[type](message, title);
    }
  }, [toast, type, message, title]);

  return null;
}

describe('Toast component', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it('renders ToastProvider without error', () => {
    render(
      <ToastProvider>
        <div>Test child</div>
      </ToastProvider>
    );

    expect(screen.getByText('Test child')).toBeInTheDocument();
  });

  it('renders error toast', () => {
    render(
      <ToastProvider>
        <ToastTrigger type="error" message="Test error" title="Error" />
      </ToastProvider>
    );

    expect(screen.getByText('Test error')).toBeInTheDocument();
    expect(screen.getByText('Error')).toBeInTheDocument();
  });

  it('renders success toast', () => {
    render(
      <ToastProvider>
        <ToastTrigger type="success" message="Test success" />
      </ToastProvider>
    );

    expect(screen.getByText('Test success')).toBeInTheDocument();
  });

  it('renders info toast', () => {
    render(
      <ToastProvider>
        <ToastTrigger type="info" message="Test info" />
      </ToastProvider>
    );

    expect(screen.getByText('Test info')).toBeInTheDocument();
  });

  it('renders warning toast with correct styling', () => {
    render(
      <ToastProvider>
        <ToastTrigger type="warning" message="Test warning" title="Warning" />
      </ToastProvider>
    );

    expect(screen.getByText('Test warning')).toBeInTheDocument();
    expect(screen.getByText('Warning')).toBeInTheDocument();

    // Verify warning styling is applied (yellow colors)
    const toast = screen.getByRole('alert');
    expect(toast.className).toContain('yellow');
  });
});
