// Criterion 2 (no upstream test): "On that game a track of 40 moves over 10 minutes gives the same full-state hashes at
// each checkpoint, one every 60 steps that ran, and the same arrays, played straight and seeked to each of 20 times; an
// AI that writes due = k + 1 while its turn is unfinished runs on consecutive steps until it writes turn_done = 1, and
// then runs no step until the next entry; and a planted module that ignores due leaves turn_done at 0, failing on that
// array and naming the step that should have run"
//
// Through `deep-logic bake` (step records, `checkpoints`, `seeks` and `restores`) and a live `view` (`play`, `seek`,
// `draws`, `deep_hash`) (README: deep-logic). "That game" is criterion 1's turn game (programs.ts) at 60 Hz with
// `clock: on_input` and `due: "due"`; the 40 moves (programs.ts `fortyMoves`) fall near every 15 s, the last at 600 s.
// A move read at step m starts the AI's turn of W = 8 + (m mod 8) steps, so the clock runs steps m to m + W, with
// `due` = k + 1 and `turn_done` = 0 until step m + W writes `turn_done` = 1 and `due` = 0. A checkpoint comes after
// every 60th step that ran, at the step after it. The 20 times are on a 1/240 s grid: ten a quarter-step past the third
// step of a seeded AI turn, ten seeded, all before the last checkpoint; a bake's seek to time t is `to`: ⌊t × 60⌋ + 1.
// `turn_ignores_due` runs only step 0 and the steps an entry or a reading calls for.
import { describe, expect, it } from 'vitest';
import {
  AC, EVERY, TIMEOUT, bakeCall, bakeOf, drawn, failsNaming, firstDiff, fmt, live, logic, logicBin, none, openView, piece, prebuild, ranSteps, rows, secs, seeded, shuffled,
  type Bake, type JsonObject, type JsonValue, type Planted,
} from './helpers.ts';
import { CONTROLS, TURN_WRITES, fortyMoves, stepAtOrAfter, turnItem, work } from './programs.ts';

prebuild(() => { logicBin(); });

const ID = 'turn';
const SEED = 545_02;
const MOVES = fortyMoves();
/** Steps 0 to 36,059: past 600 s, so the last AI turn ends inside the bake. */
const STEPS = 36_060;
const TURNS = MOVES.map((e) => { const m = stepAtOrAfter(e.t); return { m, w: work(m) }; });
/** The steps the turn clock runs: step 0, then each move's step and its AI turn. */
const RUN = [0, ...TURNS.flatMap(({ m, w }) => Array.from({ length: w + 1 }, (_, j) => m + j))];
const RAN = new Set(RUN);
/** The first checkpoint, then one after every 60th step that ran, at the step after it. */
const CHECKPOINTS = [0, ...RUN.filter((_, i) => (i + 1) % EVERY === 0).map((s) => s + 1)];
const LAST_CP = CHECKPOINTS[CHECKPOINTS.length - 1]!;
/** The 20 times, in 1/240 s (2,940,000 flicks each). */
const QUARTER = 2_940_000;
const TIMES: number[] = (() => {
  const inTurns = shuffled(TURNS.filter(({ m }) => m + 4 < LAST_CP), 545_21).slice(0, 10).map(({ m }) => 4 * (m + 3) + 1);
  const r = seeded(545_22);
  const out = new Set(inTurns);
  while (out.size < 20) out.add(1 + Math.floor(r() * (4 * (LAST_CP - 2))));
  return [...out].sort((a, b) => a - b);
})();
/** A bake's seek to a time: the state after the last step at or before it. */
const seekTo = (u: number): number => Math.floor(u / 4) + 1;

const game = (): JsonObject => piece({ seed: SEED, controls: CONTROLS, items: { [ID]: turnItem('on_input') } });
const one = (v: unknown): string => JSON.stringify(v);

