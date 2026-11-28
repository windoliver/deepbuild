import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    root: fileURLToPath(new URL('.', import.meta.url)),
    include: ['heavy/**/*.heavy.ts'],
    fileParallelism: false,
    testTimeout: 7_200_000,
    hookTimeout: 3_600_000,
  },
});
