// Criterion 3 (oracle: Bevy `Time<Fixed>`'s overstep_fraction, used as a formula): "A 10 Hz logic item whose step k
// writes x = k m into a vec3 array declared linear draws x = 0.5 m at t = 0.15 s and x = 0 m at t = 0.1 s, played
// straight and seeked alike, while the same array declared hold draws 1 m at 0.15 s; another logic item that reads the
// array reads only whole metres, the values the steps stored; full-state and step hashes are equal with linear and with
// hold; a planted blend toward the next step, as a physics output blends, draws 1.5 m at 0.15 s and fails, naming the
// time and both values; and an i32 or bool write declared linear is refused at check, naming it"
//
// Through a live `view`'s frames (`draws`: what drawing reads of each array at the frame's t), `bake` and `check`
// (README: deep-logic). The oracle's formula: α = (t − t(k)) ÷ the step length, the time past the last step at or
// before t over the step, 0.5 halfway through a step and 0 on it; drawn one step late, x(t) = x(k − 1) + α (x(k) −
// x(k − 1)): at 0.15 s, k = 1 and α = 0.5, so 0.5 m; at 0.1 s, k = 1 and α = 0, so step 0's 0 m. Held, x(t) = x(k):
// 1 m at both. A blend toward the next step, x(k) + α (x(k + 1) − x(k)), gives 1.5 m at 0.15 s. "Played straight" is a
// view stepped forward one 60 fps frame at a time from 0 s; "seeked", the same view sought back from 1 s, and a fresh
// view sought once. The reader is a 60 Hz item that copies the mover's array into its own `seen`; at its step 9
// (0.15 s) the last mover step before it is step 1, so it reads 1 m. The issue's comment adds that linear on f64, vec2
// and quat draws as vec3 does (lerp, and nlerp for a quat), and that i32 and bool are refused, naming the write.
// `linear_blends_forward` blends a linear write from step k's value toward step k + 1's by α.
import { describe, expect, it } from 'vitest';
import {
  AC, FLICKS, TIMEOUT, bakeCall, bakeOf, checkCall, drawn, failsNaming, live, logic, logicBin, near, none, openView, piece, prebuild, refusedWrites, admitted,
  type JsonObject, type JsonValue, type Planted, type WriteSpec,
} from './helpers.ts';
import { BLEND_WRITES, SQRT_HALF, blend, moverItem, readerItem, still } from './programs.ts';

prebuild(() => { logicBin(); });

const SEED = 545_03;
type Write = 'linear' | 'hold';
const moverPiece = (w: Write): JsonObject => piece({ seed: SEED, items: { mover: moverItem(w) } });
const bothPiece = (w: Write): JsonObject => piece({ seed: SEED, items: { mover: moverItem(w), reader: readerItem() } });
/** What the issue says each write draws at each time, in metres. */
const WANT: Record<Write, Record<string, number>> = { linear: { '0.1': 0, '0.15': 0.5 }, hold: { '0.1': 1, '0.15': 1 } };

interface Drawn { write: Write; how: string; t: number; landed: number; x: JsonValue[] }
/** The mover's `pos` as drawing reads it at 0.1 s and 0.15 s: played straight, seeked back from 1 s, and seeked once in
 * a fresh view. */
