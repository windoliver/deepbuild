// The config ac2-timing.test.ts runs a redraft with: the checkout's test files and setup file (vitest.config.ts's,
// which can't be imported here: its lanes.mjs pulls workspace packages the config bundler can't read), with judge.mjs
// in place of scripts/benchmark.mjs for every module vitest itself resolves. register.mjs covers what node resolves.
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const benchmark = realpathSync(fileURLToPath(new URL('../../../../../scripts/benchmark.mjs', import.meta.url)));
const plant = realpathSync(fileURLToPath(new URL('./judge.mjs', import.meta.url)));
const is = (id, path) => {
  try {
    const file = id.split('?')[0];
    return realpathSync(file.startsWith('file:') ? fileURLToPath(file) : file) === path;
  } catch {
    return false;
  }
};

export default defineConfig({
  plugins: [{
    name: 'judge-plant',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      if (!importer || !source.includes('benchmark') || is(importer, plant)) return null;
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
      return resolved && is(resolved.id, benchmark) ? plant : null;
    },
  }],
  test: {
    include: ['tests/**/*.test.ts'],
    setupFiles: [fileURLToPath(new URL('../../../../vitest-setup.ts', import.meta.url))],
    // judge.mjs runs as node runs it, so its own import of scripts/benchmark.mjs is node's (register.mjs passes it).
    server: { deps: { external: [/\/twins\/judge-plant\/judge\.mjs$/] } },
  },
});
