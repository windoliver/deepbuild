// AC3 #222.f801fafc: "`lag: 0.25` over 8 targets with `span: 1s` ends at 2.75 s within one flick; each `cue.kind@1`
// verb matches its fixture within 1e-6 at 50 random times, and each verb's planted twin fails"
//
// The stagger: one cue over 8 squares, `lag: 0.25`, `span: 1s`, setting each one's y; its marker `cues.wave` and its
// latest key both end at 2.75 s (1 s × ((8 − 1) × 0.25 + 1)) within one flick. Wrong programs: a lag read as a share
// of the whole span (ends at 1 s), as flicks (ends just past 1 s), or applied n times (3 s).
//
// The verbs: each of the 29 first-party verbs (the issue's list less `warp` and `type`, which join with #223 and #168)
// ships a fixture, `packs/verbs-1.0.0/fixtures/<verb>.json` (README: Fixtures): a film whose cue list plays the verb,
// the same film written by hand with no cue list, and the paths to compare. The fixture's paths must hold every path
// the verb's cue writes (its expansion's channels), and the hand-written film must move over the cue's window, so a
// fixture can't pass by comparing nothing. At 50 whole-flick times drawn by a generator seeded with the verb's name
// from the verb's cue's window (its marker `cues.<id>`), `eval` reads every path in both films; each number must
// agree within 1e-6. Wrong programs: any verb whose expansion differs from its stated motion.
//
// The twins: with the scenario's planted program `cue_twin:<verb>` (README: Planted programs) the first-party verb
// expands as its planted twin; the same comparison, at the same times, must find a difference for every verb. A
// fixture that a wrong verb also matches fails here.
import { describe, expect, it } from 'vitest';
import {
  AC, TIMEOUT, VERBS, VERBS_PACK, cueList, differences, docId, errors, evalAt, expansionOf, film, fl, markerOf, none, present, presented,
  randomTimes, run, scenario, showTime, square, twinPlant, useFolders, useShow, valuesOf, verbCue, brief, fixtureOf,
  type Fixture, type JsonObject,
} from './helpers.ts';

const show = useShow();
const folder = useFolders();
const SAMPLES = 50;
const TOLERANCE = 1e-6;

interface Prepared { verb: string; fixture: Fixture; times: number[] }
let prepared: Prepared[] | null = null;
/**
 * Every verb's fixture, presented (the film and its hand-written twin), with its 50 times drawn from the verb's cue's
 * window. Once per file.
 */
function prepare(): Prepared[] {
  if (prepared) return prepared;
  const read = VERBS.map((verb) => ({ verb, f: fixtureOf(verb) }));
  none(read.flatMap(({ f }) => (Array.isArray(f) ? f : [])), 'each first-party verb ships a fixture this suite can read');
  const list = read.map(({ verb, f }) => ({ verb, fixture: f as Fixture }));
  const calls = list.flatMap((p, i) => [present(docId(100 + 2 * i), p.fixture.document, ['issues']), present(docId(101 + 2 * i), p.fixture.reference)]);
  const replies = run(show(), scenario(folder(), calls, { packs: [VERBS_PACK] }));
  const failures: string[] = [];
  const out: Prepared[] = [];
  list.forEach((p, i) => {
    const d = replies[2 * i]!; const r = replies[2 * i + 1]!;
    if (d['outcome'] !== 'presented' || errors(d).length) { failures.push(`${p.verb}: its fixture's film is not presented cleanly: ${brief(d, 600)}`); return; }
    if (r['outcome'] !== 'presented' || errors(r).length) { failures.push(`${p.verb}: its fixture's hand-written film is not presented cleanly: ${brief(r, 600)}`); return; }
    const e = expansionOf(d, `${p.verb}'s fixture`);
    const cue = verbCue(p.fixture.document, p.verb);
    const m = markerOf(e, cue, `${p.verb}'s fixture`);
    for (const c of e.channels.filter((x) => x.cue === cue)) {
      if (!p.fixture.paths.includes(c.target)) failures.push(`${p.verb}: its cue writes ${c.target}, which its fixture doesn't compare`);
    }
    if (m.span <= 0) failures.push(`${p.verb}: its cue's window is empty`);
    out.push({ ...p, times: randomTimes(p.verb, SAMPLES, m.t, m.t + m.span) });
  });
  none(failures, 'every fixture presents, and compares every path its verb writes');
  prepared = out;
  return out;
}

