// Criterion 1: "A 120 BPM beat grid places beat k at exactly k × 352,800,000 flicks for k up to 100,000; a planted
// grid kept in f32 seconds fails, naming the first beat that differs"
//
// Through `deep-motion eval`. One film with a one-segment tempo map, 120 BPM in 4/4 for 100,004 beats (25,001 whole
// bars), and one marker per beat k = 0 … 100,000 written in the time grammar's bar:beat form (beat k is bar
// ⌊k ÷ 4⌋ + 1, beat k mod 4 + 1). Each marker's resolved flick (the answer's `markers.<id>.t`) must be exactly
// k × 352,800,000. The same document under the planted program `beat_grid_f32_seconds` (README: Planted programs)
// must fail the same check, its first failure naming the first beat whose flick differs, beat 13 by the plant's
// definition (computed here in f32). No upstream test (oracle page).
import { describe, expect, it } from 'vitest';
import { TIMEOUT, accepted, beatText, evalOne, f32GridFirstWrong, film, markerTOr, segment, tempoMap, useMotion, type Accepted, type JsonObject } from './helpers.ts';

const motion = useMotion();
const LAST = 100_000;
const PER_BEAT = 352_800_000;

function gridDoc(): JsonObject {
  const markers: JsonObject = {};
  for (let k = 0; k <= LAST; k++) markers[`b${k}`] = { kind: 'cue', t: beatText(k, 4) };
  return film('grid', [], { tempo_map: tempoMap([segment('0s', 120, [4, 4], 100_004)]), markers }, { span: '50002s' });
}
/** The check: one failure per beat whose marker isn't at k × 352,800,000, in beat order, each starting `beat <k>:`. */
function gridFailures(a: Accepted): string[] {
  const failures: string[] = [];
  for (let k = 0; k <= LAST; k++) {
    const t = markerTOr(a, `b${k}`);
    if (t !== k * PER_BEAT) failures.push(`beat ${k}: marker b${k} (${beatText(k, 4)}) resolves to ${t} flicks, not ${k * PER_BEAT}`);
  }
  return failures;
}

describe('criterion 1: a 120 BPM beat grid is exact to the flick for 100,000 beats', () => {
  it('criterion 1: every beat k = 0 … 100,000 of a 120 BPM grid lands at exactly k × 352,800,000 flicks', () => {
    const doc = gridDoc();
    const a = accepted(evalOne(motion.bin(), { doc, times: [0] }), [0], 'the 120 BPM grid');
    const failures = gridFailures(a);
    expect(failures, `the grid's beats:\n  ${failures.slice(0, 20).join('\n  ')}`).toEqual([]);
  }, TIMEOUT);

  it('criterion 1: a planted grid kept in f32 seconds fails the check, its first failure naming the first beat that differs', () => {
    const expectedFirst = f32GridFirstWrong(120, LAST);
    expect(expectedFirst, 'the plant as README defines it differs from the exact grid within 100,000 beats').toBe(13);
    const a = accepted(evalOne(motion.bin(), { doc: gridDoc(), times: [0], planted: 'beat_grid_f32_seconds' }), [0], 'the planted f32 grid');
    const failures = gridFailures(a);
    expect(failures.length, 'the planted f32 grid passes the check it must fail').toBeGreaterThan(0);
    expect(failures[0]!.startsWith(`beat ${expectedFirst}:`), `the first failure names beat ${expectedFirst}, the first that differs; it reads: ${failures[0]}`).toBe(true);
  }, TIMEOUT);
});
