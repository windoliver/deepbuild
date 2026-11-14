// AC1 #466.409171e5: A pack's composed mosaic transition aligns on its reveal within one frame, is refused if it reads
// an earlier frame, and costs within 25% of its declaration.
//
// Through `deep-gpu run` (#377's scenarios): `view3d` (#378, with #429's `packs` and #462's `looks` and shot looks) draws
// a 320 × 180 scene whose camera faces a wall that fills the frame, in two shots that differ only in their look (the
// wall `body` warm in look a, blue in look b), joined by a 1 s transition of kind operator naming the test pack's
// `mosaic.dissolve@1` (fixtures/packs/test-mosaic-1.0.0) with `align: reveal` and linear progress. The pack's graph shows
// the incoming side in a seeded share of its 64 × 64 cells that runs as progress squared, so its coverage reaches half
// at progress √½, 0.707 of the window, not at the window's middle. Frames 60 to 150 (1 s to 2.5 s at 60 fps) are read
// back; each pixel counts as the incoming side when it is nearer look b's wall than look a's. The reveal is the first
// frame at least half incoming; it must be the cut's frame (2 s, frame 120) within one frame.
//   - The planted `mosaic_reveal_by_progress` aligns progress 0.5 on the cut instead of the operator's coverage: the
//     reveal then lands about 0.2 s late, and the judge fails, naming the transition `mz`.
//   - The twin pack test-mosaic-history-1.0.0 mixes in its own output of the frame before (input `last_frame`): the
//     document naming it is refused before any frame is drawn, and the refusal names `last_frame`.
//   - Cost: `check_operator` (#380, with #429's `estimate_ns`) on the pack's graph accepts it and estimates it within
//     25% of its declared 0.015 ns a pixel; the same graph declaring 0.006 is refused `cost_understated`. The measured
//     leg (the estimate held to the GPU's time) is the release calibration run's (#429), not run here (README).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checkCall, checked, run, useBins, useOut, view3dFrames, writeJson, type Planted as GpuPlanted } from '../429/helpers.ts';
import { look3, readPng, type Image } from '../382/helpers.ts';
import { AC, FIXTURES, TIMEOUT, failsNaming, inconclusive, none, show, type JsonObject, type Planted } from './helpers.ts';
import { join } from 'node:path';

const bins = useBins();
const out = useOut();
const FPS = 60;
const FIRST = 60;
const LAST = 150;
const CUT = 120;
const WALL: Record<'a' | 'b', [number, number, number]> = { a: [240, 210, 130], b: [60, 110, 200] };
const PACKS = {
  clean: { id: 'test/mosaic', dir: join(FIXTURES, 'packs', 'test-mosaic-1.0.0'), op: 'mosaic.dissolve@1' },
  history: { id: 'test/mosaic-history', dir: join(FIXTURES, 'packs', 'test-mosaic-history-1.0.0'), op: 'mosaic-history.dissolve@1' },
} as const;

const looks = (): Record<string, JsonObject> => ({ a: look3('mosaic-a', { body: WALL.a }) as JsonObject, b: look3('mosaic-b', { body: WALL.b }) as JsonObject });

