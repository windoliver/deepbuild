// AC2 #162.4fcf440a: "A document with a glow pass, an inset and a sound strip exports with one warning per item it can't
// hold, naming it, and a document with a status binding is refused before anything is written"
// AC7 #162.76f8723c: "A title whose x a driver sets to 100 × sin(360° × t) exports x as linear keys at the export frame
// rate that match the evaluated x at every export frame within 1e-4 u, and its warnings list the driver's path; a group
// sorted by y whose order changes is listed as an item Lottie can't hold"
// AC8 #162.719d85b5: "A document whose only status binding is a rect's status field is refused before anything is
// written, as one with an entry in status_bindings is"
//
// Each export goes to a fresh folder, so "nothing written" is read as that folder left empty: no file under out's name
// or a temporary one. "Naming it" is the warning's `item`, the item's (or the strip's) ID. The driven x is read from the
// title's layer: its position less its anchor, the translation it gives its content, keyed or split.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, FULL, TIMEOUT, VERDICT, agentRun, channel, evalCall, exportedOf, film, glowing, isKeyed, isLinearKey, item, keysOf, layerNamed, leftIn, lottieExport,
  none, readLottie, show, showRun, toneStrip, useShow, useTemp, valueAt, valuesOf, type JsonObject,
} from './helpers.ts';

const shows = useShow([FULL]);
const temp = useTemp();

/** The document of criterion 2: a ground and a plate Lottie holds; a group `halo` running a glow pass (a composed
 * pass item `glow`) over a spark; a 3D box `panel` with an inset `screen` on its face; and a sound strip `tone`. */
function extrasDoc(evidence: string, bind = false): JsonObject {
  const sound = toneStrip(evidence, 2);
  return film(evidence, {
    id: 'extras', size: [320, 180], rate: [24, 1], frames: 48, sampleRate: 48_000,
    items: [
      item('plate', 'rect@1', 'Plate', 'a02', { box: [20, 20, 120, 40], paint: { fill: { role: 'accent' } } }),
      ...glowing([200, 30, 40, 40]),
      item('panel', 'mark.box@1', 'Panel', 'a07', { size: [1, 0.6, 0.1], paint: { fill: { role: 'raised' } } }, { at: { pos: [0, 0, 0] } }),
      item('screen', 'inset@1', 'Screen', 'a08', {
        face: 'front', size: [0.9, 0.5], px_per_unit: 200,
        content: { dot: { kind: 'rect@1', order: 'a0', params: { box: [10, 10, 40, 40], paint: { fill: { role: 'ink' } } } } },
      }, { parent: 'panel' }),
    ],
    strips: sound.strips, assets: sound.assets, requires: { modules: { effects: '^1', scene3d: '^1' } },
    ...(bind ? { extra: { status_bindings: { 'plate-state': { target: 'items/plate/params/paint/fill', source: VERDICT } } } } : {}),
  });
}

/** Criterion 8's plate: one rect, its status in its own `status` field, in an entry of status_bindings, or nowhere. */
function boundDoc(evidence: string, how: 'field' | 'entry' | 'none'): JsonObject {
  const plate = item('plate', 'rect@1', 'Plate', 'a02', { box: [20, 20, 120, 40], paint: { fill: { role: 'accent' } }, ...(how === 'field' ? { status: { source: VERDICT } } : {}) });
  return film(evidence, {
    id: `bound-${how}`, size: [320, 180], rate: [24, 1], frames: 24, items: [plate],
    ...(how === 'entry' ? { extra: { status_bindings: { 'plate-state': { target: 'items/plate/params/paint/fill', source: VERDICT } } } } : {}),
  });
}
/** A refusal before anything is written: `refused` with a code, the bound item named, out's folder empty. */
function refusedUnwritten(reply: JsonObject, dir: string, what: string): string {
  expect(reply['outcome'], `${what} is refused: ${show(reply, 1200)}`).toBe('refused');
  expect(typeof reply['code'], `${what}: the refusal has a code: ${show(reply)}`).toBe('string');
  expect(JSON.stringify(reply), `${what}: the refusal names the bound item, plate`).toContain('plate');
  expect(leftIn(dir), `${what}: nothing is written`).toEqual([]);
  return reply['code'] as string;
}

describe(`${AC[2]} one warning per item Lottie can't hold, naming it; a status binding is refused before anything is written`, () => {
  it(`${AC[2]} the glow pass, the inset and the sound strip each get one warning naming it, and the items Lottie holds none`, () => {
    const evidence = temp(); const dir = temp(); const out = join(dir, 'extras.json');
    const [reply] = showRun(shows.bin(FULL), evidence, [extrasDoc(evidence)], [lottieExport(0, out)], 'the document with a glow pass, an inset and a sound strip');
    const { warnings } = exportedOf(reply!, 'the document with a glow pass, an inset and a sound strip');
    const listed = (id: string): number => warnings.filter((w) => w.kind === 'cannot_hold' && (w.item === id || w.item === `strips/${id}`)).length;
    none(['halo', 'screen', 'tone'].filter((id) => listed(id) !== 1).map((id) => `${id}: ${listed(id)} warnings, not one`), 'the glow pass, the inset and the sound strip are each listed once');
    expect(warnings.find((w) => w.item === 'halo')?.text ?? '', 'the halo\'s warning names its pass').toMatch(/glow/);
    expect(listed('panel'), 'the 3D box the inset sits on is listed once, as 3D').toBe(1);
    none(warnings.filter((w) => w.item === 'plate' || w.item === 'back').map((w) => w.text), 'no warning for the items Lottie holds');
    readLottie(out, 'the document with a glow pass, an inset and a sound strip');
  }, TIMEOUT);

  it(`${AC[2]} the same document with a status binding is refused before anything is written`, () => {
    const evidence = temp(); const dir = temp();
    const [reply] = agentRun(shows.bin(FULL), evidence, [extrasDoc(evidence, true)], [lottieExport(0, join(dir, 'extras.json'))], 'the document with a status binding');
    refusedUnwritten(reply!, dir, 'the document with a status binding');
  }, TIMEOUT);
});

