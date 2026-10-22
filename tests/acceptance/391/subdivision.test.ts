import { describe, expect, it } from 'vitest';
import {
  MOTION_BIN, accepted, arr, canonical, channelOf, clone, evalFrames, fixture, floatEq, isObject, num, obj, sec, ulps64, useBinaries,
  type JsonObject, type JsonValue,
} from './helpers.ts';

useBinaries('deep-motion');

const FILM = fixture('parity/animation/subdivision-stable.film');

/** Where each channel of the fixture takes its new key: always on a linear segment, never at a key. */
const INSERTS: { channel: string; t: number; why: string }[] = [
  { channel: 'lin', t: sec(1), why: 'a linear channel, a quarter of the way along its one segment' },
  { channel: 'held', t: sec(3), why: 'the linear segment after a hold segment' },
  { channel: 'curve', t: sec(3), why: 'the linear segment after a Bézier segment' },
  { channel: 'tint', t: sec(1), why: 'an OKLab color channel, a quarter of the way along' },
];

// Every 10 ms across the film's 4 s, keys and the inserted times among them, and a time either side.
const TIMES = [sec(-0.5), ...Array.from({ length: 401 }, (_, k) => k * sec(0.01)), sec(4.5)];

/** A channel value's f64 components: an f32 channel's number, or a color's [L, a, b]. */
function components(value: JsonValue | undefined, what: string): number[] {
  if (typeof value === 'number') return [value];
  return arr(value, what).map((v, i) => num(v, `${what}[${i}]`));
}

function keysOf(doc: JsonObject, channel: string): JsonObject {
  return obj(obj(obj(doc['channels'], 'channels')[channel], `channels.${channel}`)['keys'], `channels.${channel}.keys`);
}

function insert(doc: JsonObject, channel: string, t: number): { doc: JsonObject; key: string } {
  const out = accepted(MOTION_BIN, 'insert', { doc, channel, t });
  expect(typeof out['key'], `insert ${channel} at ${t}: the new key's ID`).toBe('string');
  return { doc: obj(out['doc'], `insert ${channel}: doc`), key: out['key'] as string };
}

describe('AC4 a key inserted at the curve\'s own value on a linear segment changes nothing within 1 ulp in f64 (parity/animation/subdivision-stable.film)', () => {
  for (const { channel, t, why } of INSERTS) {
    it(`AC4 ${channel}: ${why}`, () => {
      const before = evalFrames(FILM, TIMES);
      const { doc: after, key } = insert(clone(FILM), channel, t);
      const keys = keysOf(after, channel);
      expect(Object.keys(keys).length, `${channel}: one key more`).toBe(Object.keys(keysOf(FILM, channel)).length + 1);
      const added = obj(keys[key], `${channel}: the new key ${key}`);
      // The new key owns the rest of the segment it split, so it interpolates the way that segment did.
      expect(added['interp'], `${channel}: the new key keeps the split segment's interpolation`).toBe('linear');
      // It sits at the curve's own value: bit for bit what the channel evaluated there before.
      const at = TIMES.indexOf(t);
      const own = components(channelOf(before[at]!, channel)['value'], `${channel} at ${t}`);
      expect(components(added['value'], `${channel}: the new key's value`).map((v, i) => ulps64(v, own[i]!)), `${channel}: the new key's value is the curve's own`).toEqual(own.map(() => 0n));
      // No other key or channel changed: without the new key the channels are the fixture's again.
      const without = clone(after);
      delete keysOf(without, channel)[key];
      expect(canonical(without['channels']), `${channel}: the insert changed nothing but adding its key`).toBe(canonical(FILM['channels']));

      // And the curve is the same curve: within 1 ulp in f64 at every sample, on every channel.
      const afterFrames = evalFrames(after, TIMES);
      const off: string[] = [];
      for (const id of INSERTS.map((i) => i.channel)) {
        TIMES.forEach((time, i) => {
          const a = components(channelOf(before[i]!, id)['value'], `${id} before at ${time}`);
          const b = components(channelOf(afterFrames[i]!, id)['value'], `${id} after at ${time}`);
          a.forEach((v, c) => {
            const d = ulps64(v, b[c]!);
            if (d > 1n) off.push(`${id}${a.length > 1 ? `[${c}]` : ''} at t=${time} (${(time / sec(1)).toFixed(2)} s): ${v} before, ${b[c]} after, ${d} ulps apart`);
          });
        });
      }
      expect(off.slice(0, 20), `inserting into ${channel} moved the curve by more than 1 ulp (${off.length} samples)`).toEqual([]);
    });
  }
});

