// Throwaway vitest config for measured-pass.proof.ts (round 2, Defect 1). Not part of the acceptance suite.
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    root: fileURLToPath(new URL('.', import.meta.url)),
    include: ['measured-pass.proof.ts'],
    fileParallelism: false,
    testTimeout: 600_000,
  },
});
