// AC1 #265.535c93ba: "A world-space emitter whose anchor a logic array moves at 60 Hz emits at the same birth buckets on
// a 60 Hz and a 144 Hz display, and 20 sampled times give one pixel hash seeked and played; a planted source that reads
// the anchor's drawn position kept from the last frame instead of the bake differs after a seek and fails, naming the
// source"
//
// The walker (helpers.ts: walkerDoc): the logic item `walk` steps at 60 Hz and its `hold` arrays `x` and `z` place the
// sphere `walker` through two drivers; `dust`, a world-space emitter anchored on it, births 45 particles a second, so most
// are born between the document's 1/60 s birth buckets. Its twin moves the walker by hold channels through the same values
// at the same steps, the chain the base already reads at earlier times (Particles: space and paths).
// - Buckets: `view3d` plays the walker at 60 fps (frames 0 to 240) and at 144 fps (frames 0 to 576), each in its own
//   process, with #449's `particles` field; at the 48 times both draw, m ÷ 12 s, both frames carry the same evaluated-data
//   hash, and it is the twin's at that time (so every anchor is the logic bake's value at its bucket, as a channel
//   holding it gives). Guards: at least 85 particles live from 2 s, and the hashes move.
// - Seek: 20 seeded frames in [30, 240] at 60 fps, each opened in a fresh process (#380's `from`), have the played frames'
//   pixel hashes.
// - The planted `anchor_kept_from_frame` (README: Planted programs) under the same seek-against-play judge fails, a
//   failure naming the source `dust`.
// Wrong programs: the base (a world-space source on a logic-moved anchor can't be read at earlier buckets); anchors from
// the current frame or from frames drawn before; buckets keyed to the display's frames; births at their exact time.

import { describe, expect, it } from 'vitest';
import {
  FLICKS, TIMEOUT, WALK_STEPS, ac, failsNaming, framesOf, none, putPrograms, random, requireGpu, run, useBins, useDir, view3d, walkerDoc,
  writeJson, type Frame, type Moved, type Planted,
} from './helpers.ts';

const bins = useBins(['deep-gpu']);
const dir = useDir();
const SHARED = Array.from({ length: 48 }, (_, i) => i + 1);
const SIZE: [number, number] = [240, 160];
const SOUGHT = ((): number[] => {
  const rnd = random(265);
  const out = new Set<number>();
  while (out.size < 20) out.add(30 + Math.floor(rnd() * (WALK_STEPS - 30 + 1)));
  return [...out].sort((a, b) => a - b);
})();

/** The walker's document and programs in this test's folder. */
function placed(how: Moved): { doc: string; assets: Record<string, string> } {
  const f = walkerDoc(how);
  return { doc: writeJson(dir(), `walker-${how}.json`, f.doc), assets: putPrograms(dir(), f.programs) };
}
/** One display of a document from frame 0, by frame, kept per document, rate and plant so the file's tests share it. */
const plays = new Map<string, Map<number, Frame>>();
function played(how: Moved, fps: number, frames: number, planted?: Planted): Map<number, Frame> {
  const key = `${how}:${fps}:${planted ?? ''}`;
  if (!plays.has(key)) plays.set(key, display(how, fps, frames, planted));
  return plays.get(key)!;
}
function display(how: Moved, fps: number, frames: number, planted?: Planted): Map<number, Frame> {
  const { doc, assets } = placed(how);
  const [reply] = run(bins.bin('deep-gpu'), dir(), [view3d({ doc, assets, size: SIZE, fps, from: 0, frames, particles: ['dust'], particle_cull: 'none' })], planted ? { planted } : {});
  const fs = framesOf(reply!, `the walker (${how}) at ${fps} fps${planted ? `, planted ${planted}` : ''}`, ['dust']);
  expect(fs.map((f) => f.frame), `the ${fps} fps display draws frames 0 to ${frames - 1}`).toEqual(Array.from({ length: frames }, (_, n) => n));
  return new Map(fs.map((f) => [f.frame, f]));
}
const hashOf = (f: Frame | undefined): string => f?.particles.get('dust')?.hash ?? 'none';

/** The seek-against-play judge: each sampled frame opened in a fresh process against the played one. Failures name the
 * source and the time. */
function seekProblems(planted?: Planted): string[] {
  const play = played('logic', 60, WALK_STEPS + 1, planted);
  const out: string[] = [];
  for (const n of SOUGHT) {
    const { doc, assets } = placed('logic');
    const [reply] = run(bins.bin('deep-gpu'), dir(), [view3d({ doc, assets, size: SIZE, fps: 60, from: n, frames: 1, particles: ['dust'], particle_cull: 'none' })], planted ? { planted } : {});
    const s = framesOf(reply!, `the walker sought to frame ${n}`, ['dust']).find((f) => f.frame === n);
    const p = play.get(n)!;
    if (!p.pixelHash || s?.pixelHash !== p.pixelHash) {
      out.push(`the source dust at ${(n / 60).toFixed(4)} s (frame ${n}): seeking draws pixel hash ${s?.pixelHash?.slice(0, 12) ?? 'none'} (particles ${hashOf(s).slice(0, 12)}), playing ${p.pixelHash?.slice(0, 12) ?? 'none'} (particles ${hashOf(p).slice(0, 12)})`);
    }
  }
  return out;
}

describe(`${ac(1)} a world-space emitter on a logic-moved anchor, read from the logic bake`, () => {
  it(`${ac(1)} (buckets) it emits at the same birth buckets on a 60 Hz and a 144 Hz display, the logic bake's anchor at each, as a channel holding the same steps gives`, () => {
    requireGpu();
    const at60 = played('logic', 60, WALK_STEPS + 1);
    const at144 = played('logic', 144, 576 + 1);
    const twin = played('channels', 60, WALK_STEPS + 1);
    const fails: string[] = [];
    for (const m of SHARED) {
      const a = at60.get(5 * m); const b = at144.get(12 * m); const c = twin.get(5 * m);
      const when = `dust at ${m}/12 s (${((m * FLICKS) / 12).toFixed(0)} flicks)`;
      if (hashOf(a) !== hashOf(b)) fails.push(`${when}: the 60 Hz display draws evaluated data ${hashOf(a).slice(0, 12)}, the 144 Hz display ${hashOf(b).slice(0, 12)}`);
      if (hashOf(a) !== hashOf(c)) fails.push(`${when}: the logic-moved walker's emitter draws ${hashOf(a).slice(0, 12)}, the one whose walker a channel holds through the same steps ${hashOf(c).slice(0, 12)}`);
      if (m >= 24 && (a?.particles.get('dust')?.live ?? 0) < 85) fails.push(`${when}: ${a?.particles.get('dust')?.live ?? 0} particles live, not the 90 a 45/s emitter of 2 s keeps`);
    }
    none(fails, 'the emitter at the 48 times both displays draw');
    expect(new Set(SHARED.map((m) => hashOf(at60.get(5 * m)))).size, 'the emitter\'s particles move between the 48 times').toBeGreaterThanOrEqual(40);
  }, TIMEOUT);

  it(`${ac(1)} (seek) 20 sampled times, each opened by a seek in a fresh process, give the played frames' pixel hashes`, () => {
    requireGpu();
    none(seekProblems(), 'seek against play at the 20 sampled times');
  }, TIMEOUT);

  it(`${ac(1)} (planted) a source that reads the anchor's drawn position kept from the last frame differs after a seek and fails, naming the source`, () => {
    requireGpu();
    failsNaming(seekProblems('anchor_kept_from_frame'), ['the source dust'], 'the planted anchor_kept_from_frame');
  }, TIMEOUT);
});
