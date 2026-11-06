// Criterion 5: "Over `markers.beat` filtered by the tag kick, with kicks at 1.0, 2.5 and 4.0 s whose payloads carry
// gain 0.6, 0.8 and 1.0, a driver at t = 3 s reads count 2, last 2.5 s, since 0.5 s, next 4.0 s, rank 1 and
// last(kicks).gain 0.8; at t = 0.5 s count reads 0 and last(kicks).gain takes the driver's fallback; and next over a
// list that inputs feed is refused at check, naming the driver"
//
// Through `deep-motion eval`. A 120 BPM film whose beat markers sit on its tempo map: kicks (tag `kick`) at `1:3b`,
// `2:2b` and `3:1b` (1.0, 2.5 and 4.0 s) with payloads `{gain: 0.6}`, `{gain: 0.8}`, `{gain: 1.0}`, and snares (tag
// `snare`, gains 0.3 and 0.4) between them at `2:1b` and `2:4b` (2.0 and 3.5 s), which the filter must leave out.
// Six drivers, each binding `kicks` to `{list: "markers.beat", tags: ["kick"]}` with `fallback: 0.25`, write
// count(kicks), last(kicks), since(kicks), next(kicks), rank(kicks) and last(kicks).gain to their own items'
// `at/pos/0`. The design writes last and next as flicks and since as t minus last; the tests take the three times
// in seconds or in flicks, one unit for all three (README: Choices). A driver reading next(taps) over the input
// track's entries for the control `tap` (`input.tap`, a list inputs feed) is refused naming the driver, while
// last(taps) over the same list is accepted and reads the entry's time. No upstream test (oracle page).
import { describe, expect, it } from 'vitest';
import { FLICKS, TIMEOUT, evalOk, evalOne, film, fl, mentions, posAt, rect, refused, segment, show, tempoMap, useMotion, type JsonObject } from './helpers.ts';

const motion = useMotion();
const kicks = { list: 'markers.beat', tags: ['kick'] };
const READS: [string, string][] = [['count', 'count(kicks)'], ['last', 'last(kicks)'], ['since', 'since(kicks)'], ['next', 'next(kicks)'], ['rank', 'rank(kicks)'], ['gain', 'last(kicks).gain']];

function beatDoc(): JsonObject {
  const beat = (t: string, tag: string, gain: number): JsonObject => ({ kind: 'beat', t, tags: [tag], payload: { gain } });
  return film('kicks', READS.map(([q], i) => rect(`q_${q}`, [20 + 30 * i, 20])), {
    tempo_map: tempoMap([segment('0s', 120, [4, 4], 12)]),
    markers: { k1: beat('1:3b', 'kick', 0.6), s1: beat('2:1b', 'snare', 0.3), k2: beat('2:2b', 'kick', 0.8), s2: beat('2:4b', 'snare', 0.4), k3: beat('3:1b', 'kick', 1.0) },
    drivers: Object.fromEntries(READS.map(([q, expr]) => [`d_${q}`, { target: `items/q_${q}/at/pos/0`, expr, vars: { kicks }, fallback: 0.25 }])),
  });
}
/** The unit a time read is in: seconds within 1e-9, or flicks within one flick; null when it is neither. */
function unitOf(v: number, seconds: number): 's' | 'flicks' | null {
  if (Math.abs(v - seconds) <= 1e-9) return 's';
  if (Math.abs(v - fl(seconds)) <= 1) return 'flicks';
  return null;
}
function inputDoc(expr: string): JsonObject {
  return film('taps', [rect('q_peek', [20, 20])], {
    controls: { tap: { kind: 'slider', class: 'document', label: 'Tap', range: [0, 1], default: 0 } },
    drivers: { peek: { target: 'items/q_peek/at/pos/0', expr, vars: { taps: { list: 'input.tap' } }, fallback: 0.25 } },
  });
}

describe('criterion 5: drivers read occurrence lists through count, last, since, next and rank', () => {
  it('criterion 5: at t = 3 s the driver reads count 2, last 2.5 s, since 0.5 s, next 4.0 s, rank 1 and last(kicks).gain 0.8', () => {
    const a = evalOk(motion.bin(), { doc: beatDoc(), times: [fl(3)] }, 'the kick drivers');
    const f = a.frames[0]!;
    const v = Object.fromEntries(READS.map(([q]) => [q, posAt(f, `q_${q}`, 0)])) as Record<string, number>;
    expect(v['count'], 'count(kicks) at 3 s').toBe(2);
    expect(v['rank'], 'rank(kicks) at 3 s').toBe(1);
    expect(Math.abs(v['gain']! - 0.8), `last(kicks).gain at 3 s reads ${v['gain']}, not 0.8`).toBeLessThanOrEqual(1e-12);
    const units = [unitOf(v['last']!, 2.5), unitOf(v['since']!, 0.5), unitOf(v['next']!, 4.0)];
    expect(units[0], `last(kicks) at 3 s reads ${v['last']}, neither 2.5 s nor ${fl(2.5)} flicks`).not.toBeNull();
    expect(units, `last, since and next at 3 s read 2.5 s, 0.5 s and 4.0 s in one unit: ${v['last']}, ${v['since']}, ${v['next']} (${FLICKS} flicks a second)`).toEqual([units[0], units[0], units[0]]);
  }, TIMEOUT);

  it('criterion 5: at t = 0.5 s count reads 0 and last(kicks).gain takes the driver\'s fallback', () => {
    const a = evalOk(motion.bin(), { doc: beatDoc(), times: [fl(0.5)] }, 'the kick drivers');
    const f = a.frames[0]!;
    expect(posAt(f, 'q_count', 0), 'count(kicks) at 0.5 s').toBe(0);
    expect(posAt(f, 'q_gain', 0), 'last(kicks).gain at 0.5 s takes the fallback 0.25').toBe(0.25);
  }, TIMEOUT);

  it('criterion 5: next over a list that inputs feed is refused at check, naming the driver', () => {
    const entry = { t: fl(1.5), seq: 1, control: 'tap', value: 1, writer: 'you' };
    const last = evalOk(motion.bin(), { doc: inputDoc('last(taps)'), times: [fl(2)], input: [entry] }, 'last over the input-fed list');
    const read = posAt(last.frames[0]!, 'q_peek', 0);
    expect(unitOf(read, 1.5), `last(taps) at 2 s reads the entry's 1.5 s (or ${fl(1.5)} flicks), got ${read}`).not.toBeNull();
    const r = refused(evalOne(motion.bin(), { doc: inputDoc('next(taps)'), times: [fl(2)], input: [entry] }), 'next over the input-fed list');
    expect(mentions(r, 'peek'), `the refusal names the driver peek: ${show(r)}`).toBe(true);
  }, TIMEOUT);
});
