import '@testing-library/jest-dom/vitest';
import { vi, beforeAll, afterEach, afterAll } from 'vitest';
import { cleanup } from '@testing-library/react';
import { server } from '@/__mocks__/server';

// MSW server lifecycle
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  cleanup();
});
afterAll(() => server.close());

// Mock window.__TAURI__ for Tauri detection
beforeAll(() => {
  Object.defineProperty(window, '__TAURI__', {
    value: undefined,
    writable: true,
  });
});

// Mock ResizeObserver (used by many UI components, including react-virtuoso)
global.ResizeObserver = class ResizeObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
  constructor(_cb: ResizeObserverCallback) {}
} as unknown as typeof globalThis.ResizeObserver;

// Mock IntersectionObserver
global.IntersectionObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}));

// Mock matchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// Mock scrollIntoView
Element.prototype.scrollIntoView = vi.fn();

// Suppress known @iconify/react teardown error (fires timers after jsdom window is gone)
process.on('uncaughtException', (err) => {
  if (
    err instanceof ReferenceError &&
    err.message === 'window is not defined' &&
    err.stack?.includes('iconify')
  ) {
    // Swallow known @iconify/react teardown error
    return;
  }
  throw err;
});

// Mock crypto.randomUUID
Object.defineProperty(crypto, 'randomUUID', {
  value: () => 'test-uuid-' + Math.random().toString(36).slice(2, 11),
});
