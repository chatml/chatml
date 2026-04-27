import '@testing-library/jest-dom/vitest';
import { vi, beforeAll, afterEach, afterAll } from 'vitest';
import { cleanup } from '@testing-library/react';
import { server } from '@/__mocks__/server';
import { __resetInFlightGetsForTests } from '@/lib/api/base';

// Polyfill localStorage for jsdom (node's --localstorage-file may not work)
if (typeof globalThis.localStorage === 'undefined' || typeof globalThis.localStorage.setItem !== 'function') {
  const store = new Map<string, string>();
  const localStorageMock: Storage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, String(value)); },
    removeItem: (key: string) => { store.delete(key); },
    clear: () => { store.clear(); },
    get length() { return store.size; },
    key: (index: number) => [...store.keys()][index] ?? null,
  };
  Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock, writable: true });
}

// MSW server lifecycle
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  cleanup();
  // Drop any in-flight GET dedup state so MSW handler rotation between tests
  // doesn't bleed cached responses across cases.
  __resetInFlightGetsForTests();
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
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
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
