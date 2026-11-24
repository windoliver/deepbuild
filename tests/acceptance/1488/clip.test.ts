// AC5 #1488.a52e928a: A clip tagged rotation 90 shows upright with width and height swapped.
//
// The clip (README: Fixtures) is 160 × 96 coded, four flat quarters in each of its 10 frames, its track header's
// matrix (0, 1, −1, 0): a quarter turn clockwise, the turn a phone writes for a portrait recording, which the legacy
// `rotate` tag calls 90 *(chosen reading of "rotation 90")*. Upright, it is 96 × 160 with the stored top-left (red) at
// its top-right. Read *(chosen)* in three places, all on frame 4 (0.45 s) of a 240 × 240 board:
// - the decode worker's probe (`deep-show run` `media_import`): the video stream's `size` is [96, 160], the size layout
//   takes ("Size comes from the probe");
// - the hub's canonical snapshot (`deep-show run` `eval` with `pixels`), the clip `fit: contain` in a 200 × 200 box:
//   upright it stands 120 × 200 with ground left and right of it (width and height swapped), each corner its upright
//   quarter;
// - the live view's renderer (`deep-canvas-render render`), the clip `fit: fill` in the 120 × 200 box contain would
//   give it: each corner its upright quarter. The live view's video draw fills its box whatever `fit` says at the
//   base (#499's player decodes to the box), so there the size is read from the probe and only "upright" from pixels.
// The criterion names no wrong program; the merge base, which draws the coded frame unturned, fails it
// (BASE-FAILURE.txt).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { blocked, fl, putEvidence, putStore, useBinary, useTemp } from '../499/video/helpers.ts';
import {
  BOARD, CLIP, DOC, ITEM_BOX, LOOK, boardOf, checkFixtureTurns, clipItem, contained, cornerFailures, drawLines, evalPixels, firstStream,
  importCall, marginFailures, present, quadrantClip, readPng, scenario, show, showRun, sideMargins, snapshot, type JsonObject,
} from './helpers.ts';

const showBin = useBinary('deep-show');
const renderBin = useBinary('deep-canvas-render');
const temp = useTemp('1488-clip');
const T = fl(0.45);

describe('AC5 #1488.a52e928a a clip tagged to turn a quarter shows upright', () => {
  it('AC5 #1488.a52e928a a clip tagged rotation 90 probes 96 × 160 and draws upright, width and height swapped, canonical and live', () => {
    if (process.platform !== 'darwin') blocked(`the decode worker's video decoder and the live renderer are macOS's; this is ${process.platform}`);
    const dir = temp();
    const file = join(dir, 'clip-turned.mp4');
    quadrantClip(file);
    checkFixtureTurns(file, CLIP.w, CLIP.h, 'the turned clip');
    const bytes = readFileSync(file);
    const evidence = join(dir, 'evidence');
    const sha = putEvidence(evidence, bytes);
    const store = join(dir, 'store');
    putStore(store, bytes);
    const shown = contained(CLIP.h, CLIP.w);
    const doc = boardOf('clip', BOARD, [clipItem('clip', sha, ITEM_BOX)], { clip: sha });
    const filled = boardOf('clip', BOARD, [clipItem('clip', sha, shown, 'fill')], { clip: sha });
    const failures: string[] = [];
    const board = (what: string, image: ReturnType<typeof readPng> | string, margins: boolean): void => {
      if (typeof image === 'string') { failures.push(`${what}: drew no picture: ${image}`); return; }
      if (image.width !== BOARD[0] || image.height !== BOARD[1]) { failures.push(`${what}: the picture is ${image.width} × ${image.height}, not the board's`); return; }
      failures.push(...cornerFailures(image, shown, what), ...(margins ? marginFailures(image, sideMargins(shown), what) : []));
    };

    const run = showRun(showBin(), scenario(evidence, [importCall(file), present(DOC.a, doc), evalPixels(DOC.a, T)]));
    if (!run.ok) failures.push(`deep-show run: ${run.why}`);
    else {
      const [probed, presented, evaluated] = run.replies as [JsonObject, JsonObject, JsonObject];
      const stream = firstStream(probed, 'video');
      if (typeof stream === 'string') failures.push(`the worker's probe (media_import): ${stream}`);
      else if (JSON.stringify(stream['size']) !== JSON.stringify([CLIP.h, CLIP.w])) failures.push(`the worker's probe (media_import) reports the video's size ${show(stream['size'])}, not [${CLIP.h}, ${CLIP.w}]: width and height aren't swapped`);
      board('deep-show\'s snapshot (eval pixels at 0.45 s, fit contain)', presented['outcome'] === 'presented' ? snapshot(evidence, evaluated) : `the board isn't presented: ${show(presented)}`, true);
    }

    const out = join(dir, 'render.png');
    const r = drawLines(renderBin(), 'render', [{ out, doc: filled, look: LOOK, view: { zoom: 1, theme: 'light' }, t: T, store }]);
    const a = r.answers[0];
    if (a?.['code'] === 'unsupported_platform') blocked('deep-canvas-render render answers unsupported_platform');
    board('deep-canvas-render render (the live view, at 0.45 s, fit fill)', r.crash ?? (a?.['ok'] === true ? readPng(readFileSync(out)) : `render answers ${show(a)}`), false);

    expect(failures, `the clip shows upright with width and height swapped:\n${failures.join('\n')}`).toEqual([]);
  }, 3_600_000);
});
