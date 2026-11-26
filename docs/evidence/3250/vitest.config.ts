// Runs drive.ts alone, so its imports of the packages' TypeScript sources resolve as the suites' do.
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: fileURLToPath(new URL('../../../', import.meta.url)),
  test: { include: ['docs/evidence/3250/drive.ts'], testTimeout: 240_000, hookTimeout: 60_000 },
});
