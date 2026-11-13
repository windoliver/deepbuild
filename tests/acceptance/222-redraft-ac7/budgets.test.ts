// AC7 #222.21cc8a35, redrafted: "Budgets, on the reference Mac in the local preflight: 512 cues expand in under 10 ms at
// check, and a cue list costs nothing per frame beyond the channels it writes"
//
// Supersedes the AC7 test of ../222/budgets.test.ts (README: The dispute). The films are that test's, unchanged: 8
// squares and a cue list of 512 cues in 64 groups of 8, each group one cue per square (the first `after`, the rest
// `with`), each setting its square's x over 0.25 s; and its twin, the same squares and the same motion written by hand,
// one channel per square keyed at every group's start.
//
// Nothing per frame. Each film runs in its own fresh debug process (no cache crosses processes), so neither film loads
// first and neither's check or frames can turn the other's nodes into hits: `deep show`, then `eval` at 1.03 s, 1.07 s
// and 1.27 s. A frame's work is the nodes of its `eval` reply outside the check's phases (the design's closed list: load,
// expand, resolve, validate, plan, build, estimate, check) whose `run` isn't `kept`: the nodes that frame visited and had
// to run or look up. Check-phase nodes are left out, since a reply lists them as the revision's check had them, whatever
// the frame did. Judged at 1.07 s (inside group 4's cues, after a frame at 1.03 s) and at 1.27 s (the frame that enters
// group 5's cues), each against the hand film's same frame:
//
// 1. Each square has work in both films' frame. Wrong program: a cue list that moves nothing in the frame (the base,
//    where the `cues@1` item is skipped), which would leave 2 and 3 nothing to judge.
// 2. No node of the cue list's own item does work. Wrong program: an expander or a cue reader that is an operator on
//    the cue list's item in a frame phase.
// 3. The cue film's work, as `operator | item` with repeats, lies within the hand film's. Wrong program: a document node,
//    or a node per cue or per expanded channel, that reads the cues each frame (or only in a frame that enters a new
//    cue); or the channels the cue list wrote evaluated by an operator of their own beside or instead of motion's.
//
// Under 10 ms: as the superseded test judged it, unchanged. The expander's own wall time at check,
// `timing.expand_ms.list` on `deep show` with `include: ["timing"]`, its expansion holding all 512 markers. The perf
// lane's judgeLimit (scripts/benchmark.mjs) first says whether this machine can judge a timing now (a reference Mac,
// Low Power Mode off, thermal state nominal, the load under the core count); if not, the timing is INCONCLUSIVE before
// anything is built in release. If so: a release build, one warm-up process, then five fresh processes, each reading it
// once; judgeLimit over the five must not FAIL, and anything but PASS is INCONCLUSIVE, never a pass. Wrong program: an
// expander slower than 10 ms on 512 cues.
import { describe, expect, it } from 'vitest';
import {
  AC, LIST, TIMEOUT, arr, brief, buildInto, channel, cueList, docId, evalAt, expansionOf, film, fl, inconclusive, judgeLimit, load, none, num,
  obj, present, presented, run, scenario, square, useFolders, useShow, type JsonObject,
} from '../222/helpers.ts';

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

/** The frames each film's process evaluates, in order; every one after the first is judged. */
const FRAMES = [1.03, 1.07, 1.27];
/** The design's check phases (Canvas modules: "a check runs load, expand, resolve, validate, plan, build, estimate and check"). */
const CHECK_PHASES = ['load', 'expand', 'resolve', 'validate', 'plan', 'build', 'estimate', 'check'];

interface Work { operator: string; item: string }
const named = (w: Work): string => `${w.operator} | ${w.item}`;

/** A frame's work: its nodes outside the check phases that the frame ran or looked up (`run` not `kept`). */
function workOf(reply: JsonObject, what: string): Work[] {
  expect(reply['outcome'], `${what} is evaluated: ${brief(reply, 600)}`).toBe('evaluated');
  return arr(reply['nodes'], `${what}: nodes`).map((n, i) => obj(n, `${what}: nodes[${i}]`))
    .filter((n) => !(typeof n['phase'] === 'string' && CHECK_PHASES.includes(n['phase'])) && n['run'] !== 'kept')
    .map((n) => ({ operator: String(n['operator']), item: n['item'] === null || n['item'] === undefined ? '' : String(n['item']) }));
}

/** One fresh debug process: the film presented, then its frames; each frame's work after the first. */
function framesOf(document: JsonObject, what: string): Work[][] {
  const [shown, ...frames] = run(show(), scenario(folder(), [present(docId(1), document), ...FRAMES.map((s) => evalAt(docId(1), fl(s)))]));
  presented(shown!, what);
  return frames.map((f, k) => workOf(f, `${what} at ${FRAMES[k]} s`)).slice(1);
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
  it(`${AC[7]} a cue list costs nothing per frame beyond the channels it writes: each frame after the first runs only what the same channels written by hand run, whichever film loads first`, () => {
    expect(cues.length, 'the film holds 512 cues').toBe(512);
    const mine = framesOf(cued, 'the 512-cue film');
    const theirs = framesOf(byHand, 'the same motion written as channels');
    FRAMES.slice(1).forEach((s, k) => {
      const a = mine[k]!;
      const b = theirs[k]!;
      // 1. The frame moves every square in both films, so 2 and 3 judge a frame that did something.
      const idle: string[] = [];
      for (const id of ids) {
        if (!b.some((w) => w.item === id)) idle.push(`the hand film: nothing of ${id} ran at ${s} s, so the reference moves it nowhere`);
        if (!a.some((w) => w.item === id)) idle.push(`the cue film: nothing of ${id} ran at ${s} s, so the cue list doesn't move it in that frame`);
      }
      none(idle, `at ${s} s, every square is moved in the frame, by the cue list and by the hand-written channels`);
      // 2. Nothing of the cue list's own item works in a frame.
      none(a.filter((w) => w.item === LIST).map((w) => `${named(w)}: a node of the cue list ran in the frame`),
        `at ${s} s, the cue list's own item does no work per frame`);
      // 3. Everything else the frame did, the hand film's same frame did too, node for node.
      const pool = b.map(named);
      const extra: string[] = [];
      for (const w of a.filter((x) => x.item !== LIST)) {
        const at = pool.indexOf(named(w));
        if (at < 0) extra.push(`${named(w)}: ran in the cue film's frame, with no match in the hand-written channels' frame`);
        else pool.splice(at, 1);
      }
      none(extra, `at ${s} s, per frame the cue list's film runs only what the same channels written by hand run`);
    });
  }, TIMEOUT);

  it(`${AC[7]} 512 cues expand in under ${LIMIT_MS} ms at check on the reference Mac`, async () => {
    const now = Array.from({ length: RUNS }, () => ({ start: load(), end: load() }));
    const here = await judgeLimit(LIMIT_MS, Array.from({ length: RUNS }, () => 0), now);
    if (here['status'] !== 'PASS') inconclusive(`the timing: this machine can't judge it now: ${String(here['reason'])}`);
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
    if (verdict['status'] !== 'PASS') inconclusive(`the timing: ${JSON.stringify(verdict)}`);
  }, 4 * TIMEOUT);
});
