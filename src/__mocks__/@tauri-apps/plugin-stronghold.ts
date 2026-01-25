import { vi } from 'vitest';

export class Stronghold {
  static load = vi.fn().mockResolvedValue(new Stronghold());

  getStore = vi.fn().mockResolvedValue({
    get: vi.fn().mockResolvedValue(null),
    insert: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
  });

  save = vi.fn().mockResolvedValue(undefined);
}
