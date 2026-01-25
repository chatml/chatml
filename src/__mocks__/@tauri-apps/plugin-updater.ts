import { vi } from 'vitest';

export const check = vi.fn().mockResolvedValue(null);

export const onUpdaterEvent = vi.fn().mockResolvedValue(() => {});

export class Update {
  version = '0.0.0';
  currentVersion = '0.0.0';
  body = '';
  date = '';

  downloadAndInstall = vi.fn().mockResolvedValue(undefined);
}
