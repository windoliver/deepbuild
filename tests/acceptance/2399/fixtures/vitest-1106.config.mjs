// The Vitest config #1106's third criterion runs under when this suite runs it (helpers.ts, run1106). It changes
// nothing of that test: it keeps Vitest's cache out of tests/acceptance/1106 (in the temp folder DH2399_CACHE
// names), and loads plant-setup.mjs, which does nothing unless a plant is named.
import { fileURLToPath } from 'node:url';

export default {
  cacheDir: process.env.DH2399_CACHE,
  test: { setupFiles: [fileURLToPath(new URL('./plant-setup.mjs', import.meta.url))] },
};
