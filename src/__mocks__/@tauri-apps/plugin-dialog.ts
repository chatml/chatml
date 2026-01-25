import { vi } from 'vitest';

export const open = vi.fn().mockResolvedValue('/mock/selected/path');
export const save = vi.fn().mockResolvedValue('/mock/save/path');
export const message = vi.fn().mockResolvedValue(undefined);
export const ask = vi.fn().mockResolvedValue(true);
export const confirm = vi.fn().mockResolvedValue(true);
