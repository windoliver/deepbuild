// AC1 #1488.a31e7537: A JPEG with orientation 6 and a 200 × 100 stored size reports 100 × 200 and draws its top row on
// the right edge on every path. A planted decoder that ignores the tag fails on the corner pixel.
//
// The photo (README: Fixtures) is four flat quarters, so each corner of the upright picture has its own color: turned
// a quarter clockwise, the stored top-left (red) is the top-right corner and the stored top-right (green) the
// bottom-right, so the stored top row runs down the right edge. "Every path" *(chosen)*: the decode worker's probe
// (`deep-show run` `media_import`: `size`), its decode (`media_decode` to BGRA: `size` and the corners), and the three
// binaries that draw image@1 through the image service: `deep-show run` `eval` with `pixels` (the hub's canonical
// snapshot), `deep-canvas-render raster` (Vello CPU, canonical) and `deep-canvas-render render` (GPUI, the live view's
// renderer, which `frames`, `live` and `session` share). Each draws the photo `fit: contain` in a 200 × 200 box of a
// 240 × 240 board, where the upright picture stands 100 × 200 with ground left and right of it.
//
// The wrong program is `planted: "decoder_ignores_orientation"` on every path that decodes the photo (the scenario's
// `planted`, which reaches the worker and the snapshot, and `raster`'s and `render`'s): the second test runs it and
// requires every pixel path to fail on a corner pixel.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { blocked, putEvidence, putStore, useBinary, useTemp } from '../499/video/helpers.ts';
import {
  AC, BOARD, DOC, ITEM_BOX, LOOK, PHOTO, PLANT, boardOf, bgraFrame, checkFixtureTurns, contained, cornerFailures, decodeCall, drawLines,
  evalPixels, firstStream, importCall, marginFailures, photoJpeg, present, readPng, scenario, show, showRun, sideMargins, snapshot, stillItem,
  type Box, type JsonObject,
} from './helpers.ts';

const showBin = useBinary('deep-show');
const renderBin = useBinary('deep-canvas-render');
const temp = useTemp('1488-orientation');
const TIMEOUT = 3_600_000;

/** What one path showed: every failure, and those that are corner pixels (a subset). */
interface Path { path: string; failures: string[]; corners: string[] }

/** The upright photo's place on the board: 100 × 200 in the 200 × 200 box. */
const SHOWN: Box = contained(PHOTO.h, PHOTO.w);

/** A drawn board read at its corners and its side margins; `why` when nothing was drawn. */
function readBoard(path: string, image: ReturnType<typeof readPng> | string): Path {
  if (typeof image === 'string') return { path, failures: [`${path}: drew no picture: ${image}`], corners: [] };
  if (image.width !== BOARD[0] || image.height !== BOARD[1]) return { path, failures: [`${path}: the picture is ${image.width} × ${image.height}, not the board's ${BOARD.join(' × ')}`], corners: [] };
  const corners = cornerFailures(image, SHOWN, path);
  return { path, failures: [...corners, ...marginFailures(image, sideMargins(SHOWN), path)], corners };
}

