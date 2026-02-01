'use client';

import { useEffect } from 'react';
import { useSettingsStore } from '@/stores/settingsStore';
import type { FontSize } from '@/stores/settingsStore';

const FONT_SIZE_MAP: Record<FontSize, string> = {
  small: '12px',
  medium: '13px',
  large: '15px',
};

export function useFontSize() {
  const fontSize = useSettingsStore((s) => s.fontSize);

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--font-size-base', FONT_SIZE_MAP[fontSize]);
  }, [fontSize]);
}
