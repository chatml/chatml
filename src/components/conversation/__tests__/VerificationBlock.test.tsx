import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { VerificationBlock } from '../VerificationBlock';
import type { VerificationResult } from '@/lib/types';

describe('VerificationBlock', () => {
  const allPassing: VerificationResult[] = [
    { name: 'unit tests', status: 'pass' },
    { name: 'lint', status: 'pass' },
  ];

  const mixed: VerificationResult[] = [
    { name: 'unit tests', status: 'pass' },
    { name: 'lint', status: 'fail', details: '3 errors' },
    { name: 'type check', status: 'skipped' },
  ];

  const running: VerificationResult[] = [
    { name: 'unit tests', status: 'running' },
    { name: 'lint', status: 'pass' },
  ];

  it('renders pass count', () => {
    render(<VerificationBlock results={allPassing} />);
    expect(screen.getByText('2/2 passed')).toBeInTheDocument();
  });

  it('shows mixed results count', () => {
    render(<VerificationBlock results={mixed} />);
    expect(screen.getByText('1/3 passed')).toBeInTheDocument();
  });

  it('starts expanded by default', () => {
    render(<VerificationBlock results={allPassing} />);
    expect(screen.getByText('unit tests')).toBeInTheDocument();
    expect(screen.getByText('lint')).toBeInTheDocument();
  });

  it('collapses on click', async () => {
    const user = userEvent.setup();
    render(<VerificationBlock results={allPassing} />);

    // Click the trigger to collapse
    await user.click(screen.getByText('Verification'));

    // Radix Collapsible removes hidden content from DOM
    expect(screen.queryByText('unit tests')).toBeNull();
  });

  it('shows failure details', () => {
    render(<VerificationBlock results={mixed} />);
    expect(screen.getByText('3 errors')).toBeInTheDocument();
  });

  it('shows running spinner', () => {
    const { container } = render(<VerificationBlock results={running} />);
    // Loader2 icon has animate-spin class
    const spinners = container.querySelectorAll('.animate-spin');
    expect(spinners.length).toBeGreaterThan(0);
  });
});
