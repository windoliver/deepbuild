// Criterion 4 (no upstream test): "A recorded 72,000-step, 300-unit match at 30 Hz lands each of 20 seeded seeks
// within 2 s on the reference Mac with keyframes under a 512 MiB cache budget; and a planted ring held to 64 MiB
// misses 2 s, naming the seek"
//
// Through a `deep-logic` session (README: sessions): `open` with this suite's `cache` (a folder and its 512 MiB
// budget), #531's `step` with this suite's `deep_hash`, and this suite's `seek`. `match` (programs.ts) is a 300-unit
// match for two players at 30 Hz on a seeded order track. The session plays the 72,000 steps, reading the
// full-state hash at each seeded seek's step on the way; the cache then holds its keyframes within 512 MiB. Each of
// 20 seeded seeks lands on playing's state, re-running at most 300 steps (10 s of play) from the checkpoint or
// keyframe it restores, and is timed on this test's own clock, from the line written to the reply read. One round
// of the 20 warms up, then five are timed, and each seek's five readings go to the perf lane's rule (helpers.ts:
// judgeLimit): PASS within 2 s, FAIL over it, INCONCLUSIVE off a quiet reference Mac. With
// `keyframes_held_in_ring` the keyframes stay in the item's 64 MiB checkpoint ring, whose spacing doubles past it,
// and a seek far from its checkpoints misses 2 s, named by the same rule.
import { rmSync } from 'node:fs';
import { describe, expect, it, type TestContext } from 'vitest';
import {
  AC, MIB, TIMEOUT, bench, cacheDir, cores, diskUse, entryAt, int, live, load, logicBin, obj, offsetOf, openCall, piece, prebuild, seekCall,
  seeded, show, stepCall, str, type Entry, type Judged, type JsonObject, type Planted,
} from './helpers.ts';
import { UNITS, match } from './programs.ts';

prebuild(() => { logicBin(); match(); });

const ID = 'match';
const RATE = 30;
const STEPS = 72_000;
const LIMIT_MS = 2000;
const CACHE_BUDGET = 512 * MIB;
/** 10 s of play at 30 Hz: the most steps a seek re-runs from a keyframe. */
const BACK = 10 * RATE;
const ROUNDS = 5;
const pieceOf = (): JsonObject => piece({
  seed: 547, controls: ['order'],
  items: { [ID]: { program: match(), stepRate: RATE, reads: ['order'], writes: { score: { type: 'i32', count: 2 } }, budget: { fuel: 10_000_000, memory: 7 } } },
});
/** The match's recorded track: players 1 and 2 each order their units to a seeded cell every 30 to 150 steps. */
function orders(): Entry[] {
  const r = seeded(547_04);
  const out: Entry[] = [];
  for (const player of [1, 2]) {
    for (let k = Math.floor(r() * 30); k < STEPS; k += 30 + Math.floor(r() * 120)) out.push(entryAt('order', k, Math.floor(r() * 1024 * 512), RATE, player));
  }
  return out.sort((a, b) => a.t - b.t || a.player - b.player);
}
/** 20 seeded seeks, each to the state after a step of the 72,000, in a seeded order. */
function targets(): number[] {
  const r = seeded(547_041);
  return Array.from({ length: 20 }, () => Math.floor(r() * STEPS));
}
const deepOf = (reply: JsonObject, what: string): string => {
  expect(reply['ok'], `${what} ran (ok: true): ${show(reply)}`).toBe(true);
  return str(obj(reply['deep_hash'], `${what}.deep_hash (each item's full-state hash)`)[ID], `${what}.deep_hash.${ID}`);
};

interface Run { wrong: string[]; reruns: Map<number, number>; ms: Map<number, number[]>; loads: { start: number; end: number }[]; cache: { bytes: number; files: number } }

/** Plays the recorded match in one session, then seeks: a warm-up round and five timed rounds of the 20 seeks. */
async function play(planted: Planted[]): Promise<Run> {
  const dir = cacheDir();
  const l = live(planted);
  const seeks = targets();
  const run: Run = { wrong: [], reruns: new Map(), ms: new Map(seeks.map((s) => [s, []])), loads: [], cache: { bytes: 0, files: 0 } };
  try {
    const opened = (await l.call(openCall(pieceOf(), orders(), { dir, budget: CACHE_BUDGET }))).reply;
    expect(opened['ok'], `open admits the match: ${show(opened)}`).toBe(true);
    expect(offsetOf(opened, ID, 'reads', 'order'), 'the order control\'s slot is at offset 0 of the read region').toBe(0);
    expect(offsetOf(opened, ID, 'writes', 'score'), 'score is at offset 0 of the write region').toBe(0);
    const session = str(opened['session'], 'open.session');
    // What the base lacks first: a step's full-state hash, on step 0.
    deepOf((await l.call(stepCall(session, 0))).reply, 'step 0');
    const playing = new Map<number, string>();
    for (const k of [...new Set(seeks)].sort((a, b) => a - b)) playing.set(k, deepOf((await l.call(stepCall(session, k))).reply, `step ${k}`));
    deepOf((await l.call(stepCall(session, STEPS - 1))).reply, 'the match\'s last step');
    run.cache = diskUse(dir);
    for (let round = 0; round <= ROUNDS; round++) {
      const start = load();
      for (const k of seeks) {
        const { reply, ms } = await l.call(seekCall(session, k));
        expect(reply['ok'], `the seek to ${k} ran (ok: true): ${show(reply)}`).toBe(true);
        expect(int(reply['to'], `seek ${k}.to`), `the seek to ${k} answers for step ${k}`).toBe(k);
        const from = int(reply['from'], `seek ${k}.from`);
        if (deepOf(reply, `seek to ${k}`) !== playing.get(k)) run.wrong.push(`seek to ${k}: its full-state hash differs from playing's after step ${k}`);
        run.reruns.set(k, k + 1 - from);
        if (round > 0) run.ms.get(k)!.push(ms);
      }
      if (round > 0) run.loads.push({ start, end: load() });
    }
  } finally {
    l.stop();
    rmSync(dir, { recursive: true, force: true });
  }
  return run;
}

