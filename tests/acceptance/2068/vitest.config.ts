import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Explicit entry: no dependence on newly registering a lane, and no neighbouring suites by accident.
export default defineConfig({
  root: fileURLToPath(new URL('../../../', import.meta.url)),
  test: {
    include: [
      'tests/acceptance/2068/forge-wait.test.ts',
      // Reuse #322's sufficient unchanged comment-author/role proof and its negative controls.
      'tests/acceptance/322/github.test.ts',
    ],
    setupFiles: [fileURLToPath(new URL('../../vitest-setup.ts', import.meta.url))],
    fileParallelism: false,
    maxWorkers: 1,
  },
});
