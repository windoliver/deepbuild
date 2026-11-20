// What #2456 asks of a write that its acceptance suite doesn't reach (that suite holds a fade, the issue's own
// reproduction): "a write … reveal never shows on screen". A text in write mode whose reveal a channel keys draws in the
// canvas's own frames, `deep-show run`'s `eval` with `pixels`, as `deep-canvas-render raster` writes it (#1969: each
// grapheme's outline first, then its fill), never as a fade. Each runs the real `deep-show` and `deep-canvas-render`.
//
// "Hello there" at 64 u, its progress keyed 0 at 1 s to 1 at 2 s (#2456's channel), read at 1.25 s, 1.5 s and 1.75 s
// (progress 0.25, 0.5 and 0.75), where some graphemes are outlines with no fill, some fill in and some are whole. Every
// pixel of each frame is within 2 code values of raster's frame at the same time. Wrong program: frames that fade each
// grapheme by its share, as the merge base draws a write.
import { describe, expect, it } from 'vitest';
import {
  TIMEOUT, codeDiff, docId, evalAt, fl, linear, num, pixel, present, presented, raster, readPng, renderFilm, runShow, scenario,
  showFilm, snapshotOf, textItem, useBinary, useFolders, valueOf, type Image, type JsonObject,
} from './acceptance/1969/helpers.ts';

const show = useBinary('deep-show');
const render = useBinary('deep-canvas-render');
const folder = useFolders();

const PROGRESS = 'items/tx/params/reveal/progress';
const KEYS = linear(PROGRESS, [[1, 0], [2, 1]]);
const WORDS: JsonObject = { text: 'Hello there', font: 'body', size: 64, paint: { fill: { role: 'ink' } }, reveal: { mode: 'write', order: 'reading', progress: 1 } };
const AT: JsonObject = { pos: [40, 140, 0] };
const TIMES = [1.25, 1.5, 1.75] as const;

/** How many pixels of `got` are more than 2 code values off `want`, and by how much at most. */
function off(got: Image, want: Image): { count: number; max: number } {
  expect([got.width, got.height], 'the frame and raster\'s are one size').toEqual([want.width, want.height]);
  let count = 0; let max = 0;
  for (let y = 0; y < got.height; y++) {
    for (let x = 0; x < got.width; x++) {
      const d = codeDiff(pixel(got, x, y), pixel(want, x, y));
      if (d > 2) count++;
      max = Math.max(max, d);
    }
  }
  return { count, max };
}

describe('#2456 a write a channel keys, in the canvas\'s own frames', () => {
  it('draws each grapheme as raster writes it, outline first and then fill, never as a fade', () => {
    const evidence = folder();
    const doc = docId(2456);
    const film: JsonObject = {
      ...showFilm('A keyed write', [{ id: 'tx', kind: 'text@1', name: 'tx', order: 'a1', at: AT, params: WORDS }], { span: 3 }),
      transport: { span: '3s', frame_rate: '60/1' }, channels: { reveal: KEYS },
    };
    const calls = [present(doc, film), ...TIMES.map((s) => evalAt(doc, fl(s), { paths: [PROGRESS], pixels: true }))];
    const replies = runShow(show(), scenario(evidence, calls, []));
    presented(replies[0]!, 'the keyed write');
    const written = raster(render(), folder(), renderFilm('keyed-write', [textItem('tx', 'a1', WORDS, AT)], { channels: { reveal: KEYS } }, '3s'), TIMES.map(fl));
    const failures: string[] = [];
    TIMES.forEach((s, i) => {
      const what = `the frame at ${s} s`;
      expect(num(valueOf(replies[i + 1]!, PROGRESS, what), `${what}: ${PROGRESS}`), `${what} is at progress ${s - 1}`).toBeCloseTo(s - 1, 9);
      const want = readPng(written.pngs[i]!);
      const ground = pixel(want, 2, 2);
      let ink = 0;
      for (let y = 0; y < want.height; y++) for (let x = 0; x < want.width; x++) if (codeDiff(pixel(want, x, y), ground) > 30) ink++;
      expect(ink, `raster's write at ${s} s draws ink`).toBeGreaterThan(100);
      const d = off(snapshotOf(replies[i + 1]!, evidence, what), want);
      if (d.count > 0) failures.push(`${what}: ${d.count} pixels are more than 2 code values off raster's write, by up to ${d.max}`);
    });
    expect(failures, 'the canvas\'s frames write the keyed text as raster does').toEqual([]);
  }, TIMEOUT);
});
