// AC7: a second package that registers the check kind journey without declaring that it replaces the first is
// refused at install, naming the first; one that declares it replaces it installs, and only it runs journeys.
//
// Each implementation is fixtures/journey, a first-party package in the hub whose runner is the conformance
// package's reference check.kind@1 fill and which writes a line to its own seen file on each run. The first,
// `deepbuild/journey-a`, is installed and runs journeys. `deepbuild/journey-b` declares `checks: ["journey"]` and no
// `replaces`; `deepbuild/journey-c` declares `replaces: ["journey"]`, the manifest's way to say a piece replaces
// the one of that name in use (README, Readings: what replaces the first). Each passes check.kind@1's kit at
// install as #349 has it.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ExtensionHost } from '../../../packages/extension-host/src/index.ts';
import { CONFORMANCE_DIST, installAndLoad, installedIds, installError, openHost, openWorld, pkg, releaseEntry, runKnownPass, tempDir } from './helpers.ts';

const A = 'deepbuild/journey-a';
const B = 'deepbuild/journey-b';
const C = 'deepbuild/journey-c';

interface Journey { dir: string; runs(): number }
async function journey(id: string, manifest: Record<string, unknown>): Promise<Journey> {
  const seen = join(tempDir(`seen-${id.split('/')[1]}`), 'seen');
  writeFileSync(seen, '');
  const dir = await pkg('journey', { manifest: { id, ...manifest }, files: { 'journey.json': JSON.stringify({ conformance: CONFORMANCE_DIST, seen }) } });
  return { dir, runs: () => readFileSync(seen, 'utf8').split('\n').filter(Boolean).length };
}

/** One host for the file, its release listing the three, with the first installed, loaded and running journeys. */
let shared: { h: ExtensionHost; a: Journey; b: Journey; c: Journey } | undefined;
async function withFirstJourney() {
  if (!shared) {
    const a = await journey(A, { replaces: ['journey'] });
    const b = await journey(B, { replaces: [] });
    const c = await journey(C, { replaces: ['journey'] });
    const h = await openHost(await openWorld(), { release: await Promise.all([a, b, c].map((j) => releaseEntry(j.dir))) });
    await installAndLoad(h, a.dir);
    shared = { h, a, b, c };
  }
  return shared;
}
/** Runs one journey and returns how many runs each implementation saw. */
async function runOne(h: ExtensionHost, ...js: Journey[]): Promise<number[]> {
  const before = js.map((j) => j.runs());
  expect(await runKnownPass(h, 'journey'), 'a journey runs the known-pass suite').toMatchObject({ outcome: 'passed', testsRun: 2 });
  return js.map((j, i) => j.runs() - before[i]!);
}

describe('AC7 #351.c5e40eeb a second package registering the check kind journey without declaring it replaces the first is refused at install naming the first; one that declares it installs, and only it runs journeys', () => {
  it('AC7 a second journey that doesn\'t declare it replaces the first is refused at install, naming the first, which keeps running journeys', async () => {
    const { h, a, b } = await withFirstJourney();
    expect(await runOne(h, a), `${A} runs journeys`).toEqual([1]);
    const refused = await installError(h, b.dir);
    expect(refused, `${B} registers journey without declaring it replaces ${A}, and is refused at install`).not.toBeNull();
    expect(refused, `the refusal names the first, ${A}`).toContain(A);
    expect(await installedIds(h), `${B} isn't installed`).not.toContain(B);
    expect((await h.checks()).filter((k) => k.kind === 'journey'), `journey is still ${A}'s`).toEqual([{ kind: 'journey', extension: A }]);
    expect(await runOne(h, a, b), `${A} keeps running journeys, and ${B} runs none`).toEqual([1, 0]);
  }, 300_000);

  it('AC7 a second journey that declares it replaces the first installs, and only it runs journeys', async () => {
    const { h, a, c } = await withFirstJourney();
    await installAndLoad(h, c.dir);
    expect((await h.checks()).filter((k) => k.kind === 'journey'), `journey is ${C}'s alone`).toEqual([{ kind: 'journey', extension: C }]);
    expect(await runOne(h, a, c), `only ${C} runs journeys`).toEqual([0, 1]);
  }, 300_000);
});
