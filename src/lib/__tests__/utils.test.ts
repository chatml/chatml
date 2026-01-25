import { describe, it, expect } from 'vitest';
import { cn } from '../utils';

describe('cn utility function', () => {
  it('merges class names correctly', () => {
    expect(cn('foo', 'bar')).toBe('foo bar');
  });

  it('handles conditional classes', () => {
    const isActive = true;
    const isDisabled = false;
    expect(cn('base', isActive && 'active', isDisabled && 'disabled')).toBe('base active');
  });

  it('handles arrays of classes', () => {
    expect(cn(['foo', 'bar'], 'baz')).toBe('foo bar baz');
  });

  it('handles objects with boolean values', () => {
    expect(cn({ foo: true, bar: false, baz: true })).toBe('foo baz');
  });

  it('merges tailwind classes correctly (last wins)', () => {
    expect(cn('p-4', 'p-2')).toBe('p-2');
    expect(cn('text-red-500', 'text-blue-500')).toBe('text-blue-500');
  });

  it('handles conflicting tailwind utilities', () => {
    expect(cn('px-2 py-1', 'p-4')).toBe('p-4');
  });

  it('preserves non-conflicting classes', () => {
    expect(cn('flex items-center', 'justify-between')).toBe('flex items-center justify-between');
  });

  it('handles undefined and null values', () => {
    expect(cn('foo', undefined, null, 'bar')).toBe('foo bar');
  });

  it('handles empty strings', () => {
    expect(cn('foo', '', 'bar')).toBe('foo bar');
  });

  it('returns empty string for no arguments', () => {
    expect(cn()).toBe('');
  });
});
