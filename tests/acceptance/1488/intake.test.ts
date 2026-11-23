// AC3 #1488.b1cba5dc: A WebP becomes a PNG asset by hash with its source named, and two imports give one hash.
//
// Through `deep-show run`'s `media_import` (#498's call, the intake): a lossless 120 × 80 WebP of four flat quarters
// (README: Fixtures) is imported, and the reply's asset is the PNG the intake made *(chosen reading of where the reply
// says so)*: `asset.sha256` names a file in the run's evidence store whose bytes hash to it and are a PNG of the WebP's
// size and quarters; `asset.made_by` names its source as Asset's `made_by` fields have it: `input` the WebP's SHA-256,
// whose bytes the store keeps, and `tool` and `version` the converter. Two imports are two runs, each its own process
// and evidence store, so nothing either kept can make them agree: both give the one hash. The wrong program is the
// merge base, which refuses a WebP `unreadable` (BASE-FAILURE.txt).

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isObject, useBinary, useTemp } from '../499/video/helpers.ts';
import {
  AC, COLORS, STORED, TOLERANCE, WEBP, answered, importCall, isPng, nearest, pixel, readPng, refusal, scenario, sha256, show, showRun, webpFixture,
  type Corner, type JsonObject,
} from './helpers.ts';

const showBin = useBinary('deep-show');
const temp = useTemp('1488-intake');
const stored = (evidence: string, h: string): string => join(evidence, h.slice(0, 2), h.slice(2));

describe('AC3 #1488.b1cba5dc a WebP converted at intake to a PNG asset', () => {
  it('AC3 #1488.b1cba5dc a WebP becomes a PNG asset by hash with its source named in made_by, and two imports give one hash', () => {
    const dir = temp();
    const webp = webpFixture(dir);
    const source = sha256(readFileSync(webp));
    const imports = ['first', 'second'].map((n) => {
      const evidence = join(dir, `evidence-${n}`);
      const [reply] = answered(showRun(showBin(), scenario(evidence, [importCall(webp)])), `the ${n} import of the WebP`) as [JsonObject];
      return { evidence, reply };
    });

    const { evidence, reply } = imports[0]!;
    expect(refusal(reply), `the intake refuses the WebP: ${show(reply)}`).toBeNull();
    expect(isObject(reply['asset']), `media_import answers an asset: ${show(reply)}`).toBe(true);
    const a = reply['asset'] as JsonObject;
    expect(a['kind'], 'the asset is an image').toBe('image');
    const h = a['sha256'];
    expect(typeof h === 'string' && /^[0-9a-f]{64}$/.test(h), `the asset has a SHA-256: ${show(a)}`).toBe(true);
    const hash = h as string;
    expect(hash, 'the asset is the converted PNG, not the WebP itself').not.toBe(source);

    // A PNG asset by hash: the store holds it under its hash, and it is the WebP's picture.
    expect(existsSync(stored(evidence, hash)), `the evidence store holds the asset ${hash}`).toBe(true);
    const png = readFileSync(stored(evidence, hash));
    expect(sha256(png), 'the stored asset hashes to its name').toBe(hash);
    expect(isPng(png), `the asset is a PNG (signature, then IHDR); it starts ${png.subarray(0, 16).toString('hex')}`).toBe(true);
    const image = readPng(png);
    expect([image.width, image.height], `the PNG is the WebP's ${WEBP.w} × ${WEBP.h}`).toEqual([WEBP.w, WEBP.h]);
    const at: Record<Corner, [number, number]> = { 'top-left': [6, 6], 'top-right': [WEBP.w - 7, 6], 'bottom-left': [6, WEBP.h - 7], 'bottom-right': [WEBP.w - 7, WEBP.h - 7] };
    for (const [corner, [x, y]] of Object.entries(at) as [Corner, [number, number]][]) {
      const got = pixel(image, x, y);
      const n = nearest(got);
      expect(n.name === STORED[corner] && n.off <= TOLERANCE, `the PNG's ${corner} pixel (${x}, ${y}) is (${got.join(', ')}), the WebP's is ${STORED[corner]} (${COLORS[STORED[corner]].join(', ')})`).toBe(true);
    }

    // Its source named: made_by's input is the WebP's hash, the store keeps the WebP, and the converter is named.
    expect(isObject(a['made_by']), `the asset has made_by: ${show(a)}`).toBe(true);
    const made = a['made_by'] as JsonObject;
    expect(made['input'], `made_by.input names the source WebP by its SHA-256: ${show(made)}`).toBe(source);
    for (const f of ['tool', 'version']) expect(typeof made[f] === 'string' && made[f] !== '', `made_by.${f} names the converter: ${show(made)}`).toBe(true);
    expect(existsSync(stored(evidence, source)) && sha256(readFileSync(stored(evidence, source))) === source, `the evidence store keeps the source WebP under ${source}`).toBe(true);

    // Two imports give one hash.
    const second = imports[1]!;
    expect(refusal(second.reply), `the second import refuses the WebP: ${show(second.reply)}`).toBeNull();
    const again = isObject(second.reply['asset']) ? second.reply['asset']['sha256'] : undefined;
    expect(again, `the second import, in its own process and store, gives the same asset hash; it answers ${show(second.reply)}`).toBe(hash);
    console.log(`${AC[3]}: the WebP ${source} became the PNG asset ${hash}, made by ${String(made['tool'])} ${String(made['version'])}`);
  }, 3_600_000);
});