describe(`${AC[8]} a rect's status field is refused as an entry in status_bindings is`, () => {
  it(`${AC[8]} the plate whose only binding is its own status field, and the plate bound in status_bindings: both refused alike, nothing written, while the unbound plate exports`, () => {
    const evidence = temp(); const a = temp(); const b = temp(); const c = temp();
    const [plain] = agentRun(shows.bin(FULL), evidence, [boundDoc(evidence, 'none')], [lottieExport(0, join(c, 'plate.json'))], 'the unbound plate');
    exportedOf(plain!, 'the unbound plate');
    const [field] = agentRun(shows.bin(FULL), evidence, [boundDoc(evidence, 'field')], [lottieExport(0, join(a, 'plate.json'))], 'the plate bound by its status field');
    const [entry] = agentRun(shows.bin(FULL), evidence, [boundDoc(evidence, 'entry')], [lottieExport(0, join(b, 'plate.json'))], 'the plate bound in status_bindings');
    const code = refusedUnwritten(entry!, b, 'the plate bound in status_bindings');
    expect(refusedUnwritten(field!, a, 'the plate bound by its status field'), 'the status field is refused with the same code as the entry').toBe(code);
  }, TIMEOUT);
});

describe(`${AC[7]} a driven x exports as linear keys at the export frame rate, listed by the driver's path; a y-sorted group that reorders is listed`, () => {
  const RATE: [number, number] = [30, 1]; const FRAMES = 60;
  const wave = (evidence: string): JsonObject => film(evidence, {
    id: 'wave', size: [320, 180], rate: RATE, frames: FRAMES,
    items: [
      item('title', 'text@1', 'Title', 'a02', { text: 'WAVE', size: 40, paint: { fill: { role: 'ink' } } }, { at: { pos: [0, 90, 0] } }),
      item('stack', 'group@1', 'Stack', 'a03', { sort: 'y' }),
      item('up', 'rect@1', 'Up', 'a04', { box: [-10, -10, 20, 20], paint: { fill: { role: 'accent' } } }, { parent: 'stack', at: { pos: [240, 40, 0] } }),
      item('down', 'rect@1', 'Down', 'a05', { box: [-10, -10, 20, 20], paint: { fill: { role: 'ink' } } }, { parent: 'stack', at: { pos: [250, 140, 0] } }),
    ],
    drivers: { wave: { target: 'items/title/at/pos/0', expr: '100 * sin(rad(360 * t))', vars: { t: 'time' } } },
    channels: { rise: channel('items/up/at/pos/1', [[0, 40], [2, 140]]), fall: channel('items/down/at/pos/1', [[0, 140], [2, 40]]) },
  });

  it(`${AC[7]} x is keyed linearly at every export frame, within 1e-4 u of the evaluated x; the warnings list items/title/at/pos/0, and the stack as one Lottie can't hold`, () => {
    const evidence = temp(); const dir = temp(); const out = join(dir, 'wave.json');
    const frames = Array.from({ length: FRAMES }, (_, k) => k);
    const replies = showRun(shows.bin(FULL), evidence, [wave(evidence)], [lottieExport(0, out), ...frames.map((k) => evalCall(0, (k * 705_600_000) / RATE[0], ['items/title/at/pos/0']))], 'the driven title');
    const { warnings } = exportedOf(replies[0]!, 'the driven title');
    const evaluated = frames.map((k) => valuesOf(replies[1 + k]!, ['items/title/at/pos/0'], `eval at frame ${k}`)[0]!);
    const ks = (layerNamed(readLottie(out, 'the driven title'), 'Title', 'the driven title').layer['ks'] ?? {}) as JsonObject;
    const p = ks['p'] as JsonObject | undefined;
    const xProp = p && p['s'] === true ? p['x'] : p;
    expect(isKeyed(xProp), `the title's x is keyed: ${show(xProp ?? null, 400)}`).toBe(true);
    const keys = keysOf(xProp);
    const at = new Set(keys.map((k) => Number(k['t'])));
    none(frames.filter((k) => !at.has(k)).map((k) => `no x key at export frame ${k}`), 'a key at every export frame');
    none(keys.slice(0, -1).filter((k) => !isLinearKey(k, 1)).map((k) => `the key at frame ${String(k['t'])} isn't linear: ${show(k, 300)}`), 'every key is linear');
    const anchor = (valueAt(ks['a'], 0)[0] ?? 0);
    none(frames.flatMap((k) => {
      const x = valueAt(xProp, k)[0]! - anchor;
      return Math.abs(x - evaluated[k]!) <= 1e-4 ? [] : [`frame ${k}: the file's x ${x}, evaluated ${evaluated[k]}`];
    }), 'x matches the evaluated x at every export frame within 1e-4 u');
    const driven = warnings.filter((w) => w.item === 'title' && w.kind === 'sampled' && /items\/title\/at\/pos\/0|drivers\/wave/.test(w.text));
    expect(driven.length, `the warnings list the driver's path, items/title/at/pos/0: ${JSON.stringify(warnings.map((w) => w.raw))}`).toBeGreaterThan(0);
    expect(warnings.filter((w) => w.item === 'stack' && w.kind === 'cannot_hold').length, `the y-sorted stack is listed as an item Lottie can't hold: ${JSON.stringify(warnings.map((w) => w.raw))}`).toBe(1);
  }, TIMEOUT);
});
