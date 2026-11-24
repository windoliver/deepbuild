// #3220 AC3: a check's key has three clean runs that peaked near 600 MB; with the test's `mem` pool at 2,000 units,
// three runs of that key start together, each holding about 600, and a fourth waits, its line naming memory and the
// holders, and starts within 5 s of one ending; a planted admission that reads the class's constant of 1 GB starts two
// and fails, and one that reads nothing starts four and fails.
//
// In the sample repo, whose spec check `alloc` holds 480 MiB for 20 s and declares no memory, one session after another
// claims in worktree w1, three times: the key's three clean runs. Then four sessions, in w2 … w5, each change NOTES.md
// (which the check doesn't read) and stop together: four claims, four runs of the same key, since a run that reads
// nothing but its check's own files never carries (#1018). When each run held its memory is the fixture's own `S`
// and `E` lines in its stdout; what it was admitted on, its run.started's needs.memory_mb; what it holds, its `mem`
// lease's units (#3218); a check run's waiting line is a line on the hub's stderr (README, Seams).
import { basename } from 'node:path';
import { afterAll, describe, expect, it, type TestContext } from 'vitest';
import {
  AC3, claimed, claimOf, claimOnce, cleanup, heldSpan, Inconclusive, loaded, maxOverlap, mustFail, peakOf, PLANTS, ready, runsIn, sampleFiles, shownRun,
  verdict, World, type Held, type RunRead,
} from './helpers.ts';

afterAll(cleanup, 120_000);

const CHECK = 'alloc';
const POOL = 2000;
const WITHIN_MS = 5000;
const notes = (n: number): string => `# notes\n\n- first\n- round ${n}\n`;

interface Later { r: RunRead; span: Held; holderNames: string[] }
interface Reading { history: RunRead[]; later: Later[]; stderr: string }
async function scenario(plant?: string): Promise<Reading> {
  const w = new World({ files: sampleFiles([{ name: CHECK, mib: 480, holdMs: 20_000 }]), worktrees: 5, memMb: POOL, ...(plant ? { plant } : {}) });
  await w.startHub();
  try {
    const history: RunRead[] = [];
    for (let n = 1; n <= 3; n++) {
      const { claim, events } = await claimOnce(w, w.worktrees[0]!, notes(n), [CHECK]);
      const runs = runsIn(events).filter((r) => r.claim === claim && r.check === CHECK);
      if (runs.length !== 1 || runs[0]!.outcome !== 'passed') throw Error(`BLOCKED: history claim ${n} must run ${CHECK} once and pass (a clean run): ${runs.map(shownRun).join('; ') || 'no run'}`);
      history.push(runs[0]!);
    }
    const ks = [];
    for (const [i, tree] of w.worktrees.slice(1).entries()) ks.push(await ready(w, tree, notes(10 + i)));
    await Promise.all(ks.map((k) => k.s.stop()));
    const events = await claimed(w, ks, [CHECK]);
    const later: Later[] = [];
    for (const k of ks) {
      const claim = claimOf(events, k);
      const runs = runsIn(events).filter((r) => r.claim === claim && r.check === CHECK);
      if (runs.length !== 1 || !runs[0]!.finished) throw Error(`BLOCKED: the claim in ${k.tree} must run ${CHECK} once, to its end: ${runs.map(shownRun).join('; ') || 'no run'}`);
      const made = events.find((e) => e.kind === 'claim.made' && `claim:${e.id}` === claim)!;
      const session = String(made.session ?? k.s.id);
      // A holder may be named by its run, its session (the lease holder `session:<letters>`) or its worktree's folder.
      const holderNames = [runs[0]!.run, session.replace(/[^0-9A-Za-z]/g, ''), basename(k.tree)];
      later.push({ r: runs[0]!, span: await heldSpan(w, runs[0]!.run), holderNames });
    }
    return { history, later: later.sort((a, b) => a.span.s - b.span.s), stderr: w.hub!.stderr() };
  } finally {
    await w.stopHub();
  }
}

const named = (line: string, names: string[]): boolean => names.some((n) => (/^w\d+$/.test(n) ? new RegExp(`\\b${n}\\b`).test(line) : line.includes(n)));
/**
 * AC3: the key's three clean runs recorded peaks near 600 MB; the four later runs are on that key, each admitted on about
 * 600 and holding it; three held their memory together and the fourth only after one of them ended, within 5 s of it,
 * and while it waited the hub's line named memory and the three holders.
 */
