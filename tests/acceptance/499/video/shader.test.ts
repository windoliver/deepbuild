// AC14 #499.09623041: An untagged 1080p 75% bars fixture through the live shader is within ±2 code values of BT.709.
// The stock full-range BT.601 fragment misses and fails, naming the field.
//
// Through `deep-canvas-render render` (#391's call: one frame of the view drawn by GPUI's offscreen Metal renderer at
// scale 1, written as a PNG of the document's size), with the request's `store` holding the fixture by its hash: an
// image@1 of the bars fills a 1920 × 1080 board, drawn 1:1. The live view samples the frame's pooled NV12 planes with
// the shader that takes matrix and range from the probe's colour tags; untagged at 1080 lines, the probe assumes
// BT.709 and limited range (#498's rule). The wrong program is `planted: "stock_bt601_fragment"`: GPUI's stock
// fragment, full-range BT.601, whatever the tags.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, LOOK, TIMEOUT, asset, barsErrors, blocked, decodePng, documentOf, liveViewProblem, putStore, renderLines, untaggedBars1080, useBinary,
  useTemp, videoItem, type JsonObject,
} from './helpers.ts';

const renderBin = useBinary('deep-canvas-render');
const temp = useTemp('shader');

describe(`${AC[14]} the live shader converts Y and CbCr by the probe's matrix and range`, () => {
  it(`${AC[14]} untagged 1080p 75% bars drawn live are within ±2 code values of BT.709; the stock full-range BT.601 fragment misses and fails, naming color.matrix`, () => {
    if (liveViewProblem(null)) blocked(liveViewProblem(null)!);
    const dir = temp();
    const path = join(dir, 'bars-1080p-untagged.mp4');
    untaggedBars1080(path);
    const store = join(dir, 'store');
    const sha = putStore(store, readFileSync(path));
    const doc = documentOf('bars', 'board', [1920, 1080], [videoItem('bars', sha, [0, 0, 1920, 1080], {}, { sampling: 'nearest' })], { bars: asset(sha) }, {}, { span: '1s' });
    const line = (out: string, planted?: string): JsonObject => ({ out, doc, look: LOOK, view: { zoom: 1, theme: 'light' }, t: 0, store, ...(planted ? { planted } : {}) });
    const outs = [join(dir, 'live.png'), join(dir, 'stock.png')];
    const answers = renderLines(renderBin(), 'render', [line(outs[0]!), line(outs[1]!, 'stock_bt601_fragment')]);
    const problem = liveViewProblem(answers[0]!);
    if (problem) blocked(problem);
    const failures = answers.map((a, i) => {
      expect(a['ok'], `render ${i === 0 ? 'live' : 'planted stock_bt601_fragment'} refused: ${JSON.stringify(a).slice(0, 1500)}`).toBe(true);
      const img = decodePng(readFileSync(outs[i]!));
      expect([img.width, img.height], 'the frame is the document\'s size').toEqual([1920, 1080]);
      return barsErrors(img, 2).map((e) => `the live shader by the probe's color.matrix (bt709, assumed) and color.range (limited, assumed): the ${e.bar} bar draws (${e.got.join(', ')}), ${e.off} code values from the 75% bars' (${e.want.join(', ')}), over ±2`);
    });
    expect(failures[0], 'the untagged 1080p bars drawn live are within ±2 code values of BT.709').toEqual([]);
    expect(failures[1]!.length, 'the stock full-range BT.601 fragment misses the bars and fails').toBeGreaterThan(0);
    expect(failures[1]!.every((f) => f.includes('color.matrix')), `its failures name the field, color.matrix; got ${JSON.stringify(failures[1]!.slice(0, 3))}`).toBe(true);
  }, TIMEOUT);
});