/** The fixture comparison of one verb in a run: the film against its hand-written twin at its 50 times. */
function compare(p: Prepared, replies: JsonObject[], at: number): { differ: string[]; moves: boolean } {
  const differ: string[] = [];
  const seen = new Map<string, string>();
  let moves = false;
  p.times.forEach((t, k) => {
    const d = valuesOf(replies[at + 2 * k]!, `${p.verb}'s film at ${showTime(t)}`);
    const r = valuesOf(replies[at + 2 * k + 1]!, `${p.verb}'s hand-written film at ${showTime(t)}`);
    for (const path of p.fixture.paths) {
      differ.push(...differences(d[path], r[path], TOLERANCE, `${p.verb}: ${path} at ${showTime(t)}`));
      const text = JSON.stringify(r[path] ?? null);
      if (seen.has(path) && seen.get(path) !== text) moves = true;
      seen.set(path, text);
    }
  });
  return { differ, moves };
}
/** The calls that read each verb's two films at its times, after presenting them. */
function readCalls(list: readonly Prepared[], first: number): { calls: JsonObject[]; at: number[] } {
  const calls: JsonObject[] = []; const at: number[] = [];
  list.forEach((p, i) => { calls.push(present(docId(first + 2 * i), p.fixture.document), present(docId(first + 2 * i + 1), p.fixture.reference)); });
  list.forEach((p, i) => {
    at.push(calls.length);
    for (const t of p.times) calls.push(evalAt(docId(first + 2 * i), t, { paths: p.fixture.paths }), evalAt(docId(first + 2 * i + 1), t, { paths: p.fixture.paths }));
  });
  return { calls, at };
}

describe(`${AC[3]} staggered cues end on time, every verb matches its fixture, and every verb's planted twin fails it`, () => {
  it(`${AC[3]} lag 0.25 over 8 targets with span 1s ends at 2.75 s within one flick, and each cue.kind@1 verb matches its fixture within 1e-6 at 50 random times`, () => {
    const targets = Array.from({ length: 8 }, (_, i) => `t${i}`);
    const wave = film('Eight squares staggered', [...targets.map((id, i) => square(id, [-200 + 50 * i, 0])), cueList([{ id: 'wave', targets, lag: 0.25, span: '1s', set: { 'at/pos/1': 100 } }])], { span: 4 });
    const [shown] = run(show(), scenario(folder(), [present(docId(1), wave)]));
    presented(shown!, 'the staggered cue');
    const e = expansionOf(shown!, 'the staggered cue');
    const m = markerOf(e, 'wave', 'the staggered cue');
    const END = fl(2.75);
    expect(Math.abs(m.t + m.span - END) <= 1, `the staggered cue's marker ends at 2.75 s within one flick, got ${showTime(m.t + m.span)}`).toBe(true);
    const last = Math.max(...e.channels.flatMap((c) => c.times));
    expect(Math.abs(last - END) <= 1, `the staggered cue's last key lies at 2.75 s within one flick, got ${showTime(last)}`).toBe(true);

    const list = prepare();
    const { calls, at } = readCalls(list, 300);
    const replies = run(show(), scenario(folder(), calls, { packs: [VERBS_PACK] }));
    list.forEach((p, i) => { presented(replies[2 * i]!, `${p.verb}'s fixture film`); presented(replies[2 * i + 1]!, `${p.verb}'s hand-written film`); });
    const failures: string[] = [];
    list.forEach((p, i) => {
      const { differ, moves } = compare(p, replies, at[i]!);
      failures.push(...differ.slice(0, 5));
      if (!moves) failures.push(`${p.verb}: its hand-written film doesn't change over the cue's window at the 50 times, so the fixture shows no motion`);
    });
    none(failures, `each verb matches its fixture within ${TOLERANCE} at ${SAMPLES} random times`);
  }, TIMEOUT);

  it(`${AC[3]} each verb's planted twin fails its fixture`, () => {
    const list = prepare();
    const passed: string[] = [];
    for (const p of list) {
      const { calls, at } = readCalls([p], 500);
      const replies = run(show(), scenario(folder(), calls, { packs: [VERBS_PACK], planted: twinPlant(p.verb) }));
      presented(replies[0]!, `${p.verb}'s fixture film under its planted twin`);
      presented(replies[1]!, `${p.verb}'s hand-written film`);
      if (compare(p, replies, at[0]!).differ.length === 0) passed.push(`${p.verb}: its planted twin matches the fixture at all ${SAMPLES} times`);
    }
    none(passed, 'every verb\'s planted twin fails its fixture');
  }, TIMEOUT);
});
