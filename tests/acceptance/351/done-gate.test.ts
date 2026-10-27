// AC4: a package whose manifest declares it replaces the done gate, or provides a second done gate beside it, is
// refused at install, naming the done gate, until a second gate exists and `gate@1` opens with #33's seeded false
// dones as its kit; the done gate already installed, a test gate here, keeps judging, and a host that refuses only
// the ring's pieces installs the package and fails this test.
//
// The test gate is fixtures/gate, `deepbuild/done-gate`, a first-party package in the hub whose check kind
// `ext.done-gate.verdict` judges a claim's test report: failed for a false done, passed for the real fix. A package
// replaces the done gate with `replaces: ["done-gate"]`, and provides a second one beside it with
// `provides: [{ interface: "gate@1", ... }]` (README, The surface under test). No second gate exists and `gate@1`
// hasn't opened (no slot row, no kit), which the test checks first: the day it opens, this criterion's "until"
// needs a redraft, and the check says so. The planted twin is the host's `plant: 'refuses-only-the-ring'`, which
// refuses a package replacing a ring piece and nothing else.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { CheckResult } from '../../../packages/conformance/src/index.ts';
import type { ExtensionHost, Plant } from '../../../packages/extension-host/src/index.ts';
import { contracts, installAndLoad, installedIds, installError, openHost, openWorld, pkg, releaseEntry, SPEC, tempDir } from './helpers.ts';

const GATE = 'deepbuild/done-gate';
const VERDICT = 'ext.done-gate.verdict';
const REPLACER = 'deepbuild/rival-gate';
const BESIDE = 'deepbuild/second-gate';
const NAMES_DONE_GATE = /done[- ]gate/i;

/** The test gate's verdict on a claim whose tests report `passed` and `failed`. */
async function judge(h: ExtensionHost, report: { passed: number; failed: number }): Promise<CheckResult> {
  const checkout = tempDir('claim');
  writeFileSync(join(checkout, 'report.json'), JSON.stringify(report));
  return h.runCheck(VERDICT, SPEC(VERDICT), { checkout, deadline: 30_000 });
}
/** The done gate in use is installed, loaded, holds its check kind, and judges: a false done fails and the real fix passes. */
async function keepsJudging(h: ExtensionHost, when: string): Promise<void> {
  expect(await installedIds(h), `${when}: the done gate ${GATE} is installed`).toContain(GATE);
  expect((await h.loaded()).map((l) => l.id), `${when}: the done gate ${GATE} is loaded`).toContain(GATE);
  expect(await h.checks(), `${when}: ${VERDICT} is the done gate's`).toContainEqual({ kind: VERDICT, extension: GATE });
  expect(await judge(h, { passed: 3, failed: 1 }), `${when}: the done gate judges a false done`).toMatchObject({ outcome: 'failed', testsRun: 4 });
  expect(await judge(h, { passed: 4, failed: 0 }), `${when}: the done gate judges the real fix`).toMatchObject({ outcome: 'passed', testsRun: 4 });
}
/** A host on a fresh world whose release holds the test gate, installed, loaded and judging. */
async function withDoneGate(plant?: Plant): Promise<ExtensionHost> {
  const gate = await pkg('gate');
  const h = await openHost(await openWorld(), { release: [await releaseEntry(gate)], ...(plant ? { plant } : {}) });
  await installAndLoad(h, gate);
  await keepsJudging(h, 'before');
  return h;
}
const replacer = () => pkg('plain', { manifest: { id: REPLACER, replaces: ['done-gate'] } });
const beside = () => pkg('plain', { manifest: { id: BESIDE, provides: [{ interface: 'gate@1', kind: 'check', minor: 0 }] } });

/** The criterion's assertion: refused at install, naming the done gate, and the done gate keeps judging. */
async function refusedNamingTheDoneGate(h: ExtensionHost, dir: string, id: string, what: string): Promise<void> {
  const refused = await installError(h, dir);
  expect(refused, `${id}, which ${what}, is refused at install: the done gate is not replaceable`).not.toBeNull();
  expect(refused, `the refusal of ${id} names the done gate`).toMatch(NAMES_DONE_GATE);
  expect(await installedIds(h), `${id} isn't installed`).not.toContain(id);
  await keepsJudging(h, `after ${id}'s refusal`);
}

describe('AC4 #351.f151ca10 a package replacing the done gate, or providing a second one beside it, is refused at install naming the done gate until gate@1 opens; the installed test gate keeps judging; a host refusing only the ring\'s pieces fails this test', () => {
  it('AC4 gate@1 hasn\'t opened; a package declaring it replaces the done gate, and one providing a second done gate beside it, are each refused at install naming the done gate, which keeps judging; without the declarations they install', async () => {
    const { hubSlots } = await contracts();
    expect(hubSlots().filter((row) => row.interface === 'gate@1'), 'gate@1 hasn\'t opened, no second gate exists: if it has, this criterion\'s "until" needs a redraft').toEqual([]);

    const h = await withDoneGate();
    await refusedNamingTheDoneGate(h, await replacer(), REPLACER, 'declares it replaces the done gate');
    await refusedNamingTheDoneGate(h, await beside(), BESIDE, 'provides a second done gate, gate@1, beside it');

    for (const id of [REPLACER, BESIDE]) {
      expect(await installError(h, await pkg('plain', { manifest: { id } })), `${id} without the declaration installs`).toBeNull();
    }
    await keepsJudging(h, 'after the plain packages installed');
  }, 180_000);

  it('AC4 (wrong program) a host that refuses only the ring\'s pieces refuses a package replacing the supervisor, installs the one replacing the done gate, and fails this test', async () => {
    const h = await withDoneGate('refuses-only-the-ring');
    const ring = await pkg('plain', { manifest: { id: 'deepbuild/ring-twin', replaces: ['supervisor'] } });
    expect(await installError(h, ring), 'the planted host is the twin the criterion names: it refuses a package replacing a ring piece, the supervisor').not.toBeNull();
    await expect(refusedNamingTheDoneGate(h, await replacer(), REPLACER, 'declares it replaces the done gate')).rejects.toThrow(/the done gate is not replaceable/);
    expect(await installedIds(h), `the planted host installed ${REPLACER}`).toContain(REPLACER);
  }, 180_000);
});
