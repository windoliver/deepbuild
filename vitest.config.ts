import { availableParallelism } from 'node:os';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/**/*.test.ts'],
    maxWorkers: Math.max(1, Math.floor(availableParallelism() / 2)),
  },
});
