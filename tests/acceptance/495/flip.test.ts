// AC4 #495.ece8b00e: A flip group shows exactly one child at every time: the one named by the last key at or before it.
//
// Through `deep-gpu run`'s `layers` (the PNG at t): four 20 x 20 rects c0 to c3 side by side in a group whose `flip` (on
// `group@1`, in params) shows one; a child shows when its centre's alpha is over 0, and the test needs exactly the expected
// set. Keys form: {keys: [{t, show}]} with `none` among the shows, read at every key's flick, one flick before it, and 150
// seeded times. Occurrence form: {from: {list: "markers.cue"}, map: {value: child ID}} over cue markers whose payload.value
// is a viseme (README: Choices 3), read between and at the cues. A value past the last key or cue holds.
// Wrong programs: a flip that shows the next key early or the previous late (the flicks at a key), that blends two drawings,
// shows two children, shows the first child always or all of them (no flip), or reads the nearest key.
import { describe, expect, it } from 'vitest';
import { AC, TIMEOUT, FLICKS, fl, film, item, layerImage, layersCall, none, pixel, rect, runGpu, seeded, useDir, useGpu, type JsonObject, type JsonValue } from './helpers.ts';

const gpu = useGpu();
const dir = useDir();
const CHILDREN = ['c0', 'c1', 'c2', 'c3'];

function flipDoc(flip: JsonValue, extra: JsonObject = {}): JsonObject {
  return film('flip', [200, 40], [item('g', 'group@1', 'a0', { flip }), ...CHILDREN.map((c, i) => rect(c, `a${i + 1}`, [10 + 40 * i, 10, 20, 20], 'accent', { parent: 'g' }))], extra, '4s');
}
/** The children drawn at each time, one `layers` call each. */
function shown(times: number[], doc: JsonObject): string[][] {
  const out = dir();
  const replies = runGpu(gpu(), out, times.map((t) => layersCall(doc, t)));
  return replies.map((r, i) => { const im = layerImage(out, r, `the flip at ${times[i]} flicks`); return CHILDREN.filter((_, c) => pixel(im, 20 + 40 * c, 20)[3] > 0); });
}
const KEYS: [number, string][] = [[0, 'c0'], [0.5, 'c2'], [1, 'none'], [1.5, 'c1'], [1.6, 'c3']];
const lastAtOrBefore = (keys: [number, string][], t: number): string[] => { const k = keys.filter(([s]) => fl(s) <= t).pop(); return k && k[1] !== 'none' ? [k[1]] : []; };

describe(`${AC[4]} a flip group shows exactly one child, the one its last key at or before t names`, () => {
  it(`${AC[4]} the keys form, with none among them, at each key, one flick before it and 150 random times`, () => {
    const r = seeded(495);
    const times = [...KEYS.flatMap(([s]) => [fl(s), fl(s) - 1].filter((t) => t >= 0)), ...Array.from({ length: 150 }, () => Math.floor(r() * fl(2.5)))];
    const got = shown(times, flipDoc({ keys: KEYS.map(([s, show]) => ({ t: `${s}s`, show })) }));
    none(times.flatMap((t, i) => JSON.stringify(got[i]) === JSON.stringify(lastAtOrBefore(KEYS, t)) ? [] : [`at ${t} flicks (${(t / FLICKS).toFixed(4)} s) the shown children are [${got[i]}], the last key names [${lastAtOrBefore(KEYS, t)}]`]), 'the keys form');
  }, TIMEOUT);

  it(`${AC[4]} the occurrence form shows the child its map gives the last cue's value, held until the next cue`, () => {
    const CUES: [number, string][] = [[0.2, 'B'], [0.7, 'A'], [1.3, 'C']];
    const MAP: Record<string, string> = { A: 'c0', B: 'c1', C: 'c3' };
    const doc = flipDoc({ from: { list: 'markers.cue' }, map: MAP }, { markers: Object.fromEntries(CUES.map(([s, value], i) => [`v${i}`, { kind: 'cue', t: `${s}s`, payload: { value } }])) });
    const times = [fl(0.2), fl(0.2) + 1, fl(0.45), fl(0.7) - 1, fl(0.7), fl(1.0), fl(1.3) - 1, fl(1.3), fl(3)];
    const got = shown(times, doc);
    none(times.flatMap((t, i) => {
      const cue = CUES.filter(([s]) => fl(s) <= t).pop();
      const want = cue ? [MAP[cue[1]]!] : [];
      return JSON.stringify(got[i]) === JSON.stringify(want) ? [] : [`at ${t} flicks the shown children are [${got[i]}], the last cue names [${want}]`];
    }), 'the occurrence form');
    expect(got.length).toBe(times.length);
  }, TIMEOUT);
});