/** The criterion's rules over a straight bake, each failure naming its array and step. */
function judgeTurns(b: Bake): string[] {
  const failures: string[] = [];
  const ran = ranSteps(b.steps, ID);
  const byStep = new Map(ran.map((s) => [s.step, s]));
  const v = (step: number, name: string): JsonValue | undefined => byStep.get(step)?.arrays[`${ID}.${name}`]?.[0];
  TURNS.forEach(({ m, w }, i) => {
    if (!byStep.has(m)) { failures.push(`move ${i + 1} at ${secs(MOVES[i]!.t)}: step ${fmt(m)}, the first step at or after it, didn't run`); return; }
    const next = TURNS[i + 1]?.m ?? STEPS;
    for (let j = 1; j <= w; j++) {
      if (byStep.has(m + j)) continue;
      const last = ran.filter((s) => s.step >= m && s.step < next).pop()!;
      failures.push(`${ID}.turn_done stays ${one(v(last.step, 'turn_done'))} after the move at step ${fmt(m)}: step ${fmt(m + j)}, which ${ID}.due named, should have run`);
      break;
    }
    for (let j = 0; j <= w && byStep.has(m + j); j++) {
      const done = j === w ? 1 : 0;
      const due = j === w ? 0 : m + j + 1;
      if (v(m + j, 'turn_done') !== done) failures.push(`step ${fmt(m + j)}: ${ID}.turn_done is ${one(v(m + j, 'turn_done'))}, not ${done}`);
      if (v(m + j, 'due') !== due) failures.push(`step ${fmt(m + j)}: ${ID}.due is ${one(v(m + j, 'due'))}, not ${due}`);
    }
  });
  const extra = ran.filter((s) => !RAN.has(s.step));
  if (extra.length) failures.push(`steps ran that no entry, reading or due called for: ${extra.slice(0, 8).map((s) => fmt(s.step)).join(', ')}`);
  const cps = (b.checkpoints[ID] ?? []).map((c) => c.step);
  if (one(cps) !== one(CHECKPOINTS)) failures.push(`the checkpoints are at steps ${cps.map(fmt).join(', ')}, not one every 60 steps that ran: ${CHECKPOINTS.map(fmt).join(', ')}`);
  return failures;
}

function straight(planted: Planted[] = []): Bake {
  const [reply] = logic([bakeCall(game(), { track: MOVES, steps: STEPS })], planted);
  return bakeOf(reply!, `the straight bake of the 40 moves${planted.length ? ` with ${planted.join(', ')}` : ''}`);
}

