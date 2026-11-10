// AC3 #1646.5b6cd97b: "A CRT text reveal's afterglow at each unit equals its closed form from that unit's reveal time,
// played and seeked"
//
// A text@1 item `type`, "READY." (six graphemes, six units), size 24, with `reveal: {mode: fade, order: reading,
// progress}`, the progress keyed linearly from 0 at 0.5 s to 1 at 2.5 s, in a 4 s film at 30 fps; the look's finish is a
// CRT screen, `screen: {kind: crt, afterglow: "0.4s"}` (README: The surface under test). `deep-canvas-render raster`
// answers, per unit, its reveal time r (flicks) and its afterglow a at t. The closed form (README: Readings):
//   a(t) = 0 for t < r, and e^(−(t − r) ÷ τ) from r on, τ = 0.4 s,
// a function of t and the unit's own reveal time only, never of an earlier frame. Each of the six units is held to it
// within 1e-6 at frames 0 … 120 played in one process, and at frames 17, 31, 46, 62, 75 and 90 each seeked in a fresh
// process, where every value also equals the played frame's. The reveal times themselves: whole flicks, the same at
// every frame, strictly rising in reading order, inside the progress's span [0.5 s, 2.5 s].
// Wrong programs: a glow decayed from the previous frame's (a seek has none, and a unit revealed between frames starts
// at 1), a glow from the item's reveal start rather than the unit's, a linear fade, none at all.
import { describe, expect, it } from 'vitest';
import {
  AC, FLICKS, arr, film, fl, item, lines, look2d, none, num, obj, shown, useBins, useOut,
} from './helpers.ts';

const bins = useBins(['deep-canvas-render']);
const out = useOut();
const FPS = 30;
const STEP = FLICKS / FPS;
const TAU = fl(0.4);
const UNITS = 6;
const SEEKS = [17, 31, 46, 62, 75, 90];
const DOC = film('crt-reveal-1646', [
  item('type', 'text@1', 'a1', { text: 'READY.', size: 24, reveal: { mode: 'fade', order: 'reading', progress: 0 } }, { at: { pos: [40, 160, 0] } }),
], {
  channels: {
    progress: { target: 'items/type/params/reveal/progress', type: 'f32', keys: { k0: { t: '0.5s', value: 0, interp: 'linear' }, k1: { t: '2.5s', value: 1, interp: 'linear' } } },
  },
}, '4s', FPS);
const LOOK = look2d('crt-1646', {}, { finish: [{ screen: { kind: 'crt', afterglow: '0.4s' } }] });

/** The closed form of a unit's afterglow at t (flicks), from its reveal time r (flicks). */
const closed = (t: number, r: number): number => (t < r ? 0 : Math.exp(-(t - r) / TAU));

interface Units { reveal: number[]; afterglow: number[] }
/** `raster` at each frame, in one process (a play when the frames rise one by one). */
function raster(dir: string, frames: number[]): Units[] {
  const answers = lines(bins.bin('deep-canvas-render'), ['raster'], frames.map((n) => ({ out: `${dir}/frame.png`, doc: DOC, look: LOOK, t: n * STEP })));
  return answers.map((a, k) => {
    const what = `raster at frame ${frames[k]}`;
    expect(a['ok'], `${what} draws the document: ${shown(a)}`).toBe(true);
    const t = obj(obj(a['texts'], `${what}: texts`)['type'], `${what}: texts.type`);
    const list = (key: string): number[] => arr(t[key], `${what}: texts.type.${key}`).map((v, i) => num(v, `${what}: texts.type.${key}[${i}]`));
    const u = { reveal: list('reveal'), afterglow: list('afterglow') };
    expect(u.reveal.length, `${what}: one reveal time per unit of READY.`).toBe(UNITS);
    expect(u.afterglow.length, `${what}: one afterglow per unit of READY.`).toBe(UNITS);
    return u;
  });
}
/** Each unit's afterglow against the closed form, and its reveal time against frame 0's; failures name the frame and unit. */
function problems(frames: number[], got: Units[], first: number[], how: string): string[] {
  const out: string[] = [];
  got.forEach((u, k) => {
    const n = frames[k]!; const t = n * STEP;
    for (let i = 0; i < UNITS; i++) {
      if (u.reveal[i] !== first[i]) out.push(`${how}, frame ${n}: unit ${i}'s reveal time is ${u.reveal[i]}, not ${first[i]} as at frame 0`);
      const want = closed(t, first[i]!);
      if (!(Math.abs(u.afterglow[i]! - want) <= 1e-6)) out.push(`${how}, frame ${n} (${(n / FPS).toFixed(3)} s): unit ${i}'s afterglow is ${u.afterglow[i]}, not ${want.toFixed(9)} from its reveal time ${(first[i]! / FLICKS).toFixed(6)} s`);
    }
  });
  return out;
}

describe(`${AC[3]} a CRT's afterglow on a text reveal, from each unit's reveal time`, () => {
  it(`${AC[3]} each unit's afterglow equals e^(−(t − r) ÷ τ) from its own reveal time r at every frame played and each frame seeked`, () => {
    const dir = out();
    const all = Array.from({ length: 121 }, (_, n) => n);
    const played = raster(dir, all);
    const r = played[0]!.reveal;
    const found: string[] = [];
    r.forEach((v, i) => {
      if (!Number.isInteger(v)) found.push(`unit ${i}'s reveal time ${v} is not a whole flick`);
      if (!(v >= fl(0.5) && v <= fl(2.5))) found.push(`unit ${i}'s reveal time ${(v / FLICKS).toFixed(6)} s lies outside the progress's span, 0.5 s to 2.5 s`);
      if (i > 0 && !(v > r[i - 1]!)) found.push(`unit ${i}'s reveal time ${v} doesn't follow unit ${i - 1}'s ${r[i - 1]} in reading order`);
    });
    found.push(...problems(all, played, r, 'played'));
    SEEKS.forEach((n) => {
      const [s] = raster(dir, [n]);
      found.push(...problems([n], [s!], r, 'seeked'));
      for (let i = 0; i < UNITS; i++) if (s!.afterglow[i] !== played[n]!.afterglow[i]) found.push(`seeked, frame ${n}: unit ${i}'s afterglow ${s!.afterglow[i]} isn't the played frame's ${played[n]!.afterglow[i]}`);
    });
    none(found, `${AC[3]} the afterglow`);
  });
});

