// AC4: a second implementation of journey installs only after `check.kind@1`'s fixtures pass: a planted runner that
// reports passed with 12 tests on the fixture of a suite that crashed before running is refused at install, naming
// the fixture, and the journey kind in use keeps running.
//
// Each implementation is fixtures/journey, a first-party package in the hub whose runner is the conformance
// package's reference check.kind@1 fill, bent like the kit's own `crashed-suite` planted fill when journey.json says
// planted. The install runs the slot's kit on what the package registers and refuses the package when it fails;
// `Installed.kits` carries each kit's verdict (README, Readings: the kit at install).
import { describe, expect, it } from 'vitest';
import type { ExtensionHost } from '../../../packages/extension-host/src/index.ts';
import { CONFORMANCE_DIST, openHost, openWorld, pkg, releaseEntry, runKnownPass } from './helpers.ts';

let shared: { host: ExtensionHost; a: string; b: string; c: string } | undefined;
const journey = (id: string, planted: boolean): Promise<string> => pkg('journey', { manifest: { id }, files: { 'journey.json': JSON.stringify({ conformance: CONFORMANCE_DIST, planted }) } });
/** One host for the file whose release lists the three implementations, opened by the first test that needs it. */
async function hostWithJourneys() {
  if (!shared) {
    const [a, b, c] = await Promise.all([journey('deepbuild/journey-a', false), journey('deepbuild/journey-b', true), journey('deepbuild/journey-c', false)]);
    const host = await openHost(await openWorld(), { release: await Promise.all([a, b, c].map(releaseEntry)) });
    shared = { host, a, b, c };
  }
  return shared;
}
const kitPassed = { slot: 'check.kind@1', fill: 'journey', verdict: 'PASS' };

describe('AC4 #349.e98531fc a second journey installs only after check.kind@1\'s fixtures pass; a planted runner passing a crashed suite with 12 tests is refused at install naming the fixture, and the kind in use keeps running', () => {
  it('AC4 the first journey installs with check.kind@1 passed and runs; the planted second one is refused at install, naming fail-elsewhere, and the first keeps running', async () => {
    const { host, a, b } = await hostWithJourneys();
    const first = await host.install({ from: a, builtBy: null });
    expect(first.kits ?? [], `the install ran check.kind@1's kit on journey: ${JSON.stringify(first.kits)}`).toContainEqual(kitPassed);
    expect((await host.check(first)).passed).toBe(true);
    expect((await host.load(first)).status).toBe('loaded');
    expect(await runKnownPass(host, 'journey'), 'the journey kind in use runs the known-pass suite').toMatchObject({ outcome: 'passed', testsRun: 2 });

    await expect(host.install({ from: b, builtBy: null }), 'the planted runner is refused at install, naming the fixture').rejects.toThrow(/fail-elsewhere/);
    expect((await host.installed()).map((p) => p.id), 'the refused package isn\'t installed').not.toContain('deepbuild/journey-b');
    expect((await host.checks()).filter((c) => c.kind === 'journey').map((c) => c.extension), 'journey is still the first implementation\'s').toEqual(['deepbuild/journey-a']);
    expect(await runKnownPass(host, 'journey'), 'the journey kind in use keeps running').toMatchObject({ outcome: 'passed', testsRun: 2 });
  }, 300_000);

  it('AC4 a sound second implementation of journey installs, after check.kind@1\'s fixtures pass on it', async () => {
    const { host, c } = await hostWithJourneys();
    const second = await host.install({ from: c, builtBy: null });
    expect(second.kits ?? [], JSON.stringify(second.kits)).toContainEqual(kitPassed);
    expect((await host.installed()).map((p) => p.id)).toContain('deepbuild/journey-c');
  }, 300_000);
});
