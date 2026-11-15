// AC5 #142.ee5f5cff: "A reveal-aligned push, wipe and zoom-through put the frame where the incoming side covers half the
// picture (a push: 90% of its travel) on the cut's time, within one frame"
//
// Three 2D films, 320 × 180 u at 60 fps, written by hand (no recipe: the transition is the canvas's): a camera `cam`
// over two shots, `shot_out` [0, 2 s) framing `field_out`, a field of ink, and `shot_in` [2 s, 4 s) framing
// `field_in`, a field of accent 1,000 u to the right, each field filling its shot's view; one transition between them,
// `push`, `wipe` or `zoom_through` at its defaults, span 1 s, `align: "reveal"`, its progress `in_cubic` (so a window
// centred on the cut would reveal 0.29 to 0.47 s late). The cut is at 2 s.
// Every frame from 1.0 s to 2.5 s is drawn by `eval` with `pixels`. The incoming side's cover of a frame is the mean,
// over its pixels, of where each pixel lies between the outgoing color and the incoming one (each read from the
// middle of a frame showing only that side: 0.5 s and 3.5 s), clamped to [0, 1]; for a split it is the share the
// incoming side covers, for a blend its weight. The reveal is the first frame whose cover reaches half (a push: 0.9,
// 90% of its travel). It must lie within one frame (1/60 s) of 2 s, and the cover must start under 0.05 at 1.0 s.
// Wrong programs: the base (zoom_through can't align on its reveal); a window centred or started on the cut; a push
// that reveals at half its travel; a zoom-through whose reveal is placed by a measure its frames don't show.
import { describe, expect, it } from 'vitest';
import {
  AC, FLICKS, TIMEOUT, brief, docId, evalAt, none, pictureOf, present, presented, rgbAt, run, scenario, showTime, snapshotOf, useFolders, useShow,
  type Image, type JsonObject,
} from './helpers.ts';

const show = useShow();
const folder = useFolders();
const SIZE: [number, number] = [320, 180];
const FRAME = FLICKS / 60;
const CUT = 2 * FLICKS;
const SCAN = Array.from({ length: 91 }, (_, k) => FLICKS + k * FRAME);

const rect = (id: string, box: [number, number, number, number], role: string): JsonObject =>
  ({ id, kind: 'rect@1', name: `Field ${id}`, order: `c${id}`, params: { box, paint: { fill: { role } } }, at: { pos: [0, 0, 0] } });
function transitionFilm(kind: string): JsonObject {
  return {
    format: 1, profile: 'film', title: `A reveal-aligned ${kind}`, description: `A ${kind} aligned on its reveal: a fixture film of the #142 acceptance suite.`,
    size: SIZE, camera: 'cam', transport: { span: '4s' },
    items: {
      cam: { id: 'cam', kind: 'camera@1', name: 'Camera', order: 'a0', params: { projection: 'orthographic', target: [160, 90, 0], view_width: 320 } },
      field_out: rect('field_out', [-200, -200, 720, 580], 'ink'),
      field_in: rect('field_in', [800, -200, 720, 580], 'accent'),
    },
    shots: {
      shot_out: { start: '0s', end: '2s', camera: 'cam', move: 'hold', target: [160, 90, 0], view_width: 320 },
      shot_in: { start: '2s', end: '4s', camera: 'cam', move: 'hold', target: [1160, 90, 0], view_width: 320 },
    },
    transitions: { across: { from: 'shot_out', to: 'shot_in', kind, span: '1s', align: 'reveal', progress: 'in_cubic' } },
  };
}
/** The incoming side's cover of a frame: each pixel's place between the two sides' colors, averaged. */
function cover(img: Image, a: [number, number, number], b: [number, number, number]): number {
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]; const dd = d[0]! ** 2 + d[1]! ** 2 + d[2]! ** 2;
  let sum = 0;
  for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) {
    const p = rgbAt(img, x, y);
    sum += Math.min(1, Math.max(0, ((p[0] - a[0]) * d[0]! + (p[1] - a[1]) * d[1]! + (p[2] - a[2]) * d[2]!) / dd));
  }
  return sum / (img.width * img.height);
}

describe(`${AC[5]} a reveal-aligned push, wipe and zoom-through reveal on the cut`, () => {
  it(`${AC[5]} the frame where the incoming side covers half the picture (a push: 90% of its travel) lands on the cut within one frame`, () => {
    const kinds = [['push', 0.9], ['wipe', 0.5], ['zoom_through', 0.5]] as const;
    const evidence = folder();
    const calls: JsonObject[] = [];
    kinds.forEach(([k], i) => {
      calls.push(present(docId(i + 1), transitionFilm(k)));
      for (const t of [FLICKS / 2, 3.5 * FLICKS, ...SCAN]) calls.push(evalAt(docId(i + 1), t, { pixels: true, size: SIZE }));
    });
    const replies = run(show(), scenario(evidence, calls, { packs: [] }));
    const failures: string[] = [];
    const per = 3 + SCAN.length;
    kinds.forEach(([kind, half], i) => {
      const base = i * per;
      const shown = replies[base]!;
      if (shown['outcome'] !== 'presented') { failures.push(`the ${kind} film is not presented: ${brief(shown, 1200)}`); return; }
      presented(shown, `the ${kind} film`);
      const pic = (j: number, what: string): Image => pictureOf(evidence, snapshotOf(replies[base + 1 + j]!, what), what);
      const a = rgbAt(pic(0, `${kind} at 0.5 s`), SIZE[0] / 2, SIZE[1] / 2);
      const b = rgbAt(pic(1, `${kind} at 3.5 s`), SIZE[0] / 2, SIZE[1] / 2);
      expect(Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]), `the ${kind} film's two sides draw apart (${a} and ${b})`).toBeGreaterThan(60);
      const covers = SCAN.map((t, k) => cover(pic(2 + k, `${kind} at ${showTime(t)}`), a, b));
      if (covers[0]! >= 0.05) failures.push(`${kind}: the incoming side already covers ${covers[0]!.toFixed(3)} of the frame at 1.0 s`);
      const k = covers.findIndex((c) => c >= half);
      if (k < 0) { failures.push(`${kind}: no frame from 1.0 s to 2.5 s reaches a cover of ${half}; covers ${covers.map((c) => c.toFixed(2)).join(' ')}`); return; }
      const off = SCAN[k]! - CUT;
      if (Math.abs(off) > FRAME) failures.push(`${kind}: the incoming side first covers ${half === 0.9 ? '90% (its travel)' : 'half'} of the picture at ${showTime(SCAN[k]!)}, ${(off / FRAME).toFixed(1)} frames from the cut at 2 s (cover ${covers[k]!.toFixed(3)}, the frame before ${k > 0 ? covers[k - 1]!.toFixed(3) : 'none'})`);
    });
    none(failures, 'each reveal-aligned transition reveals on the cut');
  }, TIMEOUT);
});