/** The scene: a camera on +Z 7 m from (0, 0.5, 0), a sun along −Z, a 12 × 8 m wall filling the frame; two shots in looks a and b. */
function mosaicDoc(pack: keyof typeof PACKS): JsonObject {
  const pose = { move: 'hold', target: [0, 0.5, 0], orbit: { azimuth: 0, elevation: 0, distance: 7 } };
  const items: Record<string, JsonObject> = {
    cam: { kind: 'camera@1', params: { projection: 'perspective', target: [0, 0.5, 0], orbit: { azimuth: 0, elevation: 0, distance: 7 }, fov: 40, near: 0.1 } },
    sun: { kind: 'light.sun@1', params: { illuminance: Math.PI, shadow: false, angle: 0.53 }, at: { rot: [0, 0, 0] } },
    wall: { kind: 'mark.box@1', params: { size: [12, 8, 0.2], paint: { fill: { role: 'body' } } }, at: { pos: [0, 0.5, 0] } },
  };
  let k = 0;
  const withIds = Object.fromEntries(Object.entries(items).map(([id, item]) => [id, { id, name: id, order: `a${k++}`, layer: 'main', ...item }]));
  return {
    format: 1, id: `mosaic-${pack}`, profile: 'scene', title: 'A mosaic transition between two looks', description: 'Two shots of one wall in two looks, joined by a pack\'s mosaic dissolve aligned on its reveal.',
    size: [320, 180], seed: 466, camera: 'cam', requires: { modules: { scene3d: '^1', effects: '^1' } },
    layers: { main: { writer: 'agent-a', title: 'Main', order: 'a0' } }, transport: { span: '4s' },
    packs: [`${PACKS[pack].id}@1.0.0`],
    shots: { a: { start: '0s', end: '2s', camera: 'cam', ...pose, look: 'a' }, b: { start: '2s', end: '4s', camera: 'cam', ...pose, look: 'b' } },
    transitions: { mz: { from: 'a', to: 'b', kind: 'operator', operator: { op: PACKS[pack].op, reads: ['outgoing', 'incoming', 'progress'] }, span: '1s', align: 'reveal', progress: 'linear' } },
    items: withIds,
  };
}
const viewCall = (dir: string, pack: keyof typeof PACKS): JsonObject => {
  const l = looks();
  return {
    call: 'view3d', doc: writeJson(dir, `mosaic-${pack}.json`, mosaicDoc(pack)), look: l['a']!, looks: l, size: [320, 180], fps: FPS, from: FIRST, frames: LAST - FIRST + 1,
    capture: 'every', targets: ['final'], packs: [{ id: PACKS[pack].id, dir: PACKS[pack].dir }],
  };
};
const gpuOnly = (): void => { if (process.platform !== 'darwin') inconclusive(`the GPU layer draws on macOS's Metal device; this is ${process.platform}`); };

/** The share of a picture's pixels nearer look b's wall than look a's. */
function incomingShare(img: Image): number {
  let n = 0;
  for (let o = 0; o < img.rgba.length; o += 4) {
    const d = (c: readonly number[]): number => (img.rgba[o]! - c[0]!) ** 2 + (img.rgba[o + 1]! - c[1]!) ** 2 + (img.rgba[o + 2]! - c[2]!) ** 2;
    if (d(WALL.b) < d(WALL.a)) n++;
  }
  return n / (img.width * img.height);
}

/** The reveal's frame against the cut's, each failure naming the transition. */
function revealFailures(planted?: Planted): string[] {
  gpuOnly();
  const dir = out();
  const [reply] = run(bins.bin(), dir, [viewCall(dir, 'clean')], planted as GpuPlanted | undefined);
  if (reply!['code'] === 'unsupported_platform') inconclusive('view3d reports unsupported_platform');
  const frames = view3dFrames(reply!, 'the mosaic film');
  const share = new Map<number, number>();
  for (const f of frames) share.set(f.frame, incomingShare(readPng(dir, f.final, `the mosaic film's frame ${f.frame}`)));
  const failures: string[] = [];
  for (let n = FIRST; n <= LAST; n++) if (!share.has(n)) failures.push(`transition mz: frame ${n} is missing from the reply`);
  if (failures.length) return failures;
  if (share.get(FIRST)! > 0.01) failures.push(`transition mz: frame ${FIRST} (1 s), before any window could open, is already ${(share.get(FIRST)! * 100).toFixed(1)}% incoming`);
  if (share.get(LAST)! < 0.99) failures.push(`transition mz: frame ${LAST} (2.5 s) is only ${(share.get(LAST)! * 100).toFixed(1)}% incoming: the dissolve never finishes`);
  const reveal = [...share.entries()].sort((p, q) => p[0] - q[0]).find(([, s]) => s >= 0.5)?.[0];
  if (reveal === undefined) failures.push('transition mz: no frame is half incoming');
  else if (Math.abs(reveal - CUT) > 1) failures.push(`transition mz: the reveal, the first frame at least half incoming, is frame ${reveal} (${(reveal / FPS).toFixed(4)} s), not within one frame of the cut's frame ${CUT} (2 s); shares around it: ${[reveal - 2, reveal - 1, reveal, reveal + 1].map((n) => `${n}: ${((share.get(n) ?? NaN) * 100).toFixed(1)}%`).join(', ')}`);
  return failures;
}

