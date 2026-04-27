import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useFontSize } from '../useFontSize';
import { useSettingsStore } from '@/stores/settingsStore';

describe('useFontSize', () => {
  beforeEach(() => {
    document.documentElement.style.removeProperty('--font-size-base');
    useSettingsStore.setState({ fontSize: 'medium' } as never);
  });

  it("sets --font-size-base to 13px for 'medium'", () => {
    useSettingsStore.setState({ fontSize: 'medium' } as never);
    renderHook(() => useFontSize());
    expect(
      document.documentElement.style.getPropertyValue('--font-size-base'),
    ).toBe('13px');
  });

  it("sets --font-size-base to 12px for 'small'", () => {
    useSettingsStore.setState({ fontSize: 'small' } as never);
    renderHook(() => useFontSize());
    expect(
      document.documentElement.style.getPropertyValue('--font-size-base'),
    ).toBe('12px');
  });

  it("sets --font-size-base to 15px for 'large'", () => {
    useSettingsStore.setState({ fontSize: 'large' } as never);
    renderHook(() => useFontSize());
    expect(
      document.documentElement.style.getPropertyValue('--font-size-base'),
    ).toBe('15px');
  });
});
