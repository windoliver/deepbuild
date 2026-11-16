// AC6 #903.772321ac: "An export of the tour (#501) at 1920 × 1080 shows the pointer in its frames, with the same pixel
// hash seeked and played on the reference Mac. With `pointer.show: false` no pointer pixel draws."
//
// Through `deep-show run`: #501's `export` (a png_seq, decoded here) and #1897's `determinism` (same machine: each
// time's canonical render hashed on the GPU, played and seeked). The fixture is the tour board, a 1920 × 1080 u figure of
// 10 s at 12 frames a second (120 frames; the keys at 2 s, 4 s and 8 s are frames 24, 48 and 96), presented twice: with
// the pointer at its defaults, and with `tour.pointer: {show: false}`. No one gives input to an export or to
// `determinism`, so the tour plays from the start (README: Readings). The board is flat rectangles on whole pixels:
// the ground (role `ground`), the slider's track (`accent`), and the two buttons and the thumb (`muted`).
//
// asserts:
//   - both exports record 1920 × 1080 at 12/1 with 120 frame hashes, and write 120 PNGs of that size;
//   - with `pointer.show: false`, at each key's frame every pixel 2 px or more from a rectangle's edge has exactly the
//     color most of its rectangle has (no pointer pixel draws), the thumb being where the tour's keys put it: at 0.5 at
//     2 s, 0 at 4 s, 1 at 8 s; and the board shows: the ground, the track and the buttons differ in color, and the thumb is the buttons' color;
//   - with the pointer shown, each of those frames differs from its twin, and some differing pixel lies within 4 px of
//     that key's anchor: (420, 390), (800, 540), (1500, 790);
//   - `determinism` at 2, 3.75, 4, 5, 6, 7.75, 8 and 8.15 s (the keys, both glides, the ride and the toggle's ring):
//     the played and the seeked pixel hash are equal at each; at each key the hash differs from the hidden twin's, so
//     the pointer is in what was hashed. Off a reference Mac the result is INCONCLUSIVE, after every hash was compared.
// Wrong programs: the base (its check refuses a document's `tour`); an export without the tour or its pointer; a
// pointer drawn away from its control; one that ignores `show`; one whose pixels depend on the frames drawn before.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, BOARD, DOC, FLICKS, TIMEOUT, arr, at, decodePng, fl, gainAt, gate, inconclusive, none, num, obj, pngFrames, prebuild, present, presented, receiptOf,
  referenceMacProblem, runShow, scenario, show, str, thumb, tourBoard, useTemp, type Image, type JsonObject, type Pt, type Rect,
} from './helpers.ts';

prebuild('deep-show');
const temp = useTemp();
const SHOWN = DOC(61);
const HIDDEN = DOC(62);
const documents = (): JsonObject[] => [present(SHOWN, tourBoard('tour-film')), present(HIDDEN, tourBoard('tour-film-hidden', { pointer: { show: false } }))];
/** The film's frame: 1/12 s. */
const FRAME = FLICKS / 12;
const KEYS: { s: number; frame: number; control: string; anchor: Pt }[] = [
  { s: 2, frame: 24, control: 'fire', anchor: BOARD.fire.anchor },
  { s: 4, frame: 48, control: 'gain', anchor: thumb(0) },
  { s: 8, frame: 96, control: 'lamp', anchor: BOARD.lamp.anchor },
];