/** Every path, honest or with the plant. */
function paths(planted?: string): Path[] {
  const dir = temp();
  const photo = photoJpeg();
  const file = join(dir, 'photo-o6.jpg');
  writeFileSync(file, photo);
  checkFixtureTurns(file, PHOTO.w, PHOTO.h, 'the orientation-6 photo');
  const evidence = join(dir, 'evidence');
  const sha = putEvidence(evidence, photo);
  const store = join(dir, 'store');
  putStore(store, photo);
  const doc = boardOf('photo', BOARD, [stillItem('photo', sha, ITEM_BOX)], { photo: sha });
  const out = join(dir, 'decoded');
  const png = (n: string): string => join(dir, `${n}.png`);
  const result: Path[] = [];

  // The decode worker and the hub's snapshot: one run.
  const run = showRun(showBin(), { ...scenario(evidence, [importCall(file), decodeCall(file, out), present(DOC.a, doc), evalPixels(DOC.a, 0)]), ...(planted ? { planted } : {}) });
  if (planted) expect(run.ok, `planted ${planted}: ${run.why}`).toBe(true);
  if (!run.ok) {
    for (const p of ['the worker\'s probe', 'the worker\'s decode', 'deep-show\'s snapshot']) result.push({ path: p, failures: [`${p}: ${run.why}`], corners: [] });
  } else {
    const [probed, decoded, presented, evaluated] = run.replies as [JsonObject, JsonObject, JsonObject, JsonObject];
    const stream = firstStream(probed, 'image');
    const probe: Path = { path: 'the worker\'s probe', failures: [], corners: [] };
    if (typeof stream === 'string') probe.failures.push(`the worker's probe (media_import): ${stream}`);
    else if (JSON.stringify(stream['size']) !== '[100,200]') probe.failures.push(`the worker's probe (media_import) reports size ${show(stream['size'])}, not [100, 200]`);
    result.push(probe);

    const frame = bgraFrame(out, decoded);
    if (typeof frame === 'string') result.push({ path: 'the worker\'s decode', failures: [`the worker's decode (media_decode): ${frame}`], corners: [] });
    else {
      const corners = cornerFailures(frame.image, [0, 0, frame.size[0], frame.size[1]], 'the worker\'s decode (media_decode)', 8);
      const size = JSON.stringify(frame.size) === '[100,200]' ? [] : [`the worker's decode (media_decode) answers size ${show(frame.size)}, not [100, 200]`];
      result.push({ path: 'the worker\'s decode', failures: [...size, ...corners], corners });
    }

    const shot = presented['outcome'] === 'presented' ? snapshot(evidence, evaluated) : `the board isn't presented: ${show(presented)}`;
    result.push(readBoard('deep-show\'s snapshot (eval pixels)', shot));
  }

  // deep-canvas-render: the canonical raster and GPUI's render.
  const plant = planted ? { planted } : {};
  const raster = drawLines(renderBin(), 'raster', [{ out: png('raster'), doc, look: LOOK, store, ...plant }]);
  const ra = raster.answers[0];
  result.push(readBoard('deep-canvas-render raster', raster.crash ?? (ra?.['ok'] === true ? readPng(readFileSync(png('raster'))) : `raster answers ${show(ra)}`)));
  const render = drawLines(renderBin(), 'render', [{ out: png('render'), doc, look: LOOK, view: { zoom: 1, theme: 'light' }, t: 0, store, ...plant }]);
  const rr = render.answers[0];
  if (rr?.['code'] === 'unsupported_platform') blocked('deep-canvas-render render answers unsupported_platform: GPUI\'s offscreen Metal renderer is macOS only');
  result.push(readBoard('deep-canvas-render render', render.crash ?? (rr?.['ok'] === true ? readPng(readFileSync(png('render'))) : `render answers ${show(rr)}`)));
  return result;
}

describe('AC1 #1488.a31e7537 a phone photo\'s orientation 6 applied on every path', () => {
  it('AC1 #1488.a31e7537 the 200 × 100 stored, orientation-6 JPEG reports 100 × 200 and draws its top row on the right edge on every path', () => {
    if (process.platform !== 'darwin') blocked(`the render path draws with GPUI's offscreen Metal renderer and the worker runs the platform's decoders, macOS only; this is ${process.platform}`);
    const all = paths();
    const failures = all.flatMap((p) => p.failures);
    expect(failures, `every path shows the photo upright, 100 × 200:\n${failures.join('\n')}`).toEqual([]);
  }, TIMEOUT);

  it('AC1 #1488.a31e7537 the planted decoder that ignores the tag (decoder_ignores_orientation) fails on the corner pixel on every path that draws', () => {
    if (process.platform !== 'darwin') blocked(`the render path draws with GPUI's offscreen Metal renderer, macOS only; this is ${process.platform}`);
    const all = paths(PLANT).filter((p) => p.path !== 'the worker\'s probe');
    const missed = all.filter((p) => p.corners.length === 0);
    for (const p of all) console.log(`${AC[1]} planted ${PLANT}, ${p.path}: ${p.corners.length ? p.corners.join('; ') : `no corner failure (${p.failures.join('; ') || 'drawn upright'})`}`);
    expect(missed.map((p) => `${p.path}: ${p.failures.join('; ') || 'drew the photo upright'}`), `the planted decoder that ignores the tag fails on the corner pixel on every path that draws the photo`).toEqual([]);
  }, TIMEOUT);
});
