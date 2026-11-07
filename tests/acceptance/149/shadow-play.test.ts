// AC9 #149.e2b5abff: The reference film #77 lists for this light, a coloured shadow play of a fable, renders from its
// description in a 2D drawing look with no film-specific code: each puppet's collection is lit by the lamps in proportion
// to its transmission, so at 0 it takes no lamp light and at 0.5 half of what it takes at 1, within 1/255 in linear light;
// a lamp moved by its channel moves the shadows with it, seeking to any time equals playing to it by pixel hash, and the
// film exports to MP4.
//
// `fixtures/shadow-play.json` is the description: the fox and the crow, as data, with lamps that are items with channels.
//
// The light a collection takes at a transmission is its pixels in linear light, less the same pixels with no lamp. Each
// collection is drawn at 0, 0.5 and 1, with the geometry unchanged, so the answer is arithmetic and needs no model of a
// lamp's falloff: L(0) = 0 and L(0.5) = L(1) / 2. The film's cast shadow is off for this test, so what each pixel holds
// is the collection's own light.
//
// A shadow falls away from its lamp. With one lamp walking from the left of the fox to its right, the pixels the fox
// darkens outside its own shape lie right of the fox at the start and left of it at the end. The fox's own shape comes
// from a draw with no light, and "darkens" from the film drawn with and without it.
//
// Wrong programs: light by transmission squared, or in encoded space (0.5 misses half); a shadow cast along the look's
// fixed `dir`, which doesn't move; lamp positions read at the first frame; a seed from playback; no export.
import { describe, expect, it } from 'vitest';
import {
  AC, alphaAt, at, clone, errorsOf, film2dCall, fixtureJson, flickOf, hasFile, layerFloats, layersCall, lookOf, namedInCode, none, num, obj, oneLine, requireMetal, rows, runGpu,
  shown, str, toLinear, useBin, useDir, useGpu, type Floats, type JsonObject,
} from './helpers.ts';

const ID = AC[9];
const bin = useGpu();
const render = useBin('deep-canvas-render');
const dir = useDir();
const F = fixtureJson('shadow-play.json');
const DOC = obj(F['doc'], 'the film');
const LOOK = lookOf(F);
const LIGHT = obj(LOOK['light'], 'the look\'s light');
const BACK = obj(LIGHT['back'], 'back');
const PROBES = obj(F['probes'], 'probes');
const [W, H] = [960, 540] as const;
const COLLECTIONS = ['fox', 'crow', 'tree'];
/** Three draws give each collection each transmission. */
const TURNS: Record<string, number>[] = [{ fox: 0, crow: 0.5, tree: 1 }, { fox: 0.5, crow: 1, tree: 0 }, { fox: 1, crow: 0, tree: 0.5 }];

const lightWith = (fields: JsonObject): JsonObject => ({ ...LOOK, light: { ...LIGHT, ...fields } });
const backLit = (transmission: Record<string, number>, lamps = BACK['lamps'] as JsonObject[]): JsonObject => {
  const { cast: _cast, ...rest } = LIGHT;
  return { ...LOOK, light: { ...rest, back: { lamps, transmission } } };
};
function drawn(doc: JsonObject, looks: JsonObject[], t: number): Floats[] {
  const out = dir();
  return runGpu(bin(), out, looks.map((l) => layersCall(doc, l, { t }))).map((r, i) => layerFloats(out, r, 'main', [W, H], `the film, look ${i}`));
}
function box(c: string): [number, number, number, number] {
  return (PROBES[c] as number[]).map((v) => Number(v)) as [number, number, number, number];
}

