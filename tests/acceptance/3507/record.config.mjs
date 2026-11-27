// #3507 criterion 4: the config a suite under tests/acceptance runs with while its frames are drawn again by the merge
// base's build, as #3016's frames/record.config.ts is: what those suites run with (`npx vitest run --root
// tests/acceptance/<n>`, as each README says), plus the repo's own setup file and the recorder.
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    setupFiles: [
      fileURLToPath(new URL('../../vitest-setup.ts', import.meta.url)),
      fileURLToPath(new URL('./record.mjs', import.meta.url)),
    ],
    testTimeout: 3_600_000,
    hookTimeout: 3_600_000,
  },
});
