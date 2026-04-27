import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['node_modules', 'tests/e2e'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      reportsDirectory: './coverage',
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.d.ts',
        'src/**/*.test.{ts,tsx}',
        'src/**/*.spec.{ts,tsx}',
        'src/app/**/layout.tsx',
        'src/app/**/loading.tsx',
        'src/app/**/error.tsx',
      ],
      // Coverage gate, calibrated to current measured values minus ~2 pts of headroom.
      // Per-glob thresholds lock in the well-tested directories (lib/, lib/api/, stores/)
      // so future PRs cannot silently regress them while the global average stays
      // acceptable. Ratchet upward as new tests land.
      thresholds: {
        // Global gate (catches regressions outside the explicitly-cared-for directories)
        statements: 22,
        branches: 19,
        functions: 22,
        lines: 22,
        // High-coverage directories: hold them near current values.
        // src/lib/api/** is matched first (more specific glob) so its higher floor
        // applies to the API clients; everything else under src/lib/** falls back
        // to the broader floor below.
        'src/lib/api/**': {
          statements: 85,
          branches: 68,
          functions: 85,
          lines: 85,
        },
        'src/lib/**': {
          statements: 55,
          branches: 55,
          functions: 55,
          lines: 58,
        },
        'src/stores/**': {
          statements: 60,
          branches: 51,
          functions: 53,
          lines: 61,
        },
      },
    },
    alias: {
      '@tauri-apps/api/event': path.resolve(__dirname, 'src/__mocks__/@tauri-apps/api-event.ts'),
      '@tauri-apps/api/window': path.resolve(__dirname, 'src/__mocks__/@tauri-apps/api-window.ts'),
      '@tauri-apps/api/path': path.resolve(__dirname, 'src/__mocks__/@tauri-apps/api-path.ts'),
      '@tauri-apps/api/core': path.resolve(__dirname, 'src/__mocks__/@tauri-apps/api.ts'),
      '@tauri-apps/api': path.resolve(__dirname, 'src/__mocks__/@tauri-apps/api.ts'),
      '@tauri-apps/plugin-dialog': path.resolve(__dirname, 'src/__mocks__/@tauri-apps/plugin-dialog.ts'),
      '@tauri-apps/plugin-shell': path.resolve(__dirname, 'src/__mocks__/@tauri-apps/plugin-shell.ts'),
      '@tauri-apps/plugin-notification': path.resolve(__dirname, 'src/__mocks__/@tauri-apps/plugin-notification.ts'),
      '@tauri-apps/plugin-clipboard-manager': path.resolve(__dirname, 'src/__mocks__/@tauri-apps/plugin-clipboard-manager.ts'),
      '@tauri-apps/plugin-stronghold': path.resolve(__dirname, 'src/__mocks__/@tauri-apps/plugin-stronghold.ts'),
      '@tauri-apps/plugin-updater': path.resolve(__dirname, 'src/__mocks__/@tauri-apps/plugin-updater.ts'),
      '@tauri-apps/plugin-process': path.resolve(__dirname, 'src/__mocks__/@tauri-apps/plugin-process.ts'),
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