/** The board's rectangles at `s` seconds, bottom to top. */
function rectangles(s: number): { name: string; box: Rect }[] {
  const [cx, cy] = thumb(gainAt(s));
  const half = BOARD.knob.size / 2;
  return [
    { name: 'ground', box: [0, 0, ...BOARD.size] }, { name: 'fire-button', box: BOARD.fire.box }, { name: 'lamp-button', box: BOARD.lamp.box },
    { name: 'gain-track', box: BOARD.track.box }, { name: 'knob', box: [cx - half, cy - half, BOARD.knob.size, BOARD.knob.size] },
  ];
}
const inside = ([x, y, w, h]: Rect, px: number, py: number, grow: number): boolean => px >= x - grow && px <= x + w + grow && py >= y - grow && py <= y + h + grow;
/** The topmost rectangle holding pixel (x, y), or null within 2 px of any rectangle's edge. */
function rectangleAt(list: { name: string; box: Rect }[], x: number, y: number): string | null {
  let top: string | null = null;
  for (const r of list) {
    if (inside(r.box, x + 0.5, y + 0.5, 2) && !inside(r.box, x + 0.5, y + 0.5, -2)) return null;
    if (inside(r.box, x + 0.5, y + 0.5, 0)) top = r.name;
  }
  return top;
}
const rgb = (im: Image, x: number, y: number): number => { const o = (y * im.width + x) * 4; return (im.rgba[o]! << 16) | (im.rgba[o + 1]! << 8) | im.rgba[o + 2]!; };
const hex = (c: number): string => `#${c.toString(16).padStart(6, '0')}`;
/** A frame with no pointer: each rectangle's flat color (the color most of its pixels have), and the pixels that have another. */
function flat(im: Image, s: number): { colors: Map<string, number>; off: number; first: string } {
  const list = rectangles(s);
  const counts = new Map<string, Map<number, number>>();
  const names: (string | null)[] = new Array<string | null>(im.width * im.height);
  for (let y = 0; y < im.height; y++) for (let x = 0; x < im.width; x++) {
    const name = rectangleAt(list, x, y);
    names[y * im.width + x] = name;
    if (name === null) continue;
    const of = counts.get(name) ?? new Map<number, number>();
    const c = rgb(im, x, y);
    of.set(c, (of.get(c) ?? 0) + 1);
    counts.set(name, of);
  }
  const colors = new Map<string, number>();
  for (const [name, of] of counts) colors.set(name, [...of.entries()].sort((a, b) => b[1] - a[1])[0]![0]);
  let off = 0; let first = '';
  for (let y = 0; y < im.height; y++) for (let x = 0; x < im.width; x++) {
    const name = names[y * im.width + x];
    if (name === null || name === undefined) continue;
    const c = rgb(im, x, y);
    if (c === colors.get(name)) continue;
    if (off++ === 0) first = `(${x}, ${y}) in ${name} is ${hex(c)}, not its flat ${hex(colors.get(name)!)}`;
  }
  return { colors, off, first };
}
/** The pixels where two frames differ: how many, and how near the nearest comes to `anchor`, px. */
function differs(a: Image, b: Image, anchor: Pt): { count: number; nearest: number } {
  let count = 0; let nearest = Infinity;
  for (let y = 0; y < a.height; y++) for (let x = 0; x < a.width; x++) {
    if (rgb(a, x, y) === rgb(b, x, y)) continue;
    count++;
    nearest = Math.min(nearest, Math.hypot(x + 0.5 - anchor[0], y + 0.5 - anchor[1]));
  }
  return { count, nearest };
}

interface Side { play: string; seek: string }
/** A same-machine `determinism` reply (#1897): each time's played and seeked GPU pixel hash. */
function hashes(reply: JsonObject | undefined, times: number[], what: string): Side[] {
  const r = obj(reply, `${what}: the determinism reply`);
  if (r['outcome'] === 'refused') gate(r, what);
  expect(r['outcome'], `${what} is compared: ${show(r, 800)}`).toBe('compared');
  const frames = arr(r['frames'], `${what}: frames`).map((v, i) => {
    const f = obj(v, `${what}: frames[${i}]`);
    const side = (k: string): string => {
      const h = str(obj(f[k], `${what}: frames[${i}].${k}`)['pixel_hash'], `${what}: frames[${i}].${k}.pixel_hash`);
      expect(h, `${what}: frames[${i}].${k}.pixel_hash is 16 bytes in lower-case hex`).toMatch(/^[0-9a-f]{32}$/);
      return h;
    };
    return { t: num(f['t'], `${what}: frames[${i}].t`), play: side('play'), seek: side('seek') };
  });
  expect(frames.map((f) => f.t), `${what}: one comparison per time asked`).toEqual(times);
  return frames;
}

