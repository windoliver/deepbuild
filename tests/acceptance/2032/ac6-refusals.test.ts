// AC6 #2032.94551e97: "Over 6 s with 4 moving lights and 200 moving occluder segments, the frames at 1 s, 3 s and 5 s have
// the same pixel hash by seeking and by playing. An open path with `occlude: true` is refused at check, and a group of
// 4,097 segments is refused with `segments: 4097, cap: 4096`. A planted check that accepts either fails"
//
// This file holds the criterion's second and third sentences; ac6-seek-play.test.ts holds the first.
// Through `deep-canvas-render check` (every platform), with the look `clean`. Each document's group `lamps` holds ambient
// 0.25 and one white point light, and `floor`, a white rect over the whole document:
//   - `closed`: `wall`, a stroked path `M 100 60 L 140 60 L 140 120 L 100 120 Z` with `occlude: true`: accepted, with no
//     error at all (so a check that refuses every occluding path fails here);
//   - `open`: `fence`, the same path with no `Z`, so its last point isn't joined to its first: refused by an error that
//     names `fence` (its `ids` hold it, or its `path` is `items/fence` or under it);
//   - `at-cap`: 41 closed occluding outlines, 40 of 100 corners and one of 96, 4,096 segments in all, and `plain`, a
//     closed outline of 100 corners that doesn't occlude: accepted, with no error at all (so a cap below 4,096, or a
//     count that takes in paths that don't occlude, fails here);
//   - `past-cap`: the same with the last outline of 97 corners, 4,097 segments: refused by an error that reads the count
//     and the cap, `segments: 4097, cap: 4096` in its text, or `segments` 4097 and `cap` 4096 as fields of one object in
//     the issue (README: Readings).
// The planted checks are `"planted": "occlude_accepts_open_path"` and `"planted": "occlude_accepts_past_cap"` in the
// `check` line: the check must take each name (not `bad_input`), and the judgement of the document it accepts must
// fail on its answer.
// Wrong programs: the base (`occlude` isn't read: nothing is refused), an open occluding path let through or closed
// in silence, a cap of 4,097 or more, a cap counted a path at a time.
import { describe, expect, it } from 'vitest';
import {
  AC, blob, distinctCorners, doc, errorsOf, group, issuesOf, item, light, LOOK, outline, rect, render, segments, shown, useBin,
  type Issue, type JsonObject, type JsonValue, type Planted, type Poly,
} from './helpers.ts';

const ID = AC[6];
const bin = useBin('deep-canvas-render');
const lit = (id: string, size: [number, number], items: JsonObject[]): JsonObject => doc(id, size, [
  group('lamps', 'a0', { ambient: 0.25, lights: [light({ at: [80, 60], energy: 0.75, range: 600 })] }),
  rect('floor', 'a1', [0, 0, ...size], 'lamps'),
  ...items,
]);
const SHAPE = 'M 100 60 L 140 60 L 140 120 L 100 120';
const stroked = (id: string, d: string): JsonObject => item(id, 'path@1', 'a2', { d, paint: { stroke: { role: 'accent', width: 2 } }, occlude: true }, { parent: 'lamps' });
/** 41 outlines on a grid of 80 × 60 u cells, the last of `last` corners, the rest of 100. */
const outlines = (last: number): Poly[] => Array.from({ length: 41 }, (_, k) => blob(40 + 80 * (k % 7), 30 + 60 * Math.floor(k / 7), k < 40 ? 100 : last, 24, 4096 + k));
const capped = (id: string, last: number): JsonObject => lit(id, [560, 360], [
  ...outlines(last).map((p, k) => outline(`rock-${k}`, `b${String(k).padStart(2, '0')}`, p, 'lamps', { occlude: true })),
  outline('plain', 'c0', blob(520, 330, 100, 24, 5000), 'lamps'),
]);
const DOCS = {
  closed: lit('occlude-closed', [320, 180], [stroked('wall', `${SHAPE} Z`)]),
  open: lit('occlude-open', [320, 180], [stroked('fence', SHAPE)]),
  atCap: capped('occlude-at-cap', 96),
  pastCap: capped('occlude-past-cap', 97),
};