function threeThenFourth(x: Reading): void {
  const key = x.history[0]!.key;
  expect(key, `the history's first run must name its key (#1018): ${shownRun(x.history[0]!)}`).toBeTypeOf('string');
  const peaks = x.history.map((r) => {
    const p = peakOf(r);
    expect(p, `key ${key}: each of its three clean runs must record its peak on its end (used.memory_peak_mb): ${shownRun(r)}`).toBeTypeOf('number');
    expect(p! >= 500 && p! <= 700, `key ${key}: ${r.run} held 480 MiB in a Node test run, so its peak must be near 600 MB (500 to 700): ${shownRun(r)}`).toBe(true);
    expect(r.key, `the history's runs must all be on one key: ${shownRun(r)}`).toBe(key);
    return p!;
  });
  const all = [...peaks, ...x.later.flatMap(({ r }) => (typeof peakOf(r) === 'number' ? [peakOf(r)!] : []))];
  const lo = Math.min(...peaks) * 0.95;
  const hi = Math.max(...all) * 1.05 + 1;
  for (const { r } of x.later) {
    expect(r.key, `each later run must be on the key its three clean runs are on, ${key}: ${shownRun(r)}`).toBe(key);
    expect(r.needs, `key ${key} had three clean runs peaking at ${peaks.join(', ')} MB: ${r.run} must be admitted on about 600, their 95th percentile (run.started's needs.memory_mb ${lo.toFixed(0)} to ${hi.toFixed(0)}): ${shownRun(r)}`).toBeTypeOf('number');
    expect(r.needs! >= lo && r.needs! <= hi, `key ${key} had three clean runs peaking at ${peaks.join(', ')} MB: ${r.run} must be admitted on about 600, their 95th percentile (${lo.toFixed(0)} to ${hi.toFixed(0)}), not ${r.needs}: ${shownRun(r)}`).toBe(true);
    // Units are whole MB; an admission with a fraction holds it rounded either way.
    expect(typeof r.units === 'number' && Math.abs(r.units - r.needs!) <= 1, `${r.run} must hold its admission as units of the \`mem\` pool, ${r.needs} (a lease.acquired on mem with units): it holds ${r.units ?? 'none'}: ${shownRun(r)}`).toBe(true);
  }
  const spans = x.later.map((l) => l.span);
  const firstEnd = Math.min(...spans.slice(0, 3).map((s) => s.e));
  const shown = x.later.map((l) => `${l.r.run} held ${l.span.s}..${l.span.e}`).join('; ');
  expect(spans.slice(0, 3).every((s) => s.s < firstEnd), `with ${POOL} MB of \`mem\`, three runs of about 600 must start together, each before any of them ends: ${shown}`).toBe(true);
  expect(spans[3]!.s >= firstEnd, `the fourth run, ${x.later[3]!.r.run}, must wait until one of the three ends: ${shown}`).toBe(true);
  expect(maxOverlap(spans), `no more than three runs of about 600 may hold memory at once in ${POOL} MB: ${shown}`).toBe(3);
  const holders = x.later.slice(0, 3);
  const line = x.stderr.split('\n').find((l) => /memory/i.test(l) && holders.every((h) => named(l, h.holderNames)));
  expect(line, `while ${x.later[3]!.r.run} waited, its line on the hub's stderr must name memory and each of the three holders (${holders.map((h) => h.holderNames.join(' or ')).join('; ')}): the hub's stderr ends ${JSON.stringify(x.stderr.slice(-1500))}`).toBeDefined();
  const after = spans[3]!.s - firstEnd;
  if (after > WITHIN_MS) {
    const load = loaded();
    if (load) throw new Inconclusive(`the fourth run started ${after} ms after the first of the three ended, over ${WITHIN_MS} ms, while the ${load}`);
  }
  expect(after, `the fourth run, ${x.later[3]!.r.run}, must start within ${WITHIN_MS} ms of one of the three ending: ${shown}`).toBeLessThanOrEqual(WITHIN_MS);
}

describe(`${AC3} a check's run on a key with three clean runs is admitted on their peaks`, () => {
  it(`${AC3} with ${POOL} MB of mem, three runs of a key that peaked near 600 MB start together and a fourth waits, naming memory and the holders, and starts within 5 s of one ending`, async (ctx: TestContext) => {
    const x = await scenario();
    await verdict(ctx, () => threeThenFourth(x));
  }, 3_600_000);

  it(`${AC3} (wrong program ${PLANTS.classConstant}) an admission on the class's constant of 1 GB starts two and fails`, async () => {
    const x = await scenario(PLANTS.classConstant);
    expect(maxOverlap(x.later.map((l) => l.span)), `${PLANTS.classConstant}: the planted admission of 1 GB a run must start two at once in ${POOL} MB: ${x.later.map((l) => shownRun(l.r)).join('; ')}`).toBe(2);
    await mustFail(`${PLANTS.classConstant} on AC3`, () => threeThenFourth(x));
  }, 3_600_000);

  it(`${AC3} (wrong program ${PLANTS.readsNothing}) an admission that reads nothing starts four and fails`, async () => {
    const x = await scenario(PLANTS.readsNothing);
    expect(maxOverlap(x.later.map((l) => l.span)), `${PLANTS.readsNothing}: the planted admission, reading no number, must start all four at once: ${x.later.map((l) => shownRun(l.r)).join('; ')}`).toBe(4);
    await mustFail(`${PLANTS.readsNothing} on AC3`, () => threeThenFourth(x));
  }, 3_600_000);
});
