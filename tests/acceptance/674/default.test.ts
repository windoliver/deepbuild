import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  CHECKER_SIZE, SPRITE_SIZE, back, checkerDoc, checkerPng, decodePng, firstDifference, forShow, gpui, put, scratch, spriteDoc, spritePng,
  useBinaries, vello, type Image, type JsonObject,
} from './helpers.ts';

useBinaries('deep-canvas-render', 'deep-show');
const dir = scratch('default');
const checkerBytes = checkerPng();
const spriteBytes = spritePng();
const checker = put(dir, checkerBytes);
const sprite = put(dir, spriteBytes);

/** A golden: the PNG the base commit's code drew for this document on this path (made by fixtures/make-base.ts, never by hand). */
const golden = (name: string): Image => decodePng(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'base', `${name}.png`)));

/** The two documents with no `sampling` field. */
const plain = { checker: checkerDoc(checker), sprite: spriteDoc(sprite) };

describe('AC3 an image without sampling draws byte for byte as it does on the base commit, on every path', () => {
  const views = [{ path: 'gpui', zoom: 1 }, { path: 'gpui', zoom: 2 }, { path: 'vello', zoom: 1 }, { path: 'vello', zoom: 2 }] as const;
  for (const { path, zoom } of views) {
    it(`AC3 ${path === 'gpui' ? 'GPUI' : 'Vello CPU raster'} at zoom ${zoom}: the checker and the sprite read the base commit's pixels`, () => {
      const draw = (doc: JsonObject, what: string): Image => (path === 'gpui' ? gpui(dir, doc, { zoom }, what) : vello(dir, doc, { zoom }, what));
      expect(firstDifference(draw(plain.checker, 'the checker'), golden(`checker-${path}${zoom}`)), `${path} at zoom ${zoom}, the checker with no sampling: first pixel off the base commit's draw`).toBeNull();
      expect(firstDifference(draw(plain.sprite, 'the sprite'), golden(`sprite-${path}${zoom}`)), `${path} at zoom ${zoom}, the cropped half-opaque sprite at a fractional box with no sampling: first pixel off the base commit's draw`).toBeNull();
    }, 300_000);
  }

  it('AC3 render-back: the checker and the sprite read the base commit\'s pixels', async () => {
    const checkerShot = await back(dir, checkerBytes, (a) => forShow(checkerDoc(a), a), CHECKER_SIZE, 'render-back of the checker');
    expect(firstDifference(checkerShot, golden('checker-back')), 'render-back, the checker with no sampling: first pixel off the base commit\'s draw').toBeNull();
    const spriteShot = await back(dir, spriteBytes, (a) => forShow(spriteDoc(a), a), SPRITE_SIZE, 'render-back of the sprite');
    expect(firstDifference(spriteShot, golden('sprite-back')), 'render-back, the sprite with no sampling: first pixel off the base commit\'s draw').toBeNull();
  }, 300_000);

  it('AC3 sampling: linear, the default written out, draws the same bytes as no field, on every path', async () => {
    const written = checkerDoc(checker, { sampling: 'linear' });
    for (const { path, zoom } of views) {
      const image = path === 'gpui' ? gpui(dir, written, { zoom }, 'the checker, linear') : vello(dir, written, { zoom }, 'the checker, linear');
      expect(firstDifference(image, golden(`checker-${path}${zoom}`)), `${path} at zoom ${zoom}, the checker with sampling: linear: first pixel off the base commit's draw with no field`).toBeNull();
    }
    const shot = await back(dir, checkerBytes, (a) => forShow(checkerDoc(a, { sampling: 'linear' }), a), CHECKER_SIZE, 'render-back of the checker, linear');
    expect(firstDifference(shot, golden('checker-back')), 'render-back, the checker with sampling: linear: first pixel off the base commit\'s draw with no field').toBeNull();
  }, 300_000);
});