describe(`${ID} a coloured shadow play`, () => {
  it(`${ID} each collection takes lamp light in proportion to its transmission, within 1/255 in linear light`, () => {
    requireMetal();
    const failures: string[] = [];
    const drawings = drawn(DOC, [...TURNS.map((t) => backLit(t)), backLit(TURNS[0]!, [])], 0);
    const off = drawings[3]!;
    let largest = 0;
    for (const c of COLLECTIONS) {
      const of = (value: number): Floats => drawings[TURNS.findIndex((t) => t[c] === value)]!;
      const [x, y, w, h] = box(c);
      for (let j = y; j < y + h; j += 4) for (let i = x; i < x + w; i += 4) {
        expect(alphaAt(off, i, j), `${c}: the probe at (${i}, ${j}) lies inside the puppet`).toBeGreaterThan(0.99);
        for (let k = 0; k < 3; k++) {
          const dark = toLinear(at(off, i, j, k));
          const light = (v: number): number => toLinear(at(of(v), i, j, k)) - dark;
          const [none0, half, full] = [light(0), light(0.5), light(1)];
          largest = Math.max(largest, full);
          if (Math.abs(none0) > 1 / 255) failures.push(`${c} at (${i}, ${j}) channel ${k}: transmission 0 takes ${none0.toFixed(4)} of lamp light`);
          if (Math.abs(half - full / 2) > 1 / 255) failures.push(`${c} at (${i}, ${j}) channel ${k}: transmission 0.5 takes ${half.toFixed(4)}, half of ${full.toFixed(4)} is ${(full / 2).toFixed(4)}`);
        }
      }
    }
    expect(largest, 'the lamps light the puppets').toBeGreaterThan(0.05);
    none(failures, 'light out of proportion to transmission');
  });

  it(`${ID} a lamp moved by its channel moves the shadows with it: they fall away from the lamp, at each end of its walk`, () => {
    requireMetal();
    const foxless = clone(DOC);
    delete obj(foxless['items'], 'items')['fox-body']; delete obj(foxless['items'], 'items')['fox-tail'];
    delete obj(foxless['collections'], 'collections')['fox']; delete obj(foxless['channels'], 'channels')['fox-creep'];
    const oneLamp = lightWith({ back: { lamps: ['lamp-a'], transmission: { fox: 0, crow: 0, tree: 0 } } });
    const noLamp: JsonObject = { ...LOOK, light: { dir: LIGHT['dir']!, elevation: LIGHT['elevation']! } };
    const foxCenter = box('fox')[0] + box('fox')[2] / 2;
    const sideAt = (frame: number): { side: number; count: number } => {
      const t = flickOf(frame, 30);
      const [withFox, plainFox] = drawn(DOC, [oneLamp, noLamp], t);
      const [without, plainWithout] = drawn(foxless, [oneLamp, noLamp], t);
      let sum = 0; let count = 0;
      const differs = (a: Floats, b: Floats, x: number, y: number): boolean => [0, 1, 2, 3].some((c) => Math.abs(at(a, x, y, c) - at(b, x, y, c)) > 4 / 255);
      for (let y = 3; y < H - 3; y++) for (let x = 3; x < 480; x++) {
        if (!differs(withFox!, without!, x, y)) continue;
        // Its own shape, grown by two pixels so its edge's antialiasing isn't counted as shadow.
        let own = false;
        for (let dy = -2; dy <= 2 && !own; dy++) for (let dx = -2; dx <= 2 && !own; dx++) own = differs(plainFox!, plainWithout!, x + dx, y + dy);
        if (!own) { sum += x + 0.5; count++; }
      }
      return { side: count ? sum / count - foxCenter : 0, count };
    };
    const start = sideAt(0); const end = sideAt(180);
    console.log(`${ID}: shadow centroid from the fox's center: ${start.side.toFixed(1)} px with the lamp left (${start.count} px), ${end.side.toFixed(1)} px with it right (${end.count} px)`);
    expect(start.count, 'the fox casts a shadow at the start').toBeGreaterThan(100);
    expect(end.count, 'and at the end').toBeGreaterThan(100);
    expect(start.side, 'the lamp left of the fox throws the shadow right of it').toBeGreaterThan(0);
    expect(end.side, 'the lamp right of the fox throws the shadow left of it').toBeLessThan(0);
  });

  it(`${ID} the film renders from its description with no film-specific code, seeks equal to play, and exports to MP4`, () => {
    requireMetal();
    const checked = oneLine(render(), ['check'], { doc: DOC, look: LOOK });
    expect(errorsOf(checked), `the description checks: ${shown(checked['issues'] ?? null)}`).toEqual([]);
    none(namedInCode(['drawn-shadow-149', 'drawn-shadow-149-look', 'crow-beak', 'fox-tail', 'lamp-walk']), 'the film named in the program');
    const FPS = 10; const FRAMES = 61;
    const out = dir();
    const [reply] = runGpu(bin(), out, [film2dCall(DOC, LOOK, { fps: FPS, frames: FRAMES, export: { codec: 'h264' } })]);
    const played = new Map(rows(reply!, 'the play').map((r) => [r.frame, r.hash]));
    expect(played.size, 'the film plays its 6 s').toBe(FRAMES);
    expect(new Set(played.values()).size, 'the film moves').toBeGreaterThan(30);
    for (const n of [13, 30, 47, 60]) {
      const sought = rows(runGpu(bin(), out, [film2dCall(DOC, LOOK, { fps: FPS, from: n, frames: 1 })])[0]!, `sought to ${n}`)[0]!;
      expect(sought.hash, `frame ${n} sought equals frame ${n} played`).toBe(played.get(n));
    }
    const made = obj(reply!['export'], 'the export');
    expect(made['codec'], 'the export is H.264').toBe('h264');
    expect(num(made['frames'], 'frames'), 'every frame is exported').toBe(FRAMES);
    const movie = readMp4(hasFile(out, str(made['file'], 'file'), 'mp4', 'the export'));
    expect(movie.brand, 'an MP4 file type box').toBe('ftyp');
    expect(movie.entry, 'an H.264 sample entry').toBe('avc1');
    expect(movie.samples, 'one sample a frame').toBe(FRAMES);
    expect([movie.width, movie.height], 'at the film\'s size').toEqual([W, H]);
  });
});

/** The boxes of an MP4 this test reads: the first box, the video sample entry, its size, and the sample count. */
function readMp4(file: Buffer): { brand: string; entry: string; width: number; height: number; samples: number } {
  const found = { brand: file.toString('latin1', 4, 8), entry: '', width: 0, height: 0, samples: 0 };
  const walk = (from: number, to: number): void => {
    let pos = from;
    while (pos + 8 <= to) {
      const size = file.readUInt32BE(pos); const type = file.toString('latin1', pos + 4, pos + 8);
      if (size < 8) return;
      if (['moov', 'trak', 'mdia', 'minf', 'stbl'].includes(type)) walk(pos + 8, pos + size);
      if (type === 'stsd') { found.entry = file.toString('latin1', pos + 20, pos + 24); found.width = file.readUInt16BE(pos + 16 + 32); found.height = file.readUInt16BE(pos + 16 + 34); }
      if (type === 'stsz') found.samples = file.readUInt32BE(pos + 16);
      pos += size;
    }
  };
  walk(0, file.length);
  return found;
}
