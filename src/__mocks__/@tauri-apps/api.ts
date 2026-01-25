import { vi } from 'vitest';

export const invoke = vi.fn();
export const convertFileSrc = vi.fn((src: string) => src);

export const event = {
  listen: vi.fn().mockResolvedValue(() => {}),
  emit: vi.fn(),
  once: vi.fn().mockResolvedValue(() => {}),
};

export const window = {
  getCurrent: vi.fn().mockReturnValue({
    label: 'main',
    close: vi.fn(),
    minimize: vi.fn(),
    maximize: vi.fn(),
    setTitle: vi.fn(),
    setFocus: vi.fn(),
  }),
  getAll: vi.fn().mockReturnValue([]),
};

export const path = {
  join: vi.fn((...parts: string[]) => parts.join('/')),
  basename: vi.fn((p: string) => p.split('/').pop()),
  dirname: vi.fn((p: string) => p.split('/').slice(0, -1).join('/')),
  resolve: vi.fn((...parts: string[]) => parts.join('/')),
};