/** Each seek's five readings, judged; the seeks that missed 2 s, those the rule can't call, and the readings. */
async function judge(run: Run): Promise<{ failed: number[]; unsure: { seek: number; reason: string }[]; readings: string }> {
  const { fingerprint, judgeLimit } = await bench();
  const machine = fingerprint();
  const failed: number[] = [];
  const unsure: { seek: number; reason: string }[] = [];
  const lines: string[] = [];
  for (const [seek, runs] of run.ms) {
    const j: Judged = judgeLimit({ limit: LIMIT_MS, runs, fingerprint: machine, loads: run.loads });
    if (j.status === 'FAIL') failed.push(seek);
    else if (j.status !== 'PASS') unsure.push({ seek, reason: `${j.status}: ${j.reason ?? ''}` });
    lines.push(`seek to step ${seek} (${(seek / RATE).toFixed(1)} s, re-ran ${run.reruns.get(seek)} steps): ${runs.map((x) => x.toFixed(0)).join(', ')} ms → ${j.status}`);
  }
  const readings = [...lines, `loads per round: ${run.loads.map((x) => `${x.start.toFixed(1)} → ${x.end.toFixed(1)}`).join('; ')} on ${cores()} cores`, `machine: ${JSON.stringify(machine)}`].join('\n  ');
  return { failed, unsure, readings };
}

describe(`${AC[4]} a recorded match keeps a keyframe every 10 s of play in the cache, so a seek re-runs at most 10 s`, () => {
  it(`${AC[4]} a recorded 72,000-step, 300-unit match at 30 Hz lands each of 20 seeded seeks within 2 s with keyframes under a 512 MiB cache budget`, async (ctx: TestContext) => {
    expect(UNITS, 'the match has 300 units').toBe(300);
    const run = await play([]);
    expect(run.cache.files, 'the session spilled its keyframes into the cache folder').toBeGreaterThan(0);
    expect(run.cache.bytes, `the keyframes take ${run.cache.bytes} bytes of the cache, within its 512 MiB budget`).toBeLessThanOrEqual(CACHE_BUDGET);
    expect(run.wrong, 'every seek lands on playing\'s state').toEqual([]);
    const far = [...run.reruns].filter(([, n]) => n > BACK || n < 0).map(([k, n]) => `seek to ${k}: re-ran ${n} steps`);
    expect(far, 'every seek re-runs at most 300 steps (10 s of play) from the checkpoint or keyframe it restores').toEqual([]);
    const { failed, unsure, readings } = await judge(run);
    console.log(`${AC[4]} seeks\n  ${readings}`);
    if (failed.length) expect.fail(`FAIL ${AC[4]}: ${failed.map((s) => `the seek to step ${s}`).join(', ')} missed 2 s in all five runs\n  ${readings}`);
    if (unsure.length) ctx.skip(`INCONCLUSIVE ${AC[4]}, neither a pass nor a fail: ${unsure.length} of 20 seeks can't be called (${unsure[0]!.reason})\n  ${readings}`);
  }, TIMEOUT);

  it(`${AC[4]} a planted ring held to 64 MiB (keyframes_held_in_ring) misses 2 s, naming the seek`, async (ctx: TestContext) => {
    const run = await play(['keyframes_held_in_ring']);
    expect(run.wrong, 'every planted seek still lands on playing\'s state').toEqual([]);
    const { failed, unsure, readings } = await judge(run);
    console.log(`${AC[4]} planted seeks\n  ${readings}`);
    if (failed.length) {
      console.log(`${AC[4]}: the planted ring misses 2 s at ${failed.map((s) => `the seek to step ${s}`).join(', ')}`);
      return;
    }
    if (unsure.length) ctx.skip(`INCONCLUSIVE ${AC[4]}: no planted seek missed 2 s by the rule, and ${unsure.length} can't be called (${unsure[0]!.reason})\n  ${readings}`);
    expect.fail(`the planted ring held to 64 MiB landed every seek within 2 s, so the criterion doesn't catch it\n  ${readings}`);
  }, TIMEOUT);
});
