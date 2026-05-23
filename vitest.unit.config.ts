import { defineConfig } from 'vitest/config';
import path from 'path';

/** Unit tests — no database setup. */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/unit/membership-webhook.test.ts'],
    testTimeout: 15_000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@cloud-org/shared': path.resolve(__dirname, './src/shared'),
    },
  },
});
