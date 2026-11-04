// AC5 #421.d9173e82: A status binding on a 3D object draws its stroke as an outline around the object in the exact
// status color after tone mapping, and one that names the object's fill slot is refused naming the item.
//
// A crate (a `mark.box@1` with a grey `material@1`) on a floor, in a look with a filmic tone map one stop up, has its
// stroke slot bound to a verdict in state fail (Status binding: on a 3D object a binding takes its stroke slot, drawn
// as an outline around it). Drawn by #378's `view3d` with #382's `states`: the status report has one stroke mark on
// the crate, fail, in the look's exact #bf232b; in the final target, outside the legend's and the mark label's boxes,
// the pixels of exactly #bf232b number at least half the crate silhouette's boundary pixels (from the object-ID target)
// and every one lies within 8 px of that silhouette: an outline around the object, untouched by the tone map. The same
// document with the binding naming `items/crate/params/paint/fill` (binding ID `b1`, so only the target names the
// crate) is refused with `status_slot_kind`, and the refusal names the item `crate`.
// `--planted status_before_tone_map` (the outline drawn into the linear target, so the tone map tints it) fails, naming
// the crate.
// Wrong programs: an outline tinted by tone mapping, exposure or fog; a status color drawn as the object's fill, or
// nowhere; a fill binding accepted, or refused without naming the item (the base names only the binding's path).
import { describe, expect, it } from 'vitest';
import {
  AC, FILMIC_LOOK, STATUS, answered, box, camera, failsNaming, frameAt, framesOf, fromHex, grow, hex, isObject, material, none, pixel, readIds,
  readPng, requireMetal, runGpu, sessionDoc, shown, str, arr, num, obj, useBins, useDir, view3dCall, writeJson,
  type GpuPlanted, type JsonObject, type JsonValue, type Rgb,
} from './helpers.ts';

const bins = useBins(['deep-gpu']);
const dir = useDir();
const SIZE: [number, number] = [640, 400];
const FAIL = fromHex(STATUS['fail']!);
const VERDICT = 'verdict:01JB4210000000000000000421';
const RING = 8;

function crateDoc(slot: 'stroke' | 'fill' | null): JsonObject {
  const doc = sessionDoc(`crate-421-${slot ?? 'bare'}`, SIZE, {
    cam: camera([3, 2.5, 5], [0, 0.6, 0], 40),
    grey: material({ base_color: [0.45, 0.45, 0.45, 1], roughness: 0.5 }),
    floor: box([10, 0.1, 10], { pos: [0, -0.05, 0] }, { material: 'grey' }),
    crate: box([1.4, 1.2, 1.4], { pos: [0, 0.6, 0], rot: [0, 20, 0] }, { material: 'grey' }),
    sun: { kind: 'light.sun@1', params: { illuminance: 2000 }, at: { rot: [-50, 30, 0] } },
  });
  if (slot) doc['status_bindings'] = { b1: { target: `items/crate/params/paint/${slot}`, source: VERDICT } };
  return doc;
}

/** The legend's and mark labels' boxes (#382's report), grown 2 px: they may hold the fail color anywhere. */
function owned(reply: JsonObject, w: number, h: number): { mask: Uint8Array; marks: { item: string; slot: string; state: string; color: Rgb }[] } {
  const s = obj(reply['status'], 'the status report');
  const boxes: number[][] = [];
  const boxOf = (v: JsonValue | undefined): void => { if (Array.isArray(v)) boxes.push(v.map((x, i) => num(x, `a box[${i}]`))); };
  const marks = arr(s['marks'], 'status.marks').map((v) => {
    const m = obj(v, 'a mark');
    boxOf(m['label']);
    return { item: str(m['item'], 'mark.item'), slot: str(m['slot'], 'mark.slot'), state: str(m['state'], 'mark.state'), color: arr(m['color'], 'mark.color').map((x) => num(x, 'a channel')) as Rgb };
  });
  for (const e of arr(s['legend'] ?? [], 'status.legend')) if (isObject(e)) { boxOf(e['swatch']); boxOf(e['label']); }
  const mask = new Uint8Array(w * h);
  for (const [x, y, bw, bh] of boxes) {
    for (let j = Math.max(0, Math.floor(y! - 2)); j < Math.min(h, Math.ceil(y! + bh! + 2)); j++)
      for (let i = Math.max(0, Math.floor(x! - 2)); i < Math.min(w, Math.ceil(x! + bw! + 2)); i++) mask[j * w + i] = 1;
  }
  return { mask, marks };
}

