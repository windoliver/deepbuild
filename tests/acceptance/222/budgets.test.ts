// AC7 #222.21cc8a35: "Budgets, on the reference Mac in the local preflight: 512 cues expand in under 10 ms at check,
// and a cue list costs nothing per frame beyond the channels it writes"
//
// The film: 8 squares and a cue list of 512 cues in 64 groups of 8, each group one cue per square (the first `after`,
// the rest `with`), each setting its square's x over 0.25 s, so no two cues write one path at once. Its twin holds the
// same squares and the same motion written by hand: one channel per square, keyed at every group's start.
//
// Nothing per frame: one debug process presents both and evaluates each at 1.03 s and then 1.07 s (README: Readings,
// `nodes`). At the second frame, every node that ran (`run: "ran"`) in the cue list's film has its match, by operator
// and item, among the nodes that ran in the hand-written film, none is the cue list's own, and each square has a node
// that ran (the frame moves them all, so the comparison isn't empty). Wrong program: an expander or a cue reader that
// runs each frame (a node of the cue list's item, or one more node per frame).
//
// Under 10 ms: the expander's own wall time at check, `timing.expand_ms.list` on `deep show` with `include:
// ["timing"]` (README: The expansion), its expansion holding all 512 markers. The perf lane's judgeLimit
// (scripts/benchmark.mjs) first says whether this machine can judge a timing now (a reference Mac, Low Power Mode off,
// thermal state nominal, the load under the core count); if not, the timing is INCONCLUSIVE before anything is built
// in release. If so: a release build, one warm-up process, then five fresh processes, each reading it once; judgeLimit
// over the five must not FAIL, and anything but PASS is INCONCLUSIVE, never a pass.
import { describe, expect, it } from 'vitest';
import {
  AC, LIST, TIMEOUT, brief, buildInto, cueList, docId, evalAt, expansionOf, film, fl, inconclusive, isObject, judgeLimit, load, none, num, obj,
  present, presented, run, scenario, square, useFolders, useShow, channel, type JsonObject,
} from './helpers.ts';

const show = useShow();
const folder = useFolders();
const LIMIT_MS = 10;
const RUNS = 5;
const SQUARES = 8;
const GROUPS = 64;

const ids = Array.from({ length: SQUARES }, (_, i) => `s${i}`);
const squares = ids.map((id, i) => square(id, [0, 40 * i]));
const cues: JsonObject[] = Array.from({ length: GROUPS }, (_, g) => ids.map((id, i): JsonObject => ({
  id: `g${g}${id}`, ...(i === 0 ? {} : { when: 'with' }), targets: [id], span: '0.25s', set: { 'at/pos/0': 10 * (g + 1) },
}))).flat();
const cued = film('512 cues', [...squares, cueList(cues)], { span: 17 });
const byHand = film('512 cues written by hand', squares, {
  span: 17,
  extra: { channels: Object.fromEntries(ids.map((id) => [`x_${id}`, channel(`items/${id}/at/pos/0`, 'f32', Array.from({ length: GROUPS + 1 }, (_, g) => [0.25 * g, 10 * g] as [number, number]))])) },
});

/** The nodes that ran in an `eval` reply, as `operator | item`. */
function ran(reply: JsonObject, what: string): string[] {
  expect(reply['outcome'], `${what} is evaluated: ${brief(reply, 600)}`).toBe('evaluated');
  return (Array.isArray(reply['nodes']) ? reply['nodes'] : []).filter(isObject).filter((n) => n['run'] === 'ran').map((n) => `${String(n['operator'])} | ${String(n['item'] ?? '')}`);
}

/** One fresh process presenting the cue list's film: the expander's own time, after checking it expanded all 512. */
function timedRun(bin: string): number {
  const [shown] = run(bin, scenario(folder(), [present(docId(1), cued, ['issues', 'timing'])]));
  presented(shown!, 'the 512-cue film');
  expect(Object.keys(expansionOf(shown!, 'the 512-cue film').markers).length, 'the expansion writes one marker per cue, 512').toBe(cues.length);
  const timing = obj(shown!['timing'], 'the deep show reply\'s timing');
  return num(obj(timing['expand_ms'], 'timing.expand_ms')[LIST], `timing.expand_ms.${LIST}, the expander's own time on the cue list`);
}

describe(`${AC[7]} a cue list costs its time at check and nothing per frame`, () => {
  it(`${AC[7]} 512 cues expand in under ${LIMIT_MS} ms at check on the reference Mac, and a cue list costs nothing per frame beyond the channels it writes`, async () => {
    expect(cues.length, 'the film holds 512 cues').toBe(512);
    const [a, b, a1, a2, b1, b2] = run(show(), scenario(folder(), [
      present(docId(1), cued), present(docId(2), byHand),
      evalAt(docId(1), fl(1.03)), evalAt(docId(1), fl(1.07)), evalAt(docId(2), fl(1.03)), evalAt(docId(2), fl(1.07)),
    ]));
    presented(a!, 'the 512-cue film');
    presented(b!, 'the same motion written as channels');
    expect(a1 && b1, 'both films evaluate a first frame').toBeTruthy();
    const mine = ran(a2!, 'the 512-cue film at 1.07 s');
    const theirs = ran(b2!, 'the hand-written film at 1.07 s');
    const extra: string[] = [];
    for (const id of ids) if (!mine.some((n) => n.endsWith(`| ${id}`))) extra.push(`nothing of ${id} ran at 1.07 s: the cue list doesn't move it in that frame`);
    const pool = [...theirs];
    for (const n of mine) {
      const k = pool.indexOf(n);
      if (n.endsWith(`| ${LIST}`)) extra.push(`${n}: a node of the cue list ran in a frame`);
      else if (k < 0) extra.push(`${n}: ran in the cue list's frame, with no match in the hand-written channels' frame`);
      else pool.splice(k, 1);
    }
    none(extra, 'per frame, the cue list\'s film runs only what the same channels written by hand run');

    const open: string[] = [];
    const now = Array.from({ length: RUNS }, () => ({ start: load(), end: load() }));
    const here = await judgeLimit(LIMIT_MS, Array.from({ length: RUNS }, () => 0), now);
    if (here['status'] !== 'PASS') open.push(`the timing: this machine can't judge it now: ${String(here['reason'])}`);
    else {
      const built = buildInto(true, folder());
      expect(built.error, 'deep-show builds in release').toBe('');
      timedRun(built.bin);
      const runs: number[] = [];
      const loads: { start: number; end: number }[] = [];
      for (let k = 0; k < RUNS; k++) {
        const start = load();
        runs.push(timedRun(built.bin));
        loads.push({ start, end: load() });
      }
      const verdict = await judgeLimit(LIMIT_MS, runs, loads);
      console.log(`#222 512 cues, expand_ms per run: ${runs.map((r) => r.toFixed(3)).join(', ')} → ${String(verdict['status'])}`);
      expect(verdict['status'], `the expansion's time against ${LIMIT_MS} ms: ${JSON.stringify(verdict)}`).not.toBe('FAIL');
      if (verdict['status'] !== 'PASS') open.push(`the timing: ${JSON.stringify(verdict)}`);
    }
    if (open.length) inconclusive(open.join('; '));
  }, 4 * TIMEOUT);
});
