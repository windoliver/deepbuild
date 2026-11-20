// AC1 #2227.0f03b34b: `tsc -p tsconfig.json --noEmit` exits 0 in `packages/hub` and in `packages/cli`.
//
// The criterion's command as written, run in each package's folder with the TypeScript the repository installs
// (node_modules/typescript, the one the packages' own `tsc -p tsconfig.json` builds run). `--noEmit` writes nothing,
// so it runs in this checkout, the two packages side by side. Each package reads its workspace dependencies' sources
// (their `types` are `./src/index.ts`), so it needs no build. At the base each exits 2 with the issue's three errors at
// the gate's call in packages/hub/src/core.ts (BASE-FAILURE.txt).
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MINUTES, REPO, errorLines, inconclusive, run } from './helpers.ts';

const TSC = join(REPO, 'node_modules', 'typescript', 'bin', 'tsc');
const PACKAGES = ['hub', 'cli'] as const;

describe('#2227 the hub and the CLI type-check', () => {
  it('AC1 #2227.0f03b34b tsc -p tsconfig.json --noEmit exits 0 in packages/hub and in packages/cli', async () => {
    if (!existsSync(TSC)) inconclusive('node_modules/typescript is not installed in this checkout (npm ci)');
    const ended = await Promise.all(PACKAGES.map((name) => run(process.execPath, [TSC, '-p', 'tsconfig.json', '--noEmit'], join(REPO, 'packages', name), 25 * MINUTES)));
    const codes = Object.fromEntries(PACKAGES.map((name, i) => [name, ended[i]!.code]));
    const said = PACKAGES.map((name, i) => `--- packages/${name}, exit ${ended[i]!.code}, ${ended[i]!.ms} ms:\n${errorLines(ended[i]!.out)}`).join('\n');
    expect(codes, `tsc -p tsconfig.json --noEmit's exit code in each package\n${said}`).toEqual({ hub: 0, cli: 0 });
  }, 30 * MINUTES);
});
