import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // Force truly sequential execution to avoid database race conditions and deadlocks
    maxConcurrency: 1,
    fileParallelism: false, // Don't run test files in parallel
    threads: false, // Disable worker threads - run in main thread
    isolate: false, // Don't isolate test files (runs sequentially)
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'dist/',
        'tests/',
        '**/*.config.ts',
        '**/*.d.ts',
      ],
    },
    testTimeout: 30000,
    hookTimeout: 30000,
    setupFiles: ['./tests/setup.ts'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@cloud-org/shared': path.resolve(__dirname, './src/shared'),
    },
  },
});

