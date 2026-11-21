// #1907 AC1: the package's result for the recorded journeys in its suites is byte for byte the merge base's, less
// the deleted fields. The package's result is what its public entry hands back for a journey, `runJourney`'s
// JourneyRun (check.kind@1's CheckResult plus the run record). The journeys are the sample app's in
// tests/acceptance/37/fixtures/app/.deepbuild/journeys, the files the package's suites run, each run through this
// checkout's package and through the merge base's (`git merge-base HEAD origin/main`, its packages/checks-journey
// exported with `git archive`, its own driver included), on the same app, each on a fresh checkout and world.
// What two runs of one program never share is replaced before comparing, the same on both sides (README, AC1):
// times, the run and stack handles, pids, ports, the checkout's path, and each SHA-256 by its order of first
// appearance. Then the base's result, less the fields this checkout's result no longer has, must equal this
// checkout's result as text.
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { JourneyRun, JourneyRunOptions } from '../../../packages/checks-journey/src/index.ts';
import { blocked, checkout, journey, journeyPath, openWorld, REPO, runOptions, testSecret, type Journey, type World } from '../37/helpers.ts';

const AC1 = '#1907.0d8e070f';
/**
 * The fixture's journeys whose runs can agree: a browser journey per kind of step (goto and expect, fill with a
 * secret and click, scroll with motion) and the API journey. `checkout` is left out: its order ID is random on
 * every run by design (fixtures/app/server.mjs), so no two runs of any program agree on its route or readback.
 */
const JOURNEYS = ['cart-total', 'cart-api', 'login', 'motion'] as const;
const EXPORTS = join(REPO, 'target', 'acceptance-1907-base');
/** The folder this file exported the merge base's package into, removed after the file. */
let exported: string | null = null;

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/**
 * The merge base's package, exported beside this checkout so it resolves the same dependencies; its entry. The root
 * tsconfig.json comes with it, as the package's tsconfig extends it and the test's transform reads that chain.
 */
function baseEntry(): string {
  let sha: string;
  try {
    sha = execFileSync('git', ['-C', REPO, 'merge-base', 'HEAD', 'origin/main'], { encoding: 'utf8' }).trim();
  } catch (error) {
    return blocked(`no merge base with origin/main to compare with: ${(error as Error).message.split('\n')[0]}`);
  }
  const dir = join(EXPORTS, `${sha}-${process.pid}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  exported = dir;
  const tar = execFileSync('git', ['-C', REPO, 'archive', '--format=tar', sha, 'packages/checks-journey', 'tsconfig.json'], { maxBuffer: 256 * 1024 * 1024 });
  execFileSync('tar', ['-x', '-C', dir], { input: tar });
  return join(dir, 'packages/checks-journey/src/index.ts');
}

/** A run's result as text, with what no two runs share replaced (README, AC1). */
function normalized(run: JourneyRun, o: JourneyRunOptions): Json {
  const handles: [string, string][] = [[o.checkout, '<checkout>'], [o.run, '<run>'], ...(run.stack ? [[run.stack.run, '<stack>'] as [string, string]] : [])];
  const hashes = new Map<string, string>();
  const text = (s: string): string => {
    if (/^[0-9a-f]{64}$/.test(s)) {
      if (!hashes.has(s)) hashes.set(s, `<sha ${hashes.size}>`);
      return hashes.get(s)!;
    }
    let out = s;
    for (const [from, to] of handles) out = out.split(from).join(to);
    return out.replace(/127\.0\.0\.1:\d+/g, '127.0.0.1:<port>');
  };
  const walk = (v: Json, zero: boolean): Json => {
    if (typeof v === 'string') return text(v);
    if (typeof v === 'number') return zero ? 0 : v;
    if (Array.isArray(v)) return v.map((x) => walk(x, zero));
    if (v && typeof v === 'object') {
      // Times, and the stack's pid and ports, are the run's own; every other number is the program's.
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x, zero || k === 'startMs' || k === 'endMs' || k === 'timing' || k === 'stack')]));
    }
    return v;
  };
  return walk(JSON.parse(JSON.stringify(run)) as Json, false);
}

/** The base's result less the fields the head's no longer has, at every depth. */
function less(base: Json, head: Json): Json {
  if (Array.isArray(base) && Array.isArray(head)) return base.map((x, i) => (i < head.length ? less(x, head[i]!) : x));
  if (base && head && typeof base === 'object' && typeof head === 'object' && !Array.isArray(base) && !Array.isArray(head)) {
    return Object.fromEntries(Object.entries(base).filter(([k]) => k in head).map(([k, x]) => [k, less(x, head[k]!)]));
  }
  return base;
}

let base: Journey;
let head: Journey;
let baseWorld: World;
let headWorld: World;
beforeAll(async () => {
  head = await journey();
  base = (await import(pathToFileURL(baseEntry()).href)) as Journey;
  baseWorld = await openWorld();
  headWorld = await openWorld();
}, 120_000);
afterAll(() => { if (exported) rmSync(exported, { recursive: true, force: true }); });

it(`${AC1} for the recorded journeys in its suites, the package's result is byte for byte the merge base's, less the deleted fields`, async () => {
  const secret = testSecret();
  const sides: Record<string, { base: Json; head: Json }> = {};
  for (const id of JOURNEYS) {
    const run = async (surface: Journey, world: World): Promise<Json> => {
      const o = runOptions(world, checkout(), journeyPath(id), id === 'login' ? { secrets: { TEST_PASSWORD: secret } } : {});
      return normalized(await surface.runJourney(o), o);
    };
    const was = await run(base, baseWorld);
    // A merge base whose own run didn't pass is no reference: the comparison can't be made here.
    if ((was as { outcome?: unknown }).outcome !== 'passed') blocked(`the merge base's ${id} run didn't pass, so it is no reference: ${JSON.stringify(was).slice(0, 2000)}`);
    sides[id] = { base: was, head: await run(head, headWorld) };
  }
  const shown = (pick: (s: { base: Json; head: Json }) => Json): string => JSON.stringify(Object.fromEntries(JOURNEYS.map((id) => [id, pick(sides[id]!)])), null, 2);
  expect(shown((s) => s.head), 'this checkout\'s results, against the merge base\'s less the deleted fields').toBe(shown((s) => less(s.base, s.head)));
}, 600_000);