function check(d: JsonObject, planted?: Planted): { answer: JsonObject; errors: Issue[] } {
  const [answer] = render(bin(), 'check', [{ doc: d, look: LOOK, ...(planted ? { planted } : {}) }]);
  expect(answer!['code'], `check takes the line${planted ? ` with planted ${planted}` : ''}: ${shown(answer)}`).not.toBe('bad_input');
  return { answer: answer!, errors: errorsOf(issuesOf(answer!, `check of ${String(d['id'])}`)) };
}
const names = (e: Issue, id: string): boolean => e.ids.includes(id) || e.path === `items/${id}` || e.path.startsWith(`items/${id}/`);
/** `segments: 4097, cap: 4096` in the issue's text, or one object in it holding `segments` 4097 and `cap` 4096. */
function readsCount(v: JsonValue): boolean {
  if (typeof v === 'string') return v.includes('segments: 4097, cap: 4096');
  if (Array.isArray(v)) return v.some(readsCount);
  if (v !== null && typeof v === 'object') return (v['segments'] === 4097 && v['cap'] === 4096) || Object.values(v).some(readsCount);
  return false;
}
const shownErrors = (errors: Issue[]): string => errors.map((e) => shown(e.raw).slice(0, 400)).join('; ') || 'none';
/** The open path's judgement: refused, by an error naming `fence`. */
function openFailures({ answer, errors }: { answer: JsonObject; errors: Issue[] }): string[] {
  const failures: string[] = [];
  if (answer['ok'] !== false) failures.push(`an open path with occlude: true: the check answers ok ${shown(answer['ok'])}, not a refusal`);
  if (!errors.some((e) => names(e, 'fence'))) failures.push(`an open path with occlude: true: no error names the path fence; errors: ${shownErrors(errors)}`);
  return failures;
}
/** The 4,097-segment group's judgement: refused, by an error that reads the count and the cap. */
function pastCapFailures({ answer, errors }: { answer: JsonObject; errors: Issue[] }): string[] {
  const failures: string[] = [];
  if (answer['ok'] !== false) failures.push(`a group of 4,097 occluder segments: the check answers ok ${shown(answer['ok'])}, not a refusal`);
  if (!errors.some((e) => readsCount(e.raw))) failures.push(`a group of 4,097 occluder segments: no error reads segments: 4097, cap: 4096; errors: ${shownErrors(errors)}`);
  return failures;
}
/** The fixtures hold the counts the criterion names. */
function fixtureHolds(): void {
  expect([segments(outlines(96)), segments(outlines(97)), distinctCorners(outlines(96)), distinctCorners(outlines(97))], 'the occluding outlines hold 4,096 and 4,097 segments, none of no length').toEqual([4096, 4097, true, true]);
}

describe(`${ID} the check refuses an open occluding path and a group past 4,096 occluder segments`, () => {
  it(`${ID} a closed occluding path and 4,096 segments pass; an open one is refused naming the path, and 4,097 segments reading segments: 4097, cap: 4096`, () => {
    fixtureHolds();
    const closed = check(DOCS.closed);
    expect(closed.errors, `a closed path with occlude: true is accepted: ${shownErrors(closed.errors)}`).toEqual([]);
    const atCap = check(DOCS.atCap);
    expect(atCap.errors, `4,096 occluder segments in one group are within the cap: ${shownErrors(atCap.errors)}`).toEqual([]);
    const failures = [...openFailures(check(DOCS.open)), ...pastCapFailures(check(DOCS.pastCap))];
    expect(failures, failures.join('\n')).toEqual([]);
  });

  it(`${ID} a planted check that accepts the open occluding path fails`, () => {
    const failures = openFailures(check(DOCS.open, 'occlude_accepts_open_path'));
    console.log(`${ID}: under occlude_accepts_open_path: ${failures.join('; ') || 'no failure'}`);
    expect(failures.length, 'the planted check that accepts an open occluding path fails the open path\'s judgement').toBeGreaterThan(0);
  });

  it(`${ID} a planted check that accepts 4,097 segments fails`, () => {
    fixtureHolds();
    const failures = pastCapFailures(check(DOCS.pastCap, 'occlude_accepts_past_cap'));
    console.log(`${ID}: under occlude_accepts_past_cap: ${failures.join('; ') || 'no failure'}`);
    expect(failures.length, 'the planted check that accepts 4,097 occluder segments fails the group\'s judgement').toBeGreaterThan(0);
  });
});
