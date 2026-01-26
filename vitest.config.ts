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
      thresholds: {
        statements: 20,
        branches: 20,
        functions: 20,
        lines: 20,
      },
    },
    alias: {
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
