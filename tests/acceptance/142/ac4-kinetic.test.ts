// AC4 #142.648b2324: "The kinetic-type slam scales from 1.7× to 1× along 1 − e^(−10t)·cos(2π·2.2t) within 0.5% at every
// frame, sub-lines rise in 0.30 to 0.35 s, and each transition's reveal lands on its bar line within one frame"
//
// The explain.kinetic_type example, as the pack ships it, on the 2D stage (README: The examples; it holds at least one
// `explain.slam` cue, one cue with a `sub`, a tempo map and one transition that isn't a cut).
//   - The slam: for each `explain.slam` cue, its word (the one derived item whose `params.text` is the cue's `text`) is
//     read at every frame from the cue's start to the frame before its end (`items/<id>/at`). Its scale's x and y, over
//     the scale the item is written with (its derived `at.scale`, 1 when unset), must equal 1.7 − 0.7·(1 −
//     e^(−10τ)·cos(2π·2.2τ)), τ the seconds since the cue's start, within 0.5% of that value at every frame: 1.7× at the
//     start, crossing 1× near 0.114 s and ringing in to 1× (the oracle page's formula: the upstream motion code's
//     spring at 2.2 Hz and 10, a slam from 1.7 to 1 along it).
//   - The sub-lines: for each cue with a `sub`, its sub-line (the derived item whose `params.text` is the `sub`) is read
//     at every frame of its cue, start to end (`items/<id>/at/pos`; an entrance writes only inside its span, #222's cue
//     kit). It rises: it ends higher on the frame (a smaller y, 2D being y down) than it starts, and the frames over
//     which its position changes span 0.30 to 0.35 s, within one frame.
//   - The transitions: each transition the expansion writes that isn't a cut aligns on its reveal (`align: "reveal"`),
//     and its cut (the end of its `from` shot) lies on a bar line of the example's tempo map within one frame. Where a
//     reveal-aligned transition puts its reveal is criterion 5's, measured on the canvas's frames.
// Wrong programs: the base; a slam on another curve (a cubic ease, a spring at 2 Hz, from 1.5×), or offset from its cue;
// a sub-line that rises in 0.5 s or doesn't rise; a transition centred on its cut, or cut off the bar.
import { describe, expect, it } from 'vitest';
import {
  AC, FLICKS, TIMEOUT, barLines, brief, cueWindow, docId, errors, evalAt, exampleOf, expansionOf, flicksOf, frameOf, isObject, itemDrawing, none,
  present, run, scenario, showTime, spanOf, useFolders, useShow, valuesOf, type JsonObject, type JsonValue,
} from './helpers.ts';

const show = useShow();
const folder = useFolders();
const spring = (tau: number): number => 1.7 - 0.7 * (1 - Math.exp(-10 * tau) * Math.cos(2 * Math.PI * 2.2 * tau));
const scaleXY = (v: JsonValue | undefined): [number, number] | null =>
  typeof v === 'number' ? [v, v] : Array.isArray(v) && typeof v[0] === 'number' && typeof v[1] === 'number' ? [v[0], v[1]] : null;

