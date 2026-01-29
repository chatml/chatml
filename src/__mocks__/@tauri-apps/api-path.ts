import { vi } from 'vitest';

export const homeDir = vi.fn().mockResolvedValue('/home/user');
export const join = vi.fn((...parts: string[]) => parts.join('/'));
export const basename = vi.fn((p: string) => p.split('/').pop());
export const dirname = vi.fn((p: string) => p.split('/').slice(0, -1).join('/'));
export const resolve = vi.fn((...parts: string[]) => parts.join('/'));
