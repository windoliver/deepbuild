// Criterion 5 of #545 (#545.fd1e802b), both tests, redrafted blind (README.md). The 10 Hz item that writes x = k m at
// step k into a vec3 array declared linear, with a checkpoint every 60 steps. Played straight to 6.05 s (a view moved on
// by `play`, 1/60 s a frame), drawing reads the blend of steps 59 and 60 by α = 0.5: 59.5 m. Seeked to 6.05 s, back from
// 11 s and on from 0.5 s, the view restores the checkpoint at step 60 (at most one step runs after it) and must draw
// what playing drew there, 59.5 m, with playing's full-state hash. The planted twin `seek_restores_arrays_only`
// restores that checkpoint without the values the linear write held the step before it and draws 60 m; the same
// judgement fails it, naming 6.05 s, 60 m and 59.5 m.
import { describe, expect, it } from 'vitest';
import {
  AC, STEP_60, TIMEOUT, bakeCall, bakeOf, drawn, fmt, live, logic, logicBin, near, none, openView, piece, prebuild,
  ranSteps, show, type Frame, type JsonValue, type Live, type Planted,
} from '../545/helpers.ts';
import { moverItem } from '../545/programs.ts';

const MOVER = 'mover';
const POS = `${MOVER}.pos`;
/** checkpoint.every, given on the item. */
const EVERY = 60;
/** The issue's time: 6.05 s, halfway from step 60 (6 s) to step 61; 363 frames of 1/60 s. */
const AT = { s: 6.05, flicks: 4_268_880_000, frames: 363 } as const;
/** Play goes on to 11 s (660 frames), past the checkpoint at step 60; then a seek to 0.5 s, before it. */
const FAR = { s: 11, frames: 660 } as const;
const EARLY = { s: 0.5, flicks: 352_800_000 } as const;
/** The view's span, past 11 s. */
const SPAN = 12;
/** What playing draws at 6.05 s: step 59's 59 m blended toward step 60's 60 m by α = 0.5. */
const DUE = 59.5;

const metres = (x: number): string => `${Number(x.toFixed(9))} m`;
const xOf = (v: JsonValue | undefined): string =>
  Array.isArray(v) && v.length === 3 && typeof v[0] === 'number' ? `x = ${metres(v[0])}` : `${show(v)} (not a vec3)`;

/** The frame a route to 6.05 s landed, and the steps it ran from its act to landing. */
interface Look { how: string; frame: Frame; steps: number }
interface Watched { played: Look; seeks: Look[] }

/**
 * One view of the mover (10 Hz, linear `pos`, checkpoint every 60 steps) in one `deep-logic`: played from 0 s a frame at
 * a time to 6.05 s and on to 11 s, then sought to 6.05 s (back), to 0.5 s and to 6.05 s again (on). Each frame must land
 * where its act put the playhead.
 */
async function watch(l: Live): Promise<Watched> {
  const v = await openView(l, piece({ seed: 545, items: { [MOVER]: moverItem('linear', EVERY) } }), [], SPAN);
  const land = (how: string, f: Frame, flicks: number): Frame => {
    expect(f.t, `${how} lands the playhead at ${fmt(flicks)} flicks`).toBe(flicks);
    return f;
  };
  let played: Look | undefined;
  for (let i = 1; i <= FAR.frames; i++) {
    const f = land(`played frame ${i} (play 1/60 s a frame from 0 s)`, (await v.frame({ play: 1 / 60 })).landed, i * STEP_60);
    if (i === AT.frames) played = { how: 'played straight', frame: f, steps: 0 };
  }
  const seek = async (how: string, s: number, flicks: number): Promise<Look> => {
    const r = await v.frame({ seek: s });
    return { how, frame: land(`${how} to ${s} s`, r.landed, flicks), steps: r.steps };
  };
  const back = await seek(`seeked back from ${FAR.s} s`, AT.s, AT.flicks);
  await seek(`seeked back from ${AT.s} s`, EARLY.s, EARLY.flicks);
  const on = await seek(`seeked on from ${EARLY.s} s`, AT.s, AT.flicks);
  return { played: played!, seeks: [back, on] };
}

