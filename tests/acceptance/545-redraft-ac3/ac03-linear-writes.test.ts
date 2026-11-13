// Criterion 3 of #545 (#545.10859a3c), its first two tests, redrafted blind (README.md). A 10 Hz logic item writes
// x = k m at step k into a vec3 array. Declared linear, drawing reads it one step late: at t = 0.15 s, halfway from
// step 1 (0.1 s) to step 2 (0.2 s), α = 0.5 and it draws step 0's 0 m blended toward step 1's 1 m, 0.5 m; at t = 0.1 s,
// α = 0 and it draws step 0's 0 m. Declared hold it draws step 1's 1 m at 0.15 s. Played straight (a view moved on by
// `play`, 1/60 s a frame) and seeked (the same view sought back and forth, and fresh views sought once) alike. Nothing
// but drawing reads the blend: a 60 Hz reader stores whole metres, the bake stores x = k, and step hashes, checkpoint
// and frame full-state hashes are the same with linear and hold. The planted twin `linear_blends_forward` blends from
// step k toward step k + 1, as a physics output does: 1.5 m at 0.15 s, and the same judgement fails it.
import { describe, expect, it } from 'vitest';
import {
  AC, HASH64, STEP_60, TIMEOUT, bakeCall, bakeOf, drawn, firstDiff, fmt, live, logic, logicBin, near, none, openView, piece,
  prebuild, ranSteps, rows, show, type Frame, type JsonValue, type Live, type Planted,
} from '../545/helpers.ts';
import { moverItem, readerItem } from '../545/programs.ts';

type Interpolate = 'linear' | 'hold';
const MOVER = 'mover';
const POS = `${MOVER}.pos`;
const READER = 'reader';
const SEEN = `${READER}.seen`;
/** The issue's two times: 0.1 s, step 1's time, and 0.15 s, halfway to step 2's; in flicks, and as 60 fps frames. */
const STEP1 = { s: 0.1, flicks: 70_560_000, frame: 6 } as const;
const HALF = { s: 0.15, flicks: 105_840_000, frame: 9 } as const;
/** Played straight: 60 frames of 1/60 s from 0 s, to 1 s, the view's span. */
const SPAN = 1;
const FRAMES = 60;
/** The bake: 72 steps of each item, so the 60 Hz reader runs to 71/60 s and both items reach a checkpoint at step 60. */
const BAKE_STEPS = 72;

/** What drawing reads of `mover.pos` at a time, by one route there. */
interface Look { how: string; s: number; frame: Frame }
interface Watched { looks: Look[]; hashes: string[] }

const metres = (x: number): string => `${Number(x.toFixed(9))} m`;
const xOf = (v: JsonValue | undefined): string =>
  Array.isArray(v) && v.length === 3 && typeof v[0] === 'number' ? `x = ${metres(v[0])}` : `${show(v)} (not a vec3)`;

/**
 * The mover alone (10 Hz, `pos` declared `interpolate`), in views of one `deep-logic`: played from 0 s to 1 s a frame
 * at a time, then that view sought to 0.15 s, 0.1 s and 0.15 s again; and two fresh views, one sought to 0.15 s and one
 * to 0.1 s. Each frame must land where its act put the playhead. `looks` are the frames at 0.1 s and 0.15 s; `hashes`
 * one line per frame, its route, its time and the mover's full-state hash.
 */
async function watch(l: Live, interpolate: Interpolate): Promise<Watched> {
  const p = piece({ seed: 545, items: { [MOVER]: moverItem(interpolate) } });
  const looks: Look[] = [];
  const hashes: string[] = [];
  const keep = (how: string, f: Frame, flicks: number): Frame => {
    expect(f.t, `${interpolate}: ${how} lands the playhead at ${fmt(flicks)} flicks`).toBe(flicks);
    hashes.push(`${how} @ ${f.t}: ${f.deep_hash[MOVER] ?? '(no full-state hash)'}`);
    return f;
  };
  const played = await openView(l, p, [], SPAN);
  for (let i = 1; i <= FRAMES; i++) {
    const f = keep(`played frame ${i} (play 1/60 s a frame from 0 s)`, (await played.frame({ play: 1 / 60 })).landed, i * STEP_60);
    if (i === STEP1.frame) looks.push({ how: 'played', s: STEP1.s, frame: f });
    if (i === HALF.frame) looks.push({ how: 'played', s: HALF.s, frame: f });
  }
  for (const [how, at] of [['seeked back from 1 s', HALF], ['seeked back from 0.15 s', STEP1], ['seeked on from 0.1 s', HALF]] as const) {
    looks.push({ how, s: at.s, frame: keep(`${how} to ${at.s} s`, (await played.frame({ seek: at.s })).landed, at.flicks) });
  }
  for (const at of [HALF, STEP1]) {
    const fresh = await openView(l, p, [], SPAN);
    const how = 'seeked in a fresh view';
    looks.push({ how, s: at.s, frame: keep(`${how} to ${at.s} s`, (await fresh.frame({ seek: at.s })).landed, at.flicks) });
  }
  return { looks, hashes };
}

/** Criterion 3's judgement of a linear `pos`: 0.5 m at 0.15 s and 0 m at 0.1 s, by every route. */
function judgeLinear(looks: Look[]): string[] {
  const due = (s: number): { x: number; why: string } =>
    s === HALF.s ? { x: 0.5, why: "step 0's 0 m blended toward step 1's 1 m by α = 0.5" } : { x: 0, why: "step 0's 0 m, α = 0" };
  return looks.flatMap((look) => {
    const got = drawn(look.frame, POS, `linear, ${look.how} to ${look.s} s`)[0];
    const { x, why } = due(look.s);
    return near(got, [x, 0, 0]) ? [] : [`linear ${POS}, ${look.how}: at ${look.s} s drawing reads ${xOf(got)}; x = ${metres(x)} is due (${why})`];
  });
}

