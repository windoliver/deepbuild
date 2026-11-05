// Criterion 5: "A table whose x reads 0, 2, 1 is refused at check, naming index 2; one that holds a NaN is refused,
// naming its index; and one of 4,097 points is refused, naming the cap"
//
// Through `deep-motion eval`: a driver reads `table(tpack.t, s)` from a table the eval line's pack holds (README:
// tables); the document's check refuses the line. The NaN reaches the check as a data asset's f64 bytes (base64),
// since JSON has no NaN. "Naming index 2" is a member `index: 2` in the refusal, "naming the cap" a member `cap:
// 4096`; each refusal also names the table. A well-formed table is accepted (the control). No upstream test.
import { describe, expect, it } from 'vitest';
import { TIMEOUT, evalAll, f64Base64, fieldIn, film, keyed, key, mentions, rect, refusal, show, useMotion, type JsonObject, type JsonValue } from './helpers.ts';

const motion = useMotion();

const doc = (id: string): JsonObject => film(id, [rect('a')], {
  channels: { s: keyed('items/a/at/pos/1', { k0: key(0, 0), k1: key(1, 4) }) },
  drivers: { d: { target: 'items/a/at/pos/0', expr: 'table(tpack.t, s)', vars: { s: 'items/a/at/pos/1' } } },
});
const line = (id: string, t: JsonObject): { doc: JsonObject; times: number[]; packs: JsonObject[] } => ({ doc: doc(id), times: [0], packs: [{ name: 'tpack', tables: { t } }] });

describe('criterion 5: a malformed function table is refused at check, naming the index or the cap', () => {
  it('criterion 5: x reading 0, 2, 1 is refused naming index 2; a NaN is refused naming its index; 4,097 points are refused naming the cap; a well-formed table is accepted', () => {
    const big = Array.from({ length: 4097 }, (_, i) => i);
    const [order, nan, cap, good] = evalAll(motion.bin(), [
      line('x-order', { x: [0, 2, 1], y: [0, 1, 2] }),
      line('y-nan', { x: [0, 1, 2], y: { f64: f64Base64([0, NaN, 1]) } }),
      line('cap', { x: big, y: big }),
      line('good', { x: [0, 1, 2], y: [0, 1, 2] }),
    ]) as [JsonObject, JsonObject, JsonObject, JsonObject];
    const named = (r: JsonObject, k: string, v: number, what: string): void => {
      refusal(r, what);
      expect(fieldIn(r as JsonValue, k), `${what}: the refusal names ${k} ${v}: ${show(r)}`).toBe(v);
      expect(mentions(r, 'tpack.t'), `${what}: the refusal names the table tpack.t: ${show(r)}`).toBe(true);
    };
    named(order, 'index', 2, 'x reading 0, 2, 1');
    named(nan, 'index', 1, 'a NaN at index 1');
    named(cap, 'cap', 4096, 'a table of 4,097 points');
    expect(good['ok'], `a well-formed table is accepted: ${show(good)}`).toBe(true);
  }, TIMEOUT);
});
