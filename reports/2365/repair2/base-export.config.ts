// Throwaway vitest config for base-export.proof.ts (round 2, Defect 2). Not part of the acceptance suite.
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    root: fileURLToPath(new URL('.', import.meta.url)),
    include: ['base-export.proof.ts'],
    fileParallelism: false,
  },
});