/** The same array declared hold: 1 m at 0.15 s, by every route. */
function judgeHold(looks: Look[]): string[] {
  return looks.filter((look) => look.s === HALF.s).flatMap((look) => {
    const got = drawn(look.frame, POS, `hold, ${look.how} to ${look.s} s`)[0];
    return near(got, [1, 0, 0]) ? [] : [`held ${POS}, ${look.how}: at ${look.s} s drawing reads ${xOf(got)}; x = 1 m, step 1's, is due`];
  });
}

async function watched(planted: Planted[], interpolate: Interpolate): Promise<Watched> {
  const l = live(planted);
  try {
    return await watch(l, interpolate);
  } finally {
    l.stop();
  }
}

/** A failure that names every one of `named`. */
function failsNamingAll(failures: readonly string[], named: readonly RegExp[], what: string): void {
  expect(failures.length, `${what}: criterion 3's judgement fails the planted program`).toBeGreaterThan(0);
  expect(failures.some((f) => named.every((r) => r.test(f))), `${what}: a failure names ${named.join(', ')}; the failures:\n  ${failures.join('\n  ')}`).toBe(true);
}

describe(`${AC[3]} a linear write draws one step late, blended toward the stored value, and only drawing reads the blend`, () => {
  prebuild(() => { logicBin(); });

  it(`${AC[3]} the 10 Hz item's linear vec3 draws 0.5 m at 0.15 s and 0 m at 0.1 s played and seeked, held it draws 1 m; a reader reads whole metres; step and full-state hashes are equal either way`, async () => {
    // The stored values: the mover and a 60 Hz reader of its array, baked with linear and with hold.
    const both = (interpolate: Interpolate) => piece({ seed: 545, items: { [MOVER]: moverItem(interpolate), [READER]: readerItem() } });
    const [lin, hold] = logic([bakeCall(both('linear'), { steps: BAKE_STEPS }), bakeCall(both('hold'), { steps: BAKE_STEPS })])
      .map((r, i) => bakeOf(r, `the bake of the mover and its reader, ${i === 0 ? 'linear' : 'hold'}`));
    for (const [id, path] of [[MOVER, POS], [READER, SEEN]] as const) {
      const ran = ranSteps(lin!.steps, id);
      expect(ran.map((s) => s.step), `the linear bake: ${id} ran steps 0 to ${BAKE_STEPS - 1}`).toEqual(Array.from({ length: BAKE_STEPS }, (_, k) => k));
      for (const s of ran) {
        expect(s.items[id]!.hash ?? '', `the linear bake: ${id}'s step ${s.step} has a step hash`).toMatch(HASH64);
        expect(s.arrays[path], `the linear bake: step ${s.step} records ${path}`).toBeDefined();
      }
    }
    const stored = ranSteps(lin!.steps, MOVER).filter((s) => !near(s.arrays[POS]![0], [s.step, 0, 0]));
    none(stored.map((s) => `step ${s.step} stored ${POS} ${show(s.arrays[POS])}, not [[${s.step}, 0, 0]]`), 'the linear bake keeps the values the steps stored');
    // Reader step j runs at j/60 s and reads the mover as the steps before left it: step ⌊j/6⌋'s x, or at a time the
    // mover also steps (j a multiple of 6), the step before's; never a blend. At j = 9 (0.15 s) that is step 1's 1 m.
    const whole = ranSteps(lin!.steps, READER).flatMap((s) => {
      const j = s.step;
      const may = [...new Set([Math.max(0, Math.ceil(j / 6) - 1), Math.floor(j / 6)])];
      const got = s.arrays[SEEN]![0];
      return may.some((x) => near(got, [x, 0, 0])) ? [] : [`reader step ${j} (${j}/60 s) read ${xOf(got)} of ${POS}; a value a step stored, x = ${may.map(metres).join(' or ')}, is due`];
    });
    none(whole, 'the reader of the linear array reads only whole metres, the values the steps stored');
    for (const id of [MOVER, READER]) {
      expect(firstDiff(rows(lin!.steps, id), rows(hold!.steps, id)), `${id}'s steps (number, step hash, arrays), linear against hold`).toBeNull();
      expect(lin!.checkpoints[id]?.length ?? 0, `the linear bake takes ${id}'s checkpoints (at 0 and 60)`).toBeGreaterThanOrEqual(2);
      expect(lin!.checkpoints[id], `${id}'s checkpoints and their full-state hashes, linear against hold`).toEqual(hold!.checkpoints[id]);
    }

    // What drawing reads, played straight and seeked.
    const linear = await watched([], 'linear');
    const held = await watched([], 'hold');
    none(judgeLinear(linear.looks), 'the linear write as drawing reads it at 0.15 s and 0.1 s');
    none(judgeHold(held.looks), 'the held write as drawing reads it at 0.15 s');
    expect(firstDiff(linear.hashes, held.hashes), "the mover's full-state hash at each frame, linear against hold").toBeNull();
  }, TIMEOUT);

  it(`${AC[3]} a planted blend toward the next step (linear_blends_forward) draws 1.5 m at 0.15 s and fails, naming the time and both values`, async () => {
    none(judgeLinear((await watched([], 'linear')).looks), 'the real program, on the same views');
    const twin = judgeLinear((await watched(['linear_blends_forward'], 'linear')).looks);
    failsNamingAll(twin, [/\bat 0\.15 s\b/, /reads x = 1\.5 m\b/, /x = 0\.5 m is due\b/], 'linear_blends_forward');
  }, TIMEOUT);
});
