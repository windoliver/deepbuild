// AC1 #162.ba90a515: "A title with a trim, a repeater, a mask and Bézier keys exports to Lottie with no shape or layer
// type Lottie 1.0.1 doesn't define, validates against its schema, and imported back evaluates to the same item values at
// 100 random times within 1e-4; the same title with a named ease and a spring exports them as linear keys at the export
// frame rate, matches at every export frame within 1e-4, and lists both in warnings"
//
// This file holds the round trip and the sampled keys (schema.test.ts the schema and the types). The map's oracle for
// this criterion is the spec's schema test; these legs are ours, kept with it so the criterion has one home.
//
// "The same item values": for the curve (Line) its position and its trim's start and end, and for the repeated tiles
// (Tiles) their position and turn, each read with `eval`'s `paths` at 100 seeded times in [0, 2 s). In the imported
// document, an item is the outermost one named as the layer it came from (the export writes each item's name as its
// layer's `nm`; README: readings), and the trim is the `trim` op on it or under it. The mask's coverage is held by
// AC11's fidelity check, not here. The planted mismatch beside each comparison: the imported values read one export
// frame late must fail it, and the eased file's keys held to the Bézier title's evaluation must fail theirs.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, FULL, TIMEOUT, TITLE, TITLE_NAMES, evalCall, exportedOf, frameFlicks, importLottie, importWorld, isLinearKey, isObject, itemNamed, itemsOf, keysOf, layerNamed,
  lottieExport, none, readLottie, seeded, shapesIn, show, showRun, titleDoc, useShow, useTemp, valueAt, valuesOf, type JsonObject,
} from './helpers.ts';

const shows = useShow([FULL]);
const temp = useTemp();
const DT = frameFlicks(TITLE.rate);
const SPAN = TITLE.frames * DT;

/** The title's item values, by the path each has in the source title. */
const SOURCE = {
  line: ['items/line/at/pos/0', 'items/line/at/pos/1', 'items/line/params/ops/0/trim/start', 'items/line/params/ops/0/trim/end'],
  tiles: ['items/tiles/at/pos/0', 'items/tiles/at/pos/1', 'items/tiles/at/rot/2'],
};
/** The same values' paths in the imported document. */
function importedPaths(doc: JsonObject): string[] {
  const items = itemsOf(doc);
  const [line] = itemNamed(doc, TITLE_NAMES.line, 'the imported title');
  const [tiles] = itemNamed(doc, TITLE_NAMES.tiles, 'the imported title');
  const under = (id: string, root: string): boolean => { for (let p: unknown = id; typeof p === 'string'; p = items[p]?.['parent']) if (p === root) return true; return false; };
  const trims = Object.entries(items).flatMap(([id, i]) => {
    const ops = isObject(i['params']) && Array.isArray(i['params']['ops']) ? i['params']['ops'] : [];
    return under(id, line) ? ops.flatMap((op, k) => (isObject(op) && isObject(op['trim']) ? [`items/${id}/params/ops/${k}/trim`] : [])) : [];
  });
  expect(trims.length, `the imported curve carries one trim op: ${show(items[line] ?? null, 800)}`).toBe(1);
  return [`items/${line}/at/pos/0`, `items/${line}/at/pos/1`, `${trims[0]}/start`, `${trims[0]}/end`, `items/${tiles}/at/pos/0`, `items/${tiles}/at/pos/1`, `items/${tiles}/at/rot/2`];
}
function compare(src: number[][], dst: number[][], times: number[], names: string[], tol: number): string[] {
  return times.flatMap((t, i) => names.flatMap((n, j) => {
    const a = src[i]![j]!; const b = dst[i]![j]!;
    return Math.abs(a - b) <= tol ? [] : [`t = ${t} flicks, ${n}: the title ${a}, imported back ${b}`];
  }));
}

