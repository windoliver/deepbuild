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
//
// The first two tests of this file (the 10 Hz vec3 drawn played and seeked, and linear_blends_forward) were swapped for
// their blind redraft, tests/acceptance/545-redraft-ac3/: they compared draws["mover.pos"] as one flat vector while the
// README lays draws out as a bake's arrays, a list of elements, as this file's last test reads them.
import { describe, expect, it } from 'vitest';
import {
  AC, TIMEOUT, checkCall, drawn, live, logic, logicBin, near, none, openView, piece, prebuild, refusedWrites, admitted,
  type JsonObject, type WriteSpec,
} from './helpers.ts';
import { BLEND_WRITES, SQRT_HALF, blend, still } from './programs.ts';

prebuild(() => { logicBin(); });

const SEED = 545_03;

describe(`${AC[3]} a linear write draws one step late, blended toward the stored value, and nothing else reads the blend`, () => {
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