/** The outline check: failures as sentences naming the item. */
function outlineProblems(bin: string, out: string, planted?: GpuPlanted): string[] {
  const doc = writeJson(out, 'crate-stroke', crateDoc('stroke'));
  const [reply] = runGpu(bin, out, [view3dCall({ doc, look: FILMIC_LOOK, size: SIZE, frames: 1, capture: [0], targets: ['final', 'ids'], states: { [VERDICT]: 'fail' } })], planted);
  const f = frameAt(framesOf(reply!, 'the bound crate'), 0, 'the bound crate');
  const final = readPng(out, f.final, 'the bound crate: final');
  const ids = readIds(out, f, 'the bound crate: ids');
  const [w, h] = SIZE;
  const { mask, marks } = owned(reply!, w, h);
  const problems: string[] = [];
  const mark = marks.find((m) => m.item === 'crate');
  if (!mark || mark.slot !== 'stroke' || mark.state !== 'fail' || hex(mark.color) !== hex(FAIL)) problems.push(`crate: no stroke mark in fail's exact ${hex(FAIL)}: ${JSON.stringify(marks)}`);
  const inside = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (ids.at(x, y) === 'crate') inside[y * w + x] = 1;
  let boundary = 0;
  const edge = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x; if (!inside[i]) continue;
    if (x === 0 || y === 0 || x === w - 1 || y === h - 1 || !inside[i - 1] || !inside[i + 1] || !inside[i - w] || !inside[i + w]) { edge[i] = 1; boundary++; }
  }
  const ring = grow(edge, w, h, RING);
  let outline = 0; let away = 0; const awayAt: string[] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (mask[i] || hex(pixel(final, x, y)) !== hex(FAIL)) continue;
    if (ring[i]) outline++; else { away++; if (awayAt.length < 3) awayAt.push(`(${x}, ${y})`); }
  }
  console.log(`${AC[5]}: crate silhouette boundary ${boundary} px; ${outline} px of exact ${hex(FAIL)} around it, ${away} elsewhere`);
  if (boundary < 300) problems.push(`crate: its silhouette's boundary is only ${boundary} px; the fixture needs 300`);
  if (outline < 0.5 * boundary) problems.push(`crate: only ${outline} px of the exact ${hex(FAIL)} within ${RING} px of its silhouette, under half its ${boundary} boundary px: no outline in the exact status color after tone mapping`);
  if (away > 0) problems.push(`crate: ${away} px of the exact ${hex(FAIL)} lie more than ${RING} px from its silhouette, e.g. ${awayAt.join(', ')}`);
  return problems;
}

describe(`${AC[5]} a status binding on a 3D object`, () => {
  it(`${AC[5]} the crate's stroke binding draws an outline around it in fail's exact sRGB after a filmic tone map; the planted status_before_tone_map fails, naming the crate`, () => {
    requireMetal();
    const bin = bins.bin('deep-gpu');
    none(outlineProblems(bin, dir()), 'the status outline');
    failsNaming(outlineProblems(bin, dir(), 'status_before_tone_map'), ['crate'], 'the planted status_before_tone_map');
  }, 1_800_000);

  it(`${AC[5]} a binding that names the crate's fill slot is refused with status_slot_kind, naming the item crate`, () => {
    requireMetal();
    const out = dir();
    const doc = writeJson(out, 'crate-fill', crateDoc('fill'));
    const control = writeJson(out, 'crate-bare', crateDoc(null));
    const [reply, bare] = runGpu(bins.bin('deep-gpu'), out, [
      view3dCall({ doc, look: FILMIC_LOOK, size: SIZE, frames: 1, states: { [VERDICT]: 'fail' } }),
      view3dCall({ doc: control, look: FILMIC_LOOK, size: SIZE, frames: 1 }),
    ]);
    answered(bare!, 'the same crate without the binding');
    expect(reply!['code'], `the fill binding is refused with status_slot_kind: ${shown(reply)}`).toBe('status_slot_kind');
    const text = Object.entries(reply!).filter(([k]) => k !== 'code').map(([, v]) => JSON.stringify(v)).join(' ');
    expect(/(^|[^A-Za-z0-9_-])crate([^A-Za-z0-9_-]|$)/.test(text), `the refusal names the item crate: ${shown(reply)}`).toBe(true);
  }, 1_800_000);
});