describe(`${AC[2]} 40 moves over 10 minutes on the turn clock: due runs the AI's turn, and seeking equals playing`, () => {
  it(`${AC[2]} the AI runs on consecutive steps while it writes due = k + 1, until turn_done = 1, then none until the next entry; checkpoints come every 60 steps that ran, and seeks to 20 times and restores from each checkpoint give playing's full-state hashes and arrays`, () => {
    expect(new Set(TURNS.map(({ m }) => m)).size, 'the 40 moves fall on 40 steps').toBe(40);
    expect(TIMES.length, '20 times').toBe(20);
    const [straightReply, forkReply] = logic([
      bakeCall(game(), { track: MOVES, steps: STEPS }),
      bakeCall(game(), { track: MOVES, steps: STEPS, seeks: TIMES.map((u) => ({ to: seekTo(u) })), restores: CHECKPOINTS.slice(0, -1).map((c) => ({ from: c, steps: STEPS - c })) }),
    ]);
    const b = bakeOf(straightReply!, 'the straight bake');
    none(judgeTurns(b), 'the turn clock over the 40 moves');
    const f = bakeOf(forkReply!, 'the bake with seeks and restores');
    const failures: string[] = [];
    const cps = b.checkpoints[ID] ?? [];
    const ran = ranSteps(b.steps, ID);
    f.seeks.forEach((s, i) => {
      const at = `the seek to ${secs(TIMES[i]! * QUARTER)} (to step ${fmt(seekTo(TIMES[i]!))})`;
      const next = cps.find((c) => c.step > seekTo(TIMES[i]!));
      if (!next) { failures.push(`${at}: the straight bake has no checkpoint after it`); return; }
      if (s.checkpoint.step !== next.step || s.checkpoint.deep_hash[ID] !== next.deep_hash) failures.push(`${at}: checkpoint ${fmt(s.checkpoint.step)} full-state hash ${s.checkpoint.deep_hash[ID]}, playing's checkpoint ${fmt(next.step)} ${next.deep_hash}`);
      const want = ran.filter((r) => r.step >= seekTo(TIMES[i]!) && r.step < next.step).map((r) => r.items[ID]!.hash);
      if (one(s.hashes[ID] ?? []) !== one(want)) failures.push(`${at}: step hashes ${one(s.hashes[ID])} against playing's ${one(want)}`);
    });
    if (f.seeks.length !== TIMES.length) failures.push(`${f.seeks.length} seeks answered, not ${TIMES.length}`);
    for (const r of f.restores) {
      const d = firstDiff(rows(r.steps, ID), rows(b.steps.filter((s) => s.step >= r.from), ID));
      if (d) failures.push(`restored from checkpoint ${fmt(r.from)}: the steps that ran differ from playing's at ${d}`);
      const theirs = (r.checkpoints[ID] ?? []).map((c) => `${c.step}:${c.deep_hash}`);
      const mine = cps.filter((c) => c.step >= r.from).map((c) => `${c.step}:${c.deep_hash}`);
      if (one(theirs) !== one(mine)) failures.push(`restored from checkpoint ${fmt(r.from)}: checkpoints ${theirs.join(', ')} against playing's ${mine.join(', ')}`);
    }
    if (f.restores.length !== CHECKPOINTS.length - 1) failures.push(`${f.restores.length} restores answered, not ${CHECKPOINTS.length - 1}`);
    none(failures, 'seeks and restores against playing');
  }, TIMEOUT);

  it(`${AC[2]} a live view played straight through the 10 minutes and seeked to each of the 20 times shows the same arrays and full-state hashes`, async () => {
    const b = straight();
    const ran = ranSteps(b.steps, ID);
    /** The arrays as the last step at or before a time left them: what drawing reads of a held write. */
    const stored = (u: number): string => one(Object.keys(TURN_WRITES).map((n) => ran.filter((s) => s.step <= Math.floor(u / 4)).pop()?.arrays[`${ID}.${n}`] ?? null));
    const draws = (f: Parameters<typeof drawn>[0], what: string): string => one(Object.keys(TURN_WRITES).map((n) => drawn(f, `${ID}.${n}`, what)));
    const l = live();
    const failures: string[] = [];
    try {
      const v = await openView(l, game(), MOVES, 610);
      await v.frame();
      const sweep = [...new Set([...Array.from({ length: 2420 }, (_, i) => 60 * (i + 1)), ...TIMES])].sort((a, b2) => a - b2);
      const played = new Map<number, { draws: string; deep: string }>();
      let at = 0;
      for (const u of sweep) {
        const f = await v.frame({ play: (u - at) / 240 });
        at = u;
        if (f.landed.t !== u * QUARTER) { failures.push(`play reached ${secs(f.landed.t)}, not ${secs(u * QUARTER)}`); break; }
        if (TIMES.includes(u)) {
          const d = draws(f.landed, `the frame played to ${secs(u * QUARTER)}`);
          played.set(u, { draws: d, deep: f.landed.deep_hash[ID]! });
          if (d !== stored(u)) failures.push(`played to ${secs(u * QUARTER)}: the view draws ${d}, the bake stored ${stored(u)}`);
        }
      }
      for (const u of shuffled(TIMES, 545_23)) {
        const f = await v.frame({ seek: u / 240 });
        const p = played.get(u);
        if (!p) continue;
        if (f.landed.t !== u * QUARTER) failures.push(`the seek to ${secs(u * QUARTER)} landed at ${secs(f.landed.t)}`);
        const d = draws(f.landed, `the frame seeked to ${secs(u * QUARTER)}`);
        if (d !== p.draws) failures.push(`seeked to ${secs(u * QUARTER)}: arrays ${d}, played ${p.draws}`);
        if (f.landed.deep_hash[ID] !== p.deep) failures.push(`seeked to ${secs(u * QUARTER)}: full-state hash ${f.landed.deep_hash[ID]}, played ${p.deep}`);
      }
      if (played.size !== TIMES.length) failures.push(`play passed ${played.size} of the 20 times`);
    } finally { l.stop(); }
    none(failures, 'the view played and seeked');
  }, TIMEOUT);

  it(`${AC[2]} a planted module that ignores due (turn_ignores_due) leaves turn_done at 0 and fails on that array, naming the step that should have run`, () => {
    none(judgeTurns(straight()), 'the real module on the same track');
    const planted = straight(['turn_ignores_due']);
    const done = ranSteps(planted.steps, ID).map((s) => s.arrays[`${ID}.turn_done`]?.[0]);
    expect(done.every((d) => d === 0), `the planted module leaves turn_done at 0 at every step that ran: ${one(done.slice(0, 20))}`).toBe(true);
    const m = TURNS[0]!.m;
    failsNaming(judgeTurns(planted), new RegExp(`turn\\.turn_done stays 0 after the move at step ${fmt(m)}: step ${fmt(m + 1)}, which turn\\.due named, should have run`), 'the planted module');
  }, TIMEOUT);
});
