// #3088 AC1 (Linux) and the play half of AC2 (macOS arm64), blind redraft: `deep-conformance gate run` of the two
// cases the issue names, reporting-vitest-setup and reporting-rewrite-on-import. Each play starts `deep hub run` from
// the CLI's package (packages/cli/dist/main.js) and fires hooks through target/debug/deep-hook, so before the run this
// suite asserts both are built, naming them, and the proof lanes place the hub's binaries for it. Each case's claim
// and twin must be judged PASS by the kit (the verdict is one the case expects), and the run must end PASS, exit 0.
// On the base on Linux each play stops in makeWorld at `cp: cannot stat '…/@rolldown/binding-darwin-arm64'`, which
// the kit prints as INCONCLUSIVE; the assertion shows that line.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { CASES, REPO, kit, shown } from '../3088/helpers.ts';

const LINUX = '#3088.bb512932';
const MAC = '#3088.301242f7';
/** The CLI the kit's hub runs from, `deep hub run`, as `npm run build --workspaces` builds it. */
const CLI = join(REPO, 'packages/cli/dist/main.js');
/** The hook binary each play's sessions fire, as `cargo build -p deep-hook` builds it. */
const DEEP_HOOK = join(REPO, 'target/debug/deep-hook');
/** Four plays, three at once, each a hub and a Vitest run in its world. */
const RUN_MS = 14 * 60_000;
const LINE = /^(PASS|FAIL|BLOCKED|INCONCLUSIVE) (\S+) (claim|twin): (\S+)(?: — (.*))?$/;

async function playBoth(): Promise<void> {
  expect(existsSync(CLI), `the CLI the kit's hub runs from, packages/cli/dist/main.js, is built (npm run build --workspaces): ${CLI}`).toBe(true);
  expect(existsSync(DEEP_HOOK), `the hub's deep-hook, target/debug/deep-hook, is built (cargo build -p deep-hook): ${DEEP_HOOK}`).toBe(true);
  const r = await kit(['run', ...CASES.flatMap((id) => ['--case', id])], RUN_MS);
  console.log(`gate run of ${CASES.join(', ')}: ${shown(r)}`);
  const lines = r.stdout.split('\n').map((l) => l.trim()).filter(Boolean);
  for (const id of CASES) for (const which of ['claim', 'twin'] as const) {
    const line = lines.find((l) => LINE.exec(l)?.[2] === id && LINE.exec(l)?.[3] === which);
    expect(line, `the kit prints a line for ${id}'s ${which}: ${shown(r)}`).toBeDefined();
    expect(LINE.exec(line!)![1], `${id}'s ${which} plays to a verdict the case expects, so the kit judges it PASS: ${line}`).toBe('PASS');
  }
  expect(r.code, `the run of both cases ends PASS, exit 0: ${shown(r)}`).toBe(0);
  expect(lines.at(-1), 'its last line is the judgement').toMatch(/^PASS gate@1: 2 cases$/);
}

describe("the gate@1 kit plays reporting-vitest-setup and reporting-rewrite-on-import on this machine's platform packages, its hub from packages/cli", () => {
  test.skipIf(process.platform !== 'linux')(`${LINUX} on Linux (Linux only): both cases play their claim and their twin, each verdict one the case expects (deep-conformance gate run)`, playBoth, RUN_MS + 60_000);
  test.skipIf(!(process.platform === 'darwin' && process.arch === 'arm64'))(`${MAC} on macOS arm64 (macOS arm64 only): both cases still play their claim and their twin to expected verdicts (deep-conformance gate run)`, playBoth, RUN_MS + 60_000);
});