describe(`${AC[6]} an export of the tour shows the pointer`, () => {
  it(`${AC[6]} an export of the tour at 1920 × 1080 shows the pointer in its frames at each key's anchor, and with pointer.show false no pointer pixel draws`, () => {
    const out = temp();
    const exportOf = (doc: string, name: string): JsonObject => ({ call: 'export', doc, out: join(out, name), video: { codec: 'png_seq' } });
    const [a, b, shown, hidden] = runShow(scenario(temp(), [SHOWN, HIDDEN], [...documents(), exportOf(SHOWN, 'shown'), exportOf(HIDDEN, 'hidden')]), 'the tour board exported with its pointer shown and hidden');
    presented(a, 'the tour board');
    presented(b, 'the tour board with pointer.show false');
    const frames = [['shown', shown] as const, ['hidden', hidden] as const].map(([name, reply]) => {
      const receipt = receiptOf(reply, `the export with the pointer ${name}`);
      expect([receipt.size, receipt.frame_rate, receipt.frame_hashes.length], `the export with the pointer ${name} records 1920 × 1080 at 12/1 with 120 frames`).toEqual([[1920, 1080], [12, 1], 120]);
      const files = pngFrames(join(out, name), `the export with the pointer ${name}`);
      expect(files.length, `the export with the pointer ${name} wrote 120 PNGs`).toBe(120);
      return files;
    });
    const failures: string[] = [];
    for (const k of KEYS) {
      const where = `frame ${k.frame} (${k.s} s, the key on ${k.control})`;
      const [withPointer, without] = [decodePng(frames[0]![k.frame]!), decodePng(frames[1]![k.frame]!)];
      expect([[withPointer.width, withPointer.height], [without.width, without.height]], `${where} is 1920 × 1080 in both exports`).toEqual([[1920, 1080], [1920, 1080]]);
      const f = flat(without, k.s);
      const c = (name: string): number | undefined => f.colors.get(name);
      if (new Set([c('ground'), c('fire-button'), c('gain-track')]).size !== 3 || c('lamp-button') !== c('fire-button') || c('knob') !== c('fire-button')) {
        failures.push(`${where} with pointer.show false doesn't show the board: its rectangles' colors are ${show(Object.fromEntries([...f.colors].map(([n, v]) => [n, hex(v)])))}`);
      }
      if (f.off) failures.push(`${where} with pointer.show false: ${f.off} pixels are not their rectangle's flat color, so something else draws; the first: ${f.first}`);
      const d = differs(withPointer, without, k.anchor);
      if (d.count === 0) failures.push(`${where}: the frame with the pointer shown equals the frame with it hidden, so the export shows no pointer`);
      else if (d.nearest > 4) failures.push(`${where}: the pointer's ${d.count} pixels come no nearer than ${+d.nearest.toFixed(2)} px to ${k.control}'s anchor ${at(k.anchor)}`);
    }
    none(failures, 'the pointer in the exported frames');
  }, TIMEOUT);

  it(`${AC[6]} the film's pixel hash is the same seeked and played, on the reference Mac`, () => {
    const times = [2, 3.75, 4, 5, 6, 7.75, 8, 8.15].map(fl);
    const keyTimes = KEYS.map((k) => k.frame * FRAME);
    const check = (doc: string, at_times: number[]): JsonObject => ({ call: 'determinism', doc, display_hz: 60, at_times, compare: 'same_machine' });
    const [a, b, shown, hidden] = runShow(scenario(temp(), [SHOWN, HIDDEN], [...documents(), check(SHOWN, times), check(HIDDEN, keyTimes)]), 'the tour board seeked and played');
    presented(a, 'the tour board');
    presented(b, 'the tour board with pointer.show false');
    const withPointer = hashes(shown, times, 'the tour board with its pointer');
    const without = hashes(hidden, keyTimes, 'the tour board with pointer.show false');
    const failures = withPointer.flatMap((f, i) => (f.play === f.seek ? [] : [`at ${times[i]! / FLICKS} s seeking to it hashes ${f.seek}, playing to it ${f.play}`]));
    keyTimes.forEach((t, i) => {
      if (withPointer[times.indexOf(t)]!.seek === without[i]!.seek) failures.push(`at ${t / FLICKS} s the hash with the pointer shown equals the hash with it hidden, so no pointer was hashed`);
    });
    none(failures, 'seek against play by the GPU pixel hash');
    const problem = referenceMacProblem();
    if (problem) inconclusive(`the hashes agree here, but the criterion counts on a reference Mac; ${problem}`);
  }, TIMEOUT);
});
