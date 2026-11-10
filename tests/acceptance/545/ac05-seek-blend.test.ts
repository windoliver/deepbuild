// Criterion 5 (no upstream test): "With a checkpoint every 60 steps, the 10 Hz item seeked to 6.05 s draws x = 59.5 m,
// the blend of steps 59 and 60, as playing does; a planted seek that restores only the arrays of the checkpoint at step
// 60 draws 60 m and fails, naming the time and both values"
//
// Through a live `view`'s frames (`draws`) (README: deep-logic). Criterion 3's 10 Hz mover (programs.ts: step k writes
// x = k m into its linear vec3 `pos`) with `checkpoint: {every: 60}`, in a view of a 12 s span. At 6.05 s the last step
// at or before t is 60, α = 0.5: x = 59 + 0.5 (60 − 59) = 59.5 m. "Playing" is the view stepped forward one 60 fps frame
// at a time from 0 s to 12 s (the 6.05 s frame is the 363rd); then two seeks restore the checkpoint at step 60: one
// forward to 6.05 s from 0.5 s, one back to 6.05 s from 11 s. Each must draw 59.5 m and run at most one step after
// its restore (step 60 itself, for a checkpoint taken before step 60 runs), so it is the checkpoint, not a replay from
// an earlier one, that the blend reads from. `seek_restores_arrays_only` restores a checkpoint's arrays without the
// values the linear writes held at the step before it, and draws 60 m at 6.05 s.
import { describe, expect, it } from 'vitest';
import { AC, FLICKS, TIMEOUT, drawn, failsNaming, live, logicBin, near, none, openView, piece, prebuild, type JsonValue, type Planted } from './helpers.ts';
import { moverItem } from './programs.ts';

prebuild(() => { logicBin(); });

const SEED = 545_05;
const T = 6.05;
const WANT = 59.5;
const PIECE = piece({ seed: SEED, items: { mover: moverItem('linear', 60) } });

interface Drawn { how: string; landed: number; x: JsonValue[]; steps: number | null }
async function drawsAt605(planted: Planted[] = []): Promise<Drawn[]> {
  const l = live(planted);
  const out: Drawn[] = [];
  try {
    const v = await openView(l, PIECE, [], 12);
    await v.frame();
    for (let i = 1; i <= 720; i++) {
      const f = await v.frame({ play: 1 / 60 });
      if (i === 363) out.push({ how: 'played', landed: f.landed.t, x: drawn(f.landed, 'mover.pos', 'played to 6.05 s'), steps: null });
    }
    await v.frame({ seek: 0.5 });
    const fwd = await v.frame({ seek: T });
    out.push({ how: 'seeked from 0.5 s', landed: fwd.landed.t, x: drawn(fwd.landed, 'mover.pos', 'seeked to 6.05 s from 0.5 s'), steps: fwd.steps });
    await v.frame({ seek: 11 });
    const back = await v.frame({ seek: T });
    out.push({ how: 'seeked back from 11 s', landed: back.landed.t, x: drawn(back.landed, 'mover.pos', 'seeked back to 6.05 s from 11 s'), steps: back.steps });
  } finally { l.stop(); }
  return out;
}
/** The criterion over the draws at 6.05 s, each failure naming the time and both values. */
function judge(ds: Drawn[]): string[] {
  const failures: string[] = [];
  for (const d of ds) {
    if (d.landed !== Math.round(T * FLICKS)) failures.push(`${d.how}: the frame for 6.05 s landed at flick ${d.landed}`);
    if (!near(d.x, [WANT, 0, 0])) failures.push(`${d.how}: at t = 6.05 s it drew x = ${Array.isArray(d.x) ? String(d.x[0]) : JSON.stringify(d.x)} m, not 59.5 m, the blend of steps 59 and 60 (${JSON.stringify(d.x)})`);
    if (d.steps !== null && d.steps > 1) failures.push(`${d.how}: the seek ran ${d.steps} steps to land, so it didn't restore the checkpoint at step 60`);
  }
  if (ds.length !== 3) failures.push(`${ds.length} draws read, not 3`);
  return failures;
}

describe(`${AC[5]} a checkpoint keeps what a linear write held the step before, so a seek blends as playing does`, () => {
  it(`${AC[5]} with a checkpoint every 60 steps the 10 Hz item seeked to 6.05 s draws x = 59.5 m, the blend of steps 59 and 60, as playing does`, async () => {
    none(judge(await drawsAt605()), 'the draws at 6.05 s');
  }, TIMEOUT);

  it(`${AC[5]} a planted seek that restores only the arrays of the checkpoint at step 60 (seek_restores_arrays_only) draws 60 m and fails, naming the time and both values`, async () => {
    none(judge(await drawsAt605()), 'the real module');
    const planted = await drawsAt605(['seek_restores_arrays_only']);
    expect(planted.map((d) => near(d.x, [d.how === 'played' ? WANT : 60, 0, 0])), `played it still draws 59.5 m; both planted seeks draw 60 m: ${JSON.stringify(planted.map((d) => [d.how, d.x]))}`).toEqual([true, true, true]);
    failsNaming(judge(planted), /seeked from 0\.5 s: at t = 6\.05 s it drew x = 60 m, not 59\.5 m/, 'the planted seek');
  }, TIMEOUT);
});
