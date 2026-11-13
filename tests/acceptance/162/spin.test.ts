// AC12 #162.d814f153: "A layer a driver spins 720° over 2 s exports rotation keys that increase monotonically from 0 to
// 720 at every export frame; a planted exporter that wraps the angle to [−180, 180] fails, naming the frame"
//
// The spinner: a square whose rotation a driver sets to 360 × min(t, 2) degrees, at 30 fps for 2.5 s, so its turn runs
// from 0 at frame 0 to 720 at frame 60 and holds there. The judge reads the layer's rotation keys: one at every export
// frame from 0 to 60, rising at each, 0 at the first and 720 at frame 60, each equal to the evaluated rotation within
// 1e-4°; past frame 60 they hold. Wrapped to [−180, 180], frame 16's 192° is written as −168°, below frame 15's 180°.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, FULL, TIMEOUT, evalCall, exportedOf, failsNaming, film, isKeyed, item, keysOf, layerNamed, lottieExport, none, readLottie, showRun, useShow, useTemp,
  valueAt, valuesOf, type JsonObject, type Planted,
} from './helpers.ts';

const shows = useShow([FULL]);
const temp = useTemp();
const RATE: [number, number] = [30, 1];
const FRAMES = 75;
const PATH = 'items/spinner/at/rot/2';

function spinDoc(evidence: string): JsonObject {
  return film(evidence, {
    id: 'spin', size: [320, 180], rate: RATE, frames: FRAMES,
    items: [item('spinner', 'rect@1', 'Spinner', 'a02', { box: [-20, -20, 40, 40], paint: { fill: { role: 'accent' } } }, { at: { pos: [160, 90, 0] } })],
    drivers: { spin: { target: PATH, expr: '360 * min(t, 2)', vars: { t: 'time' } } },
  });
}
function exportSpin(planted?: Planted): { anim: JsonObject; evaluated: number[] } {
  const evidence = temp(); const dir = temp(); const out = join(dir, 'spin.json');
  const frames = Array.from({ length: FRAMES }, (_, k) => k);
  const replies = showRun(shows.bin(FULL), evidence, [spinDoc(evidence)], [lottieExport(0, out), ...frames.map((k) => evalCall(0, (k * 705_600_000) / RATE[0], [PATH]))], 'the spinner', planted);
  exportedOf(replies[0]!, planted ? `the spinner (planted ${planted})` : 'the spinner');
  return { anim: readLottie(out, 'the spinner'), evaluated: frames.map((k) => valuesOf(replies[1 + k]!, [PATH], `eval at frame ${k}`)[0]!) };
}
/** The judge: the spinner's rotation keys, frame by frame (each failure names its frame). */
function judgeTurn(anim: JsonObject, evaluated: number[]): string[] {
  const r = (layerNamed(anim, 'Spinner', 'the spinner').layer['ks'] as JsonObject | undefined)?.['r'];
  if (!isKeyed(r)) return ['frame 0: the spinner\'s rotation is not keyed'];
  const at = new Map(keysOf(r).map((k) => [Number(k['t']), k]));
  const failures: string[] = [];
  let last = -Infinity;
  for (let k = 0; k <= 60; k++) {
    if (!at.has(k)) { failures.push(`frame ${k}: no rotation key`); continue; }
    const v = valueAt(r, k)[0]!;
    if (Math.abs(v - evaluated[k]!) > 1e-4) failures.push(`frame ${k}: the rotation key is ${v}°, the evaluated rotation ${evaluated[k]}°`);
    if (k > 0 && !(v > last)) failures.push(`frame ${k}: the rotation key ${v}° doesn't rise from frame ${k - 1}'s ${last}°`);
    last = v;
  }
  const v0 = valueAt(r, 0)[0]!; const v60 = valueAt(r, 60)[0]!;
  if (Math.abs(v0) > 1e-4) failures.push(`frame 0: the rotation starts at ${v0}°, not 0`);
  if (Math.abs(v60 - 720) > 1e-4) failures.push(`frame 60: the rotation reaches ${v60}°, not 720`);
  for (let k = 61; k < FRAMES; k++) if (Math.abs(valueAt(r, k)[0]! - 720) > 1e-4) failures.push(`frame ${k}: the rotation is ${valueAt(r, k)[0]!}°, not held at 720`);
  return failures;
}

describe(`${AC[12]} a driver's 720° over 2 s exports rotation keys rising from 0 to 720 at every export frame`, () => {
  it(`${AC[12]} the spinner's rotation is keyed at every export frame, rising from 0 to 720 at frame 60, each within 1e-4° of the evaluated turn`, () => {
    const { anim, evaluated } = exportSpin();
    none(judgeTurn(anim, evaluated), 'the spinner\'s rotation keys');
  }, TIMEOUT);

  it(`${AC[12]} a planted exporter that wraps the angle to [−180, 180] fails, naming frame 16`, () => {
    const { anim, evaluated } = exportSpin('lottie_wraps_rotation');
    const failures = judgeTurn(anim, evaluated);
    failsNaming(failures, /^frame 16:/, 'the exporter that wraps the angle');
    expect(failures.filter((f) => /^frame (\d|1[0-5]):/.test(f)), 'no frame before 16 fails: the wrap first shows at 192°').toEqual([]);
  }, TIMEOUT);
});
