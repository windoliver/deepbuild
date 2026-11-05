// Test-side tools the redrafted tests take in place of ../helpers.ts' sweep documents (redraft/README: D1). The base's
// time grammar refuses a seconds literal with more than five fraction digits, and ../helpers' `holdChannel` writes keys
// at (2n − 1) ÷ 64 s, six digits for every n ≥ 1, so every `bandDoc` and `levelDoc` is refused `bad_time` before a
// frame draws. Here each key sits on the 10 µs tick at or just before half a frame before its frame: a valid literal,
// still strictly between frames n − 1 and n. Everything else is ../helpers', unchanged.

import { expect } from 'vitest';
import {
  BAND_SIZE, BAND_SWEEP, LEVEL_SWEEP, SWEEP_FPS, bandItems, material, sessionDoc, sun, type JsonObject,
} from '../helpers.ts';

/** The time grammar's seconds literal: a decimal of at most five fraction digits (crates/deep-canvas: grammar/time.rs). */
const SECONDS = /^(0|[1-9][0-9]*)(\.[0-9]{1,5})?s$/;
/** Ticks of 10 µs in a second: every decimal of up to five digits is a whole number of them, and of flicks. */
const TICKS = 100_000;

/** `u` ticks of 10 µs as a seconds literal, trailing zeros dropped. */
function seconds(u: number): string {
  const frac = String(u % TICKS).padStart(5, '0').replace(/0+$/, '');
  return `${Math.floor(u / TICKS)}${frac ? `.${frac}` : ''}s`;
}

/** A `hold` channel giving frame n (at t = n ÷ SWEEP_FPS) the value `values[n]`: key 0 at 0 s, key n at the 10 µs
 * tick at or before half a frame before frame n, so frame n lies strictly after key n and strictly before key n + 1. */
export function holdChannel(target: string, values: number[]): JsonObject {
  const keys: JsonObject = {};
  values.forEach((value, n) => {
    const t = n === 0 ? '0s' : seconds(Math.floor(((2 * n - 1) * TICKS) / (2 * SWEEP_FPS)));
    keys[`k${String(n).padStart(4, '0')}`] = { t, value, interp: 'hold' };
  });
  const bad = Object.entries(keys).filter(([, k]) => !SECONDS.test(String((k as JsonObject)['t'])));
  expect(bad.map(([id, k]) => `${id}: ${String((k as JsonObject)['t'])}`), 'every sweep key is a seconds literal of at most five fraction digits').toEqual([]);
  return { target, type: 'f32', keys };
}

/** ../helpers' band sweep document, its dolly keyed by this file's `holdChannel`. */
export const bandDoc = (): JsonObject =>
  sessionDoc('bands-425', BAND_SIZE, bandItems(), { channels: { dolly: holdChannel('items/cam/params/position/2', BAND_SWEEP.values) } });

/** ../helpers' level sweep document, its dolly keyed by this file's `holdChannel`. */
export const levelDoc = (sha: string): JsonObject => sessionDoc('levels-425', BAND_SIZE, {
  cam: { kind: 'camera@1', params: { projection: 'perspective', position: [0, 0, 1.5], target: [0, 0, 0], fov: 40, near: 0.05, far: 200 } },
  clay: material([0.7, 0.5, 0.35], 0.6),
  rock: { kind: 'mesh.asset@1', params: { sha256: sha, node: 0 }, at: { pos: [0, 0, 0] }, material: 'clay' },
  sun: sun(3),
}, { channels: { dolly: holdChannel('items/cam/params/position/2', LEVEL_SWEEP.values) } });
