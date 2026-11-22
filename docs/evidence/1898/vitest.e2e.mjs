// Runs e2e.test.ts with the repo's vitest, rooted at the repo so its sources resolve as the repo's own suites resolve them.
import { fileURLToPath } from 'node:url';

export default {
  root: fileURLToPath(new URL('../../../', import.meta.url)),
  test: { dir: fileURLToPath(new URL('.', import.meta.url)), include: ['e2e.test.ts'], testTimeout: 1_500_000, hookTimeout: 120_000 },
};