describe(`${AC[1]} the title imported back evaluates to the same item values; its eased twin's ease and spring export as linear keys`, () => {
  it(`${AC[1]} imported back, the title's curve and tiles evaluate to the same values at 100 random times within 1e-4`, async () => {
    const evidence = temp(); const dir = temp();
    const out = join(dir, 'title.json');
    const rand = seeded(162);
    const times = Array.from({ length: 100 }, () => Math.floor(rand() * SPAN));
    const paths = [...SOURCE.line, ...SOURCE.tiles];
    const a = showRun(shows.bin(FULL), evidence, [titleDoc(evidence)], [lottieExport(0, out), ...times.map((t) => evalCall(0, t, paths))], 'the title');
    exportedOf(a[0]!, 'the title');
    const src = times.map((t, i) => valuesOf(a[1 + i]!, paths, `the title at ${t}`));
    const iw = await importWorld();
    const { document } = await importLottie(iw, readFileSync(out), 'title.json');
    const mapped = importedPaths(document);
    const b = showRun(shows.bin(FULL), iw.evidence, [document], [...times.map((t) => evalCall(0, t, mapped)), ...times.map((t) => evalCall(0, Math.min(SPAN - 1, t + DT), mapped))], 'the title imported back');
    const dst = times.map((t, i) => valuesOf(b[i]!, mapped, `imported back at ${t}`));
    const late = times.map((t, i) => valuesOf(b[times.length + i]!, mapped, `imported back a frame after ${t}`));
    none(compare(src, dst, times, paths, 1e-4), 'the title and the title imported back, at 100 random times');
    expect(compare(src, late, times, paths, 1e-4).length, 'planted: the imported values read one export frame late differ somewhere (the comparison has teeth)').toBeGreaterThan(0);
  }, TIMEOUT);

  it(`${AC[1]} the named ease and the spring export as linear keys at every export frame, within 1e-4 of the evaluated values, and both are listed in warnings`, () => {
    const evidence = temp(); const dir = temp(); const out = join(dir, 'eased.json');
    const frames = Array.from({ length: TITLE.frames }, (_, k) => k);
    const paths = ['items/line/params/ops/0/trim/end', 'items/tiles/at/rot/2'];
    const r = showRun(shows.bin(FULL), evidence, [titleDoc(evidence, 'eased'), titleDoc(evidence)], [
      lottieExport(0, out), ...frames.map((k) => evalCall(0, k * DT, paths)), ...frames.map((k) => evalCall(1, k * DT, paths)),
    ], 'the eased title');
    const { warnings } = exportedOf(r[0]!, 'the eased title');
    const eased = frames.map((k) => valuesOf(r[1 + k]!, paths, `the eased title at frame ${k}`));
    const bezier = frames.map((k) => valuesOf(r[1 + frames.length + k]!, paths, `the Bézier title at frame ${k}`));
    const anim = readLottie(out, 'the eased title');
    const trims = shapesIn(layerNamed(anim, TITLE_NAMES.line, 'the eased title').layer['shapes']).filter((s) => s.shape['ty'] === 'tm');
    expect(trims.length, 'the curve\'s layer holds one trim').toBe(1);
    const end = trims[0]!.shape['e'];
    const turn = (layerNamed(anim, TITLE_NAMES.tiles, 'the eased title').layer['ks'] as JsonObject | undefined)?.['r'];
    /** A property's keys at every frame of [from, to], each linear; its value ÷ scale at every export frame within 1e-4
     * of `want`'s column. */
    const judge = (prop: unknown, name: string, from: number, to: number, scale: number, want: number[][], col: number): string[] => {
      const keys = keysOf(prop as JsonObject);
      const at = new Map(keys.map((k) => [Number(k['t']), k]));
      const out: string[] = [];
      for (let k = from; k <= to; k++) {
        const key = at.get(k);
        if (!key) out.push(`${name}: no key at export frame ${k}`);
        else if (k < to && !isLinearKey(key, 1)) out.push(`${name}: the key at frame ${k} isn't linear: ${show(key, 300)}`);
      }
      for (const k of frames) {
        const v = valueAt(prop as JsonObject, k)[0]! / scale;
        if (Math.abs(v - want[k]![col]!) > 1e-4) out.push(`${name}: frame ${k}: the file ${v}, evaluated ${want[k]![col]}`);
      }
      return out;
    };
    none(judge(end, 'the trim\'s end', 0, 36, 100, eased, 0), 'the named ease: linear keys at every export frame of its segment, matching at every frame');
    none(judge(turn, 'the turn', 0, TITLE.frames - 1, 1, eased, 1), 'the spring: linear keys at every export frame of its segment, matching at every frame');
    expect(judge(end, 'the trim\'s end', 0, 36, 100, bezier, 0).length + judge(turn, 'the turn', 0, TITLE.frames - 1, 1, bezier, 1).length,
      'planted: the eased file held to the Bézier title\'s evaluation fails (the comparison has teeth)').toBeGreaterThan(0);
    expect(warnings.some((w) => w.item === 'line' && w.kind === 'sampled' && /ease|in_out_cubic/.test(w.text)), `the warnings list the curve's sampled ease: ${JSON.stringify(warnings.map((w) => w.raw))}`).toBe(true);
    expect(warnings.some((w) => w.item === 'tiles' && w.kind === 'sampled' && /spring/.test(w.text)), `the warnings list the tiles' sampled spring: ${JSON.stringify(warnings.map((w) => w.raw))}`).toBe(true);
  }, TIMEOUT);
});