describe('AC4 Blender\'s Bézier subdivision, ported: a key inserted at the curve\'s own value on a Bézier segment splits its handles so the curve keeps its shape', () => {
  // blenkernel/intern/fcurve_test.cc at 0a18557098, BKE_fcurve_bezt_subdivide_handles: keys (1, 0) and
  // (13, 2), the first's right handle at (2, 4), the second's left handle at (13, -2); a key at x = 7.375,
  // where the curve is 1 (y_delta 0). Expected: the first key's right handle (1.5, 2), the new key's handles
  // (4.5, 1.5) and (10.25, 0.5), the second key's left handle (13, 0). Blender is GPL: only these values
  // are restated, as data. In this design's normalized handles (x over the segment's span, y over its value
  // change) the original is bezier {1/12, 2, 1, -1} over [1 s, 13 s], and the split ones follow below.
  const doc: JsonObject = {
    format: 1, id: 'subdivide-391', profile: 'film', title: 'Bezier subdivision', description: 'Blender\'s subdivision case.', size: [320, 180],
    layers: { main: { writer: 'agent-a', title: 'Main', order: 'a0' } },
    items: { box: { id: 'box', kind: 'rect@1', layer: 'main', name: 'Box', order: 'a0', params: { box: [0, 0, 10, 10], paint: { fill: { role: 'accent' } } } } },
    channels: {
      bez: {
        target: 'items/box/at/pos/0', type: 'f32',
        keys: {
          a: { t: '1s', value: 0, interp: { bezier: { x1: 1 / 12, y1: 2, x2: 1, y2: -1 } } },
          b: { t: '13s', value: 2, interp: 'linear' },
        },
      },
    },
  };
  const T = sec(7.375);

  function bezierOf(key: JsonValue | undefined, what: string): [number, number, number, number] {
    const interp = obj(key, what)['interp'];
    expect(isObject(interp) && isObject(interp['bezier']), `${what} interpolates by Bézier, got ${JSON.stringify(interp)}`).toBe(true);
    const h = (interp as JsonObject)['bezier'] as JsonObject;
    return [num(h['x1'], `${what}.x1`), num(h['y1'], `${what}.y1`), num(h['x2'], `${what}.x2`), num(h['y2'], `${what}.y2`)];
  }
  const same = (got: number[], want: number[]): boolean => got.length === want.length && got.every((g, i) => floatEq(g, want[i]!));

  it('AC4 the split handles and the new key\'s value are Blender\'s, within its EXPECT_FLOAT_EQ', () => {
    const { doc: after, key } = insert(clone(doc), 'bez', T);
    const keys = keysOf(after, 'bez');
    expect(Object.keys(keys).sort(), 'the two keys and the new one').toEqual(['a', 'b', key].sort());
    expect(floatEq(num(obj(keys[key], 'new key')['value'], 'new key value'), 1), `the new key sits at the curve's own value, 1 (y_delta 0): ${JSON.stringify(keys[key])}`).toBe(true);
    // Left segment [1 s, 7.375 s], 0 → 1: handles (1.5, 2) and (4.5, 1.5).
    const left = [0.5 / 6.375, 2, 3.5 / 6.375, 1.5];
    expect(same(bezierOf(keys['a'], 'key a'), left), `key a's handles are split to ${JSON.stringify(left)}, got ${JSON.stringify(bezierOf(keys['a'], 'key a'))}`).toBe(true);
    // Right segment [7.375 s, 13 s], 1 → 2: handles (10.25, 0.5) and (13, 0).
    const right = [2.875 / 5.625, -0.5, 1, -1];
    expect(same(bezierOf(keys[key], 'new key'), right), `the new key's handles are ${JSON.stringify(right)}, got ${JSON.stringify(bezierOf(keys[key], 'new key'))}`).toBe(true);
    expect(canonical(keys['b']), 'key b is untouched').toBe(canonical(obj(obj(obj(doc['channels'], 'channels')['bez'], 'bez')['keys'], 'keys')['b']));
  });

  it('AC4 the subdivided curve keeps its shape: every sample within EXPECT_FLOAT_EQ of the original', () => {
    const { doc: after } = insert(clone(doc), 'bez', T);
    const times = Array.from({ length: 141 }, (_, k) => sec(0.1 * k));
    const before = evalFrames(doc, times);
    const afterFrames = evalFrames(after, times);
    const off = times.flatMap((t, i) => {
      const a = num(channelOf(before[i]!, 'bez')['value'], `before at ${t}`);
      const b = num(channelOf(afterFrames[i]!, 'bez')['value'], `after at ${t}`);
      return floatEq(a, b) ? [] : [`t = ${(t / sec(1)).toFixed(1)} s: ${a} before, ${b} after`];
    });
    expect(off, 'the curve changed shape').toEqual([]);
  });
});
