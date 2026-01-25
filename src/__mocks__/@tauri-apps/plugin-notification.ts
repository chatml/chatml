import { vi } from 'vitest';

export const isPermissionGranted = vi.fn().mockResolvedValue(true);
export const requestPermission = vi.fn().mockResolvedValue('granted');
export const sendNotification = vi.fn();
