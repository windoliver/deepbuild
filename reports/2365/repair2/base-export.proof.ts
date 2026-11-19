// Throwaway look at the merge base's export (round 2, Defect 2). Not part of the acceptance suite; it judges
// nothing and only prints. It calls the AC5 redraft's own `baseTree()` and lists every file under a `dist` folder of
// the export (the export has none until the merge base's build steps write them), with its bytes and SHA-256, the
// same file's SHA-256 in this checkout's built `dist` for comparison, and where `@deepbuild/contracts` resolves for
// the export's packages. From the repo root:
//   NO_COLOR=1 node node_modules/vitest/vitest.mjs run --configLoader runner --config repair-evidence/round2/base-export.config.ts
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { afterAll, describe, it } from 'vitest';
import { removeTemps, REPO } from '../../tests/acceptance/20/helpers.ts';
import { baseTree } from '../../tests/acceptance/2365-redraft-ac5/base.ts';

afterAll(removeTemps);
const sha = (path: string): string => (existsSync(path) ? createHash('sha256').update(readFileSync(path)).digest('hex') : 'absent');

describe('round 2, Defect 2: what the merge base\'s build steps leave in its export', () => {
  it('lists the export\'s dist files', () => {
    const { dir, sha: base } = baseTree();
    console.log(`merge base ${base}, exported under <export>`);
    for (const pkg of readdirSync(join(dir, 'packages')).sort()) {
      const dist = join(dir, 'packages', pkg, 'dist');
      if (!existsSync(dist)) continue;
      for (const file of readdirSync(dist, { recursive: true }) as string[]) {
        const path = join(dist, file);
        if (!statSync(path).isFile()) continue;
        const rel = relative(dir, path);
        console.log(`<export>/${rel}: ${statSync(path).size} bytes, sha256 ${sha(path)}; this checkout's ${rel}: sha256 ${sha(join(REPO, rel))}`);
      }
    }
    const contracts = realpathSync(join(dir, 'node_modules', '@deepbuild', 'contracts'));
    console.log(`<export>/node_modules/@deepbuild/contracts is ${contracts.startsWith(dir) ? `<export>/${relative(dir, contracts)}` : contracts}`);
    console.log(`<export>/packages/contracts/dist ${existsSync(join(dir, 'packages', 'contracts', 'dist')) ? 'exists' : 'does not exist'} (the build steps ran from the merge base's sources)`);
  }, 300_000);
});
