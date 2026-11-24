// #3258.7ba56287: "Budget, on the reference Mac in the local preflight, compared with the merge base: the audit of the
// 280-particle banner over 10 s takes under 1.5 times as long, drafted, and a world with no soft body takes no longer"
//
// A timed file (README: The budget). In order:
//   1. On any machine: what is timed is the audit that reads. The banner's world holds one soft body of 280 particles and
//      the world with no soft body, #522's stack of 36 boxes, holds none; this build's audit of each answers the readings
//      `through` and `self_through`.
//   2. Only on a reference Mac at rest (scripts/benchmark.mjs judgeLimit's rule, read for the machine and the load alone, as
//      #524's budget files read it): release builds of this checkout and of the merge base this suite was written on,
//      pinned, so the comparison stays with the audit before #3258 once it lands; one warm-up and five runs, each the wall
//      time of one audit process here over one of the merge base's, the two run one after the other. The lane's own
//      `judgeLimit` holds the banner's ratio to 1.5 and the stack's to 1.05 (no longer, within the lane's smallest margin).
// Off a reference Mac or under load the test is INCONCLUSIVE before anything is built or timed, never PASS.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { mergeBasePhysics, physicsBin, prebuild } from '../191/helpers.ts';
import { stack } from '../522/helpers.ts';
import {
  AC, REPO, TIMEOUT, audit, banner, builtOf, check, inconclusive, load, none, pinned, readOf, show, softWorld, standing, told, zeroFailures, type World,
} from './helpers.ts';

prebuild(['shipped']);
const ID = AC[6];
/** The merge base this suite was written on. */
const BASE = 'b41a1b521b6bae88709338542fb304d95b841312';
const STEPS = 1200;
const RUNS = 5;
const WORLDS: [string, World, number][] = [
  ['the 280-particle banner', { doc: softWorld({ soft: { banner: banner() } }), id: 'banner' }, 1.5],
  ['a world with no soft body, a stack of 36 boxes', { doc: stack(3, 4, 3), id: 'stack' }, 1.05],
];

const dir = mkdtempSync(join(tmpdir(), 'deep-3258-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** One process of `bin` auditing `w` over 10 s: its wall time, ms. */
function timed(bin: string, w: World): number {
  const at = performance.now();
  const run = spawnSync(bin, [], { cwd: REPO, input: `${JSON.stringify(audit(w, STEPS))}\n`, encoding: 'utf8', maxBuffer: 1 << 28, timeout: TIMEOUT / 4, killSignal: 'SIGKILL' });
  const ms = performance.now() - at;
  expect([run.status, (JSON.parse(run.stdout || '{}') as { kind?: string }).kind], `${bin} audits the world: ${(run.stderr ?? '').slice(-500)}`).toEqual([0, 'physics.audit']);
  return ms;
}

describe(`${ID} the audit's time, on the reference Mac against the merge base`, () => {
  it(`${ID} the banner's audit over 10 s takes under 1.5 times the merge base's and a world with no soft body no longer, on a reference Mac at rest`, async () => {
    const start = load();
    const replies = pinned(WORLDS.flatMap(([, w]) => [check(w), audit(w, 12)]));
    const counts = WORLDS.map(([name], i) => { const b = builtOf(replies[2 * i], name); return [b.softBodies, b.particles]; });
    expect(counts, 'the banner is one soft body of 280 particles, and the stack holds none').toEqual([[1, 280], [0, 0]]);
    none(WORLDS.flatMap(([name], i) => { const r = readOf(replies[2 * i + 1], name); console.log(`${name}, 12 steps: ${told(r)}`); return zeroFailures(r, name); }), 'what is timed is the audit that reads what passed through');

    const here = await standing({ start, end: load() });
    if (here.status !== 'PASS') inconclusive(`the budget is judged only on a reference Mac at rest: ${here.reason}`);
    const base = join(dir, 'deep-physics-base');
    const error = mergeBasePhysics(BASE, base);
    if (error !== '') throw Error(`BLOCKED: the merge base's release deep-physics doesn't build: ${error}`);
    const mine = physicsBin('release');
    const { judgeLimit, fingerprint } = (await import(join(REPO, 'scripts', 'benchmark.mjs'))) as { judgeLimit: (o: unknown) => { status: string; reason?: string }; fingerprint: () => unknown };
    const open: string[] = [];
    for (const [name, w, limit] of WORLDS) {
      const ratio = (): number => { const then = timed(base, w); return timed(mine, w) / then; };
      ratio();
      const loads: { start: number; end: number }[] = [];
      const runs = Array.from({ length: RUNS }, () => { const before = load(); const x = ratio(); loads.push({ start: before, end: load() }); return x; });
      const v = judgeLimit({ limit, runs, fingerprint: fingerprint(), loads });
      console.log(`${name}: this build's audit over the merge base's, five runs ${show(runs)} against ${limit}: ${v.status}${v.reason ? ` (${v.reason})` : ''}`);
      expect(v.status, `${name}: ${show(runs)} against ${limit}: ${v.reason ?? ''}`).not.toBe('FAIL');
      if (v.status !== 'PASS') open.push(`${name}: ${v.status} ${v.reason ?? ''}`);
    }
    if (open.length) inconclusive(open.join('; '));
  }, 4 * TIMEOUT);
});