/** Criterion 5's judgement: at 6.05 s playing draws 59.5 m, and each seek there draws what playing drew, with its
 * full-state hash, running at most the one step after the checkpoint at step 60 that it restores. */
function judge(w: Watched): string[] {
  const failures: string[] = [];
  const p = drawn(w.played.frame, POS, `${w.played.how} to ${AT.s} s`)[0];
  if (!near(p, [DUE, 0, 0])) failures.push(`${POS}, ${w.played.how}: at ${AT.s} s drawing reads ${xOf(p)}; x = ${metres(DUE)}, the blend of steps 59 and 60, is due`);
  for (const s of w.seeks) {
    const got = drawn(s.frame, POS, `${s.how} to ${AT.s} s`)[0];
    if (!near(got, [DUE, 0, 0])) failures.push(`${POS}, ${s.how}: at ${AT.s} s drawing reads ${xOf(got)} where playing reads ${xOf(p)}; x = ${metres(DUE)}, the blend of steps 59 and 60, is due`);
    if (s.frame.deep_hash[MOVER] !== w.played.frame.deep_hash[MOVER]) {
      failures.push(`${MOVER}, ${s.how}: at ${AT.s} s the full-state hash is ${s.frame.deep_hash[MOVER] ?? '(none)'} where playing's is ${w.played.frame.deep_hash[MOVER] ?? '(none)'}`);
    }
    if (s.steps > 1) failures.push(`${MOVER}, ${s.how}: ${s.steps} steps ran to land at ${AT.s} s; restoring the checkpoint at step 60, at most one runs`);
  }
  return failures;
}

async function watched(planted: Planted[]): Promise<Watched> {
  const l = live(planted);
  try {
    return await watch(l);
  } finally {
    l.stop();
  }
}

describe(`${AC[5]} a seek that restores the checkpoint at step 60 blends from step 59 as playing does`, () => {
  prebuild(() => { logicBin(); });

  it(`${AC[5]} with a checkpoint every 60 steps the 10 Hz item seeked to 6.05 s draws x = 59.5 m, the blend of steps 59 and 60, as playing does`, async () => {
    // The checkpoint at step 60 and the values steps 59 and 60 stored, from a bake of 121 steps.
    const [reply] = logic([bakeCall(piece({ seed: 545, items: { [MOVER]: moverItem('linear', EVERY) } }), { steps: 121 })]);
    const bake = bakeOf(reply!, 'the bake of the linear mover, a checkpoint every 60 steps');
    expect((bake.checkpoints[MOVER] ?? []).map((c) => c.step), 'the bake takes the mover\'s checkpoint at step 60').toContain(60);
    for (const k of [59, 60]) {
      const s = ranSteps(bake.steps, MOVER).find((r) => r.step === k);
      expect(s && near(s.arrays[POS]?.[0], [k, 0, 0]), `step ${k} stored ${POS} [[${k}, 0, 0]]: ${show(s?.arrays[POS])}`).toBe(true);
    }
    none(judge(await watched([])), 'the linear write at 6.05 s, played and seeked');
  }, TIMEOUT);

  it(`${AC[5]} a planted seek that restores only the arrays of the checkpoint at step 60 (seek_restores_arrays_only) draws 60 m and fails, naming the time and both values`, async () => {
    none(judge(await watched([])), 'the real program, on the same view');
    const twin = judge(await watched(['seek_restores_arrays_only']));
    const named = [/\bat 6\.05 s\b/, /reads x = 60 m\b/, /playing reads x = 59\.5 m\b/];
    expect(twin.length, 'seek_restores_arrays_only: criterion 5\'s judgement fails the planted program').toBeGreaterThan(0);
    expect(twin.some((f) => named.every((r) => r.test(f))), `seek_restores_arrays_only: a failure names ${named.join(', ')}; the failures:\n  ${twin.join('\n  ')}`).toBe(true);
  }, TIMEOUT);
});