async function drawsOf(write: Write, planted: Planted[] = []): Promise<Drawn[]> {
  const l = live(planted);
  const out: Drawn[] = [];
  try {
    const v = await openView(l, moverPiece(write), [], 1);
    await v.frame();
    for (let i = 1; i <= 60; i++) {
      const f = await v.frame({ play: 1 / 60 });
      if (i === 6 || i === 9) out.push({ write, how: 'played', t: i === 6 ? 0.1 : 0.15, landed: f.landed.t, x: drawn(f.landed, 'mover.pos', `${write}, played to ${i}/60 s`) });
    }
    for (const t of [0.15, 0.1]) {
      const f = await v.frame({ seek: t });
      out.push({ write, how: 'seeked back from 1 s', t, landed: f.landed.t, x: drawn(f.landed, 'mover.pos', `${write}, seeked back to ${t} s`) });
    }
    for (const t of [0.15, 0.1]) {
      const w = await openView(l, moverPiece(write), [], 1);
      const f = await w.frame({ seek: t });
      out.push({ write, how: 'seeked in a fresh view', t, landed: f.landed.t, x: drawn(f.landed, 'mover.pos', `${write}, seeked to ${t} s in a fresh view`) });
    }
  } finally { l.stop(); }
  return out;
}
/** The criterion over what was drawn, each failure naming the time and both values. */
function judge(ds: Drawn[]): string[] {
  const failures: string[] = [];
  for (const d of ds) {
    if (d.landed !== Math.round(d.t * FLICKS)) failures.push(`${d.write}, ${d.how}: the frame for ${d.t} s landed at flick ${d.landed}`);
    const want = WANT[d.write][String(d.t)]!;
    if (!near(d.x, [want, 0, 0])) failures.push(`${d.write}, ${d.how}: at t = ${d.t} s it drew x = ${Array.isArray(d.x) ? String(d.x[0]) : JSON.stringify(d.x)} m, not ${want} m (${JSON.stringify(d.x)})`);
  }
  if (ds.length !== 12) failures.push(`${ds.length} draws read, not 12`);
  return failures;
}