describe(`${AC[1]} a pack's composed mosaic transition: reveal, earlier frames and cost`, () => {
  it(`${AC[1]} the mosaic dissolve aligned on its reveal is half incoming first on the cut's frame, within one frame`, () => {
    none(revealFailures(), 'the mosaic transition\'s reveal');
  }, TIMEOUT);

  it(`${AC[1]} (planted) a reveal aligned by progress rather than the operator's coverage misses the cut and fails, naming the transition`, () => {
    failsNaming(revealFailures('mosaic_reveal_by_progress'), ['transition mz'], 'the planted mosaic_reveal_by_progress');
  }, TIMEOUT);

  it(`${AC[1]} a transition whose pack graph reads an earlier frame is refused, naming the input, while the clean pack draws`, () => {
    gpuOnly();
    const dir = out();
    const [clean, history] = run(bins.bin(), dir, [{ ...viewCall(dir, 'clean'), frames: 1, capture: [] }, { ...viewCall(dir, 'history'), frames: 1, capture: [] }]);
    if (clean!['code'] === 'unsupported_platform') inconclusive('view3d reports unsupported_platform');
    expect(clean!['code'], `the clean pack's transition is drawn: ${show(clean)}`).toBeUndefined();
    expect(Array.isArray(clean!['frames']) && (clean!['frames'] as unknown[]).length === 1, 'the clean pack\'s film draws its frame').toBe(true);
    expect(typeof history!['code'], `the twin pack's transition is refused: ${show(history)}`).toBe('string');
    expect(Array.isArray(history!['frames']) && (history!['frames'] as unknown[]).length > 0, 'the refused document draws no frame').toBe(false);
    expect(JSON.stringify(history), `the refusal names the input that reads an earlier frame, last_frame: ${show(history)}`).toContain('last_frame');
  }, TIMEOUT);

  it(`${AC[1]} the check estimates the pack's graph within 25% of its declared cost, and refuses a declaration the estimate exceeds by more than 25%`, () => {
    const pack = JSON.parse(readFileSync(join(PACKS.clean.dir, 'pack.json'), 'utf8')) as { operators: Record<string, JsonObject> };
    const op = pack.operators[PACKS.clean.op]!;
    const declared = (op['cost'] as { ns_per_px: number }).ns_per_px;
    const dir = out();
    const [fair, under] = run(bins.bin(), dir, [checkCall(op), checkCall({ ...op, cost: { ns_per_px: 0.006 } })]);
    const c = checked(fair!, 'check_operator on mosaic.dissolve@1');
    expect(c.outcome, `the pack's graph passes the check: ${show(fair)}`).toBe('accepted');
    expect(c.estimate, 'the check reports its estimate, estimate_ns').not.toBeNull();
    const off = Math.abs(c.estimate! - declared) / declared;
    expect(off, `the estimate ${c.estimate} ns a pixel is within 25% of the declared ${declared} (off by ${(off * 100).toFixed(1)}%)`).toBeLessThanOrEqual(0.25);
    const u = checked(under!, 'check_operator on mosaic.dissolve@1 declaring 0.006');
    expect(u.outcome, `a declaration of 0.006 ns a pixel is refused: ${show(under)}`).not.toBe('accepted');
    expect(u.issues.map((i) => i['code']), 'it is refused cost_understated').toContain('cost_understated');
  }, TIMEOUT);
});
