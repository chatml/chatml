import { vi } from 'vitest';

export const listen = vi.fn().mockResolvedValue(() => {});
export const emit = vi.fn();
export const once = vi.fn().mockResolvedValue(() => {});