describe(`${AC[4]} the kinetic-type slam, its sub-lines and its reveals on the bar`, () => {
  it(`${AC[4]} the slam follows the spring from 1.7× to 1× within 0.5% at every frame, sub-lines rise in 0.30 to 0.35 s, and each transition reveals on its bar line`, () => {
    const ex = exampleOf('kinetic_type');
    if (Array.isArray(ex)) return none(ex, 'the kinetic-type example');
    const [shown] = run(show(), scenario(folder(), [present(docId(1), ex.doc)]));
    expect(shown!['outcome'] === 'presented' && errors(shown!).length === 0, `the kinetic-type example is presented with no error: ${brief(shown!, 1500)}`).toBe(true);
    const e = expansionOf(shown!, ex.instance, 'the kinetic-type example');
    const frame = frameOf(ex.doc);
    const span = spanOf(ex.doc, 'the kinetic-type example');
    const failures: string[] = [];

    const slams = ex.cues.filter((c) => c['kind'] === 'explain.slam');
    const subs = ex.cues.filter((c) => typeof c['sub'] === 'string');
    if (!slams.length) failures.push('the kinetic-type example plays no explain.slam cue');
    if (!subs.length) failures.push('the kinetic-type example has no cue with a sub-line');
    type Read = { what: string; id: string; path: string; frames: number[]; start: number; end: number; base: [number, number] };
    const reads: Read[] = [];
    for (const c of slams) {
      const id = String(c['id']);
      const w = cueWindow(e, id, 'the kinetic-type example');
      const found = itemDrawing(e, String(c['text']));
      if ('why' in found) { failures.push(`slam ${id}: ${found.why}`); continue; }
      const at = e.derived[found.id]!['at'];
      const base = scaleXY(isObject(at) ? at['scale'] : undefined) ?? [1, 1];
      const frames: number[] = [];
      for (let k = Math.ceil(w.start / frame); k * frame < w.end; k++) frames.push(k * frame);
      reads.push({ what: `slam ${id}`, id: found.id, path: `items/${found.id}/at`, frames, start: w.start, end: w.end, base });
    }
    for (const c of subs) {
      const id = String(c['id']);
      const w = cueWindow(e, id, 'the kinetic-type example');
      const found = itemDrawing(e, String(c['sub']));
      if ('why' in found) { failures.push(`sub-line of ${id}: ${found.why}`); continue; }
      const frames: number[] = [];
      for (let k = Math.ceil(w.start / frame); k * frame <= w.end; k++) frames.push(k * frame);
      reads.push({ what: `sub-line of ${id}`, id: found.id, path: `items/${found.id}/at/pos`, frames, start: w.start, end: w.end, base: [1, 1] });
    }

    const calls: JsonObject[] = [present(docId(1), ex.doc)];
    const first: number[] = [];
    for (const r of reads) { first.push(calls.length); for (const t of r.frames) calls.push(evalAt(docId(1), t, { paths: [r.path] })); }
    const replies = run(show(), scenario(folder(), calls));
    reads.forEach((r, i) => {
      const values = r.frames.map((t, k) => valuesOf(replies[first[i]! + k]!, `${r.what} at ${showTime(t)}`)[r.path]);
      if (r.what.startsWith('slam')) {
        r.frames.forEach((t, k) => {
          const tau = (t - r.start) / FLICKS;
          const want = spring(tau);
          const got = scaleXY(isObject(values[k]) ? values[k]['scale'] : undefined);
          if (!got) { failures.push(`${r.what} at ${showTime(t)}: no scale in ${brief(values[k] ?? null, 200)}`); return; }
          for (const [axis, g, b] of [['x', got[0], r.base[0]], ['y', got[1], r.base[1]]] as const) {
            const ratio = g / b;
            if (Math.abs(ratio - want) > 0.005 * want) failures.push(`${r.what} at τ = ${tau.toFixed(4)} s: scale ${axis} is ${ratio.toFixed(5)}×, the spring gives ${want.toFixed(5)}× (off by ${((100 * Math.abs(ratio - want)) / want).toFixed(2)}%)`);
          }
        });
      } else {
        const ys = values.map((v) => (Array.isArray(v) && typeof v[1] === 'number' ? v[1] : NaN));
        if (ys.some((y) => Number.isNaN(y))) { failures.push(`${r.what}: no position y in ${brief(values.slice(0, 3) as JsonValue[], 300)}`); return; }
        const moved = ys.map((y, k) => k > 0 && Math.abs(y - ys[k - 1]!) > 1e-9);
        const a = moved.indexOf(true); const b = moved.lastIndexOf(true);
        if (a < 0) { failures.push(`${r.what}: it doesn't move over its cue`); return; }
        const seconds = ((b - a + 1) * frame) / FLICKS;
        const slack = frame / FLICKS;
        if (seconds < 0.3 - slack || seconds > 0.35 + slack) failures.push(`${r.what}: it moves over ${seconds.toFixed(3)} s (${showTime(r.frames[a - 1]!)} to ${showTime(r.frames[b]!)}), not 0.30 to 0.35 s`);
        if (!(ys[ys.length - 1]! < ys[0]!)) failures.push(`${r.what}: it ends at y ${ys[ys.length - 1]}, not above where it starts (y ${ys[0]})`);
      }
    });

    const bars = barLines(ex.doc['tempo_map'], span + frame);
    if (!bars) failures.push(`the kinetic-type example has no readable tempo map, so no bar lines: ${brief(ex.doc['tempo_map'] ?? null)}`);
    const revealing = Object.entries(e.transitions).filter(([, tr]) => tr['kind'] !== 'cut');
    if (!revealing.length) failures.push(`the kinetic-type example's expansion writes no transition but cuts: ${brief(e.transitions, 600)}`);
    for (const [id, tr] of revealing) {
      if (tr['align'] !== 'reveal') failures.push(`transition ${id} (${String(tr['kind'])}) aligns ${brief(tr['align'] ?? null)}, not on its reveal`);
      const from = e.shots[String(tr['from'])];
      const cut = from ? flicksOf(from['end'], frame) : null;
      if (cut === null) { failures.push(`transition ${id}: its from shot ${String(tr['from'])} has no end time in the expansion's shots`); continue; }
      const near = bars ? Math.min(...bars.map((b) => Math.abs(b - cut))) : Infinity;
      if (near > frame) failures.push(`transition ${id}: its cut at ${showTime(cut)} is ${showTime(Math.round(near))} from the nearest bar line`);
    }
    none(failures, 'the slam, the sub-lines and the reveals of the kinetic-type example');
  }, 2 * TIMEOUT);
});
