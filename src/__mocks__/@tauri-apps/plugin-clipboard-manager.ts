import { vi } from 'vitest';

export const writeText = vi.fn().mockResolvedValue(undefined);
export const readText = vi.fn().mockResolvedValue('');
export const writeHtml = vi.fn().mockResolvedValue(undefined);
export const readHtml = vi.fn().mockResolvedValue('');
