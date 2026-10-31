import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Real hubs and a timed job, one file at a time.
export default defineConfig({
  root: fileURLToPath(new URL('../../../', import.meta.url)),
  test: { include: ['tests/acceptance/39-redraft/*.test.ts'], fileParallelism: false },
});
