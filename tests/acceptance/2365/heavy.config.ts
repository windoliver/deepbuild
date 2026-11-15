// The heavy runs of #2365's acceptance tests (README, How to run): AC1's 100 MB pass, AC2's 600 MB pass and AC6's
// budgets. Their files end in .heavy.ts, so neither the unit lane nor a plain run of this folder picks them up.
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
