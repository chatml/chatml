import { vi } from 'vitest';

export const open = vi.fn().mockResolvedValue(undefined);

export const Command = vi.fn().mockImplementation(() => ({
  execute: vi.fn().mockResolvedValue({ stdout: '', stderr: '', code: 0 }),
  spawn: vi.fn().mockResolvedValue({
    pid: 12345,
    kill: vi.fn(),
    write: vi.fn(),
  }),
  on: vi.fn(),
}));
