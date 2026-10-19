import { availableParallelism } from 'node:os';
import { defineConfig } from 'vitest/config';
import { testGlobs } from './scripts/lanes.mjs';

export default defineConfig({
  test: {
    include: testGlobs('ts'),
    maxWorkers: Math.max(1, Math.floor(availableParallelism() / 2)),
  },
});
