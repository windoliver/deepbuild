// #3088: `deep-conformance gate run` plays reporting-vitest-setup and reporting-rewrite-on-import, each case's claim
// and its twin, on the done gate this checkout builds. Criteria:
//   #3088.bb512932 "On Linux (the Spark, aarch64), [both cases] play their claim and their twin, and each verdict is
//   one the case expects. `deep-conformance gate run reporting-vitest-setup reporting-rewrite-on-import` proves it."
//   #3088.301242f7 "On macOS arm64, both cases still play to their expected verdicts, …" (the world half is in
//   worlds.test.ts).
// Each play starts `deep hub run` from packages/cli/dist/main.js and fires its hooks through target/debug/deep-hook,
// so both must be built; the test says so before it plays rather than reading a missing build as the kit's verdict.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { CASES, KIT_BIN, REPO, clean, judgements, kit, shown } from './helpers.ts';

/** How long the kit's run of the two cases (four plays, three at once) may take before it is killed. */
const KIT_MS = 15 * 60_000;
const TIMEOUT = KIT_MS + 60_000;

function builtForPlays(): void {
  expect(existsSync(KIT_BIN), `the kit's command ${KIT_BIN.slice(REPO.length)} is built (npm run build --workspaces)`).toBe(true);
  expect(existsSync(join(REPO, 'packages/cli/dist/main.js')), 'the CLI each play runs `deep hub run` from, packages/cli/dist/main.js, is built (npm run build --workspaces)').toBe(true);
  expect(existsSync(join(REPO, 'target/debug/deep-hook')), 'target/debug/deep-hook, which fires each play\'s hooks, is built (cargo build -p deep-hook)').toBe(true);
}

async function playBoth(): Promise<void> {
  builtForPlays();
  const r = await kit(['run', ...CASES.flatMap((id) => ['--case', id])], KIT_MS);
  const want = Object.fromEntries(CASES.flatMap((id) => [[`${id} claim`, 'PASS'], [`${id} twin`, 'PASS']]));
  expect(judgements(r.stdout), `each case's claim and twin plays to a verdict the case expects (the kit's PASS line for each play): ${shown(r)}`).toEqual(want);
  expect(r.stdout, `no play stops copying an install: ${shown(r)}`).not.toMatch(/cannot stat/);
  expect(r.stdout.trim().split('\n').at(-1), `the kit's run ends PASS for both cases: ${shown(r)}`).toBe('PASS gate@1: 2 cases');
  expect(r.code, `the kit exits 0: ${shown(r)}`).toBe(0);
}

describe('deep-conformance gate run plays reporting-vitest-setup and reporting-rewrite-on-import', () => {
  afterEach(() => { clean(); });

  test('#3088.bb512932 on Linux (Linux only), both cases play their claim and their twin, each to a verdict the case expects', async (ctx) => {
    if (process.platform !== 'linux') ctx.skip(`Linux only (this is ${process.platform} ${process.arch})`);
    await playBoth();
  }, TIMEOUT);

  test('#3088.301242f7 on macOS arm64 (macOS arm64 only), both cases still play their claim and their twin to expected verdicts', async (ctx) => {
    if (process.platform !== 'darwin' || process.arch !== 'arm64') ctx.skip(`macOS arm64 only (this is ${process.platform} ${process.arch})`);
    await playBoth();
  }, TIMEOUT);
});
