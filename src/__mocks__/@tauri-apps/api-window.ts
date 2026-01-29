import { vi } from 'vitest';

export const getCurrentWindow = vi.fn().mockReturnValue({
  label: 'main',
  close: vi.fn(),
  minimize: vi.fn(),
  maximize: vi.fn(),
  setTitle: vi.fn(),
  setFocus: vi.fn(),
});

export const getAll = vi.fn().mockReturnValue([]);
