import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['**/__tests__/**/*.test.ts'],
    exclude: ['node_modules', '.next', 'deps'],
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, './') },
  },
});