describe(`${AC[3]} a linear write draws one step late, blended toward the stored value, and nothing else reads the blend`, () => {
  it(`${AC[3]} the 10 Hz item's linear vec3 draws 0.5 m at 0.15 s and 0 m at 0.1 s played and seeked, held it draws 1 m; a reader reads whole metres; step and full-state hashes are equal either way`, async () => {
    none(judge([...await drawsOf('linear'), ...await drawsOf('hold')]), 'what drawing reads');
    const [lin, hold] = logic([bakeCall(bothPiece('linear'), { steps: 120 }), bakeCall(bothPiece('hold'), { steps: 120 })]).map((r, i) => bakeOf(r, `the bake with ${i ? 'hold' : 'linear'}`));
    const failures: string[] = [];
    for (const s of lin!.steps) {
      const seen = s.arrays['reader.seen'];
      if (seen && !(Array.isArray(seen[0]) && Number.isInteger(seen[0][0]) && seen[0][1] === 0 && seen[0][2] === 0)) failures.push(`reader step ${s.step}: it read ${JSON.stringify(seen)}, not whole metres`);
      const pos = s.arrays['mover.pos'];
      if (pos && s.items['mover'] && !near(pos[0], [s.step, 0, 0])) failures.push(`mover step ${s.step}: it stored ${JSON.stringify(pos)}, not [${s.step}, 0, 0]`);
    }
    const at9 = lin!.steps.find((s) => s.step === 9)?.arrays['reader.seen'];
    if (!near(at9?.[0], [1, 0, 0])) failures.push(`reader step 9 (0.15 s) read ${JSON.stringify(at9)}, not step 1's stored [1, 0, 0]`);
    for (const id of ['mover', 'reader']) {
      const hashes = (b: typeof lin): string => JSON.stringify(b!.steps.map((s) => [s.step, s.items[id]?.hash ?? null]));
      if (hashes(lin) !== hashes(hold)) failures.push(`${id}: its step hashes differ between linear and hold`);
      if (JSON.stringify(lin!.checkpoints[id]) !== JSON.stringify(hold!.checkpoints[id])) failures.push(`${id}: its full-state hashes at the checkpoints differ between linear and hold: ${JSON.stringify(lin!.checkpoints[id])} against ${JSON.stringify(hold!.checkpoints[id])}`);
    }
    if (!(lin!.checkpoints['mover']?.length ?? 0)) failures.push('the bake holds no checkpoint of the mover to compare');
    none(failures, 'the stored values, with linear and with hold');
  }, TIMEOUT);

  it(`${AC[3]} a planted blend toward the next step (linear_blends_forward) draws 1.5 m at 0.15 s and fails, naming the time and both values`, async () => {
    none(judge([...await drawsOf('linear'), ...await drawsOf('hold')]), 'the real module');
    const planted = [...await drawsOf('linear', ['linear_blends_forward']), ...await drawsOf('hold', ['linear_blends_forward'])];
    expect(planted.filter((d) => d.write === 'linear' && d.t === 0.15).map((d) => near(d.x, [1.5, 0, 0])), 'the planted blend draws 1.5 m at 0.15 s, played and seeked').toEqual([true, true, true]);
    failsNaming(judge(planted), /linear, played: at t = 0\.15 s it drew x = 1\.5 m, not 0\.5 m/, 'the planted blend');
  }, TIMEOUT);

  it(`${AC[3]} an i32 or bool write declared linear is refused at check, naming it; f64, vec2, vec3 and quat writes may be linear`, () => {
    const one = (writes: Record<string, WriteSpec>): JsonObject => checkCall(piece({ seed: SEED, items: { cam: { program: still(), writes } } }));
    const [i32, bool, fine] = logic([
      one({ n: { type: 'i32', interpolate: 'linear' }, x: { type: 'f64', interpolate: 'linear' } }),
      one({ flag: { type: 'bool', interpolate: 'linear' } }),
      one({ x: { type: 'f64', interpolate: 'linear' }, xy: { type: 'vec2', interpolate: 'linear' }, p: { type: 'vec3', interpolate: 'linear' }, q: { type: 'quat', interpolate: 'linear' }, n: { type: 'i32', interpolate: 'hold' }, flag: { type: 'bool' } }),
    ]);
    const a = refusedWrites(i32!, 'the item with an i32 declared linear');
    expect([a.item, a.writes], 'refused, naming the item and the i32 write n, and not the f64').toEqual(['cam', ['n']]);
    const b = refusedWrites(bool!, 'the item with a bool declared linear');
    expect([b.item, b.writes], 'refused, naming the item and the bool write flag').toEqual(['cam', ['flag']]);
    admitted(fine!, 'the item with f64, vec2, vec3 and quat declared linear');
  }, TIMEOUT);

  it(`${AC[3]} (the issue's comment) linear f64, vec2 and quat writes draw blended too: 0.5, [0.5, 0] and the nlerp halfway to a quarter turn at 0.15 s, played and seeked`, async () => {
    const p = piece({ seed: SEED, items: { b: { program: blend(), step_rate: 10, writes: BLEND_WRITES } } });
    const half = Math.hypot(SQRT_HALF / 2, (1 + SQRT_HALF) / 2);
    const want: Record<string, Record<string, number[]>> = {
      '0.1': { 'b.x': [0], 'b.xy': [0, 0], 'b.q': [0, 0, 0, 1] },
      '0.15': { 'b.x': [0.5], 'b.xy': [0.5, 0], 'b.q': [0, 0, SQRT_HALF / 2 / half, (1 + SQRT_HALF) / 2 / half] },
    };
    const failures: string[] = [];
    const check = (how: string, t: string, f: Parameters<typeof drawn>[0]): void => {
      for (const [path, v] of Object.entries(want[t]!)) {
        const got = drawn(f, path, `${how} to ${t} s`)[0];
        if (!near(got, v)) failures.push(`${how}: at t = ${t} s ${path} drew ${JSON.stringify(got)}, not ${JSON.stringify(v)}`);
      }
    };
    const l = live();
    try {
      const v = await openView(l, p, [], 1);
      await v.frame();
      for (let i = 1; i <= 60; i++) {
        const f = await v.frame({ play: 1 / 60 });
        if (i === 6) check('played', '0.1', f.landed);
        if (i === 9) check('played', '0.15', f.landed);
      }
      check('seeked back from 1 s', '0.15', (await v.frame({ seek: 0.15 })).landed);
      check('seeked back from 1 s', '0.1', (await v.frame({ seek: 0.1 })).landed);
    } finally { l.stop(); }
    none(failures, 'linear f64, vec2 and quat writes');
  }, TIMEOUT);
});
