// AC2 #222.98d07f32: "Changing cue 2's distance from 3 u to 4 u moves the start of a later `move_along` cue to
// x = 4 u within 1e-9 without editing that cue"
//
// Two films, identical but for cue 2: a square at the origin; cue 1 `draw` creates it over 1 s; cue 2 `slide` sets its
// position to (d, 0) after it (d = 3, then 4); cue 3 `pause` waits 1 s; cue 4 `trace` moves it along the path
// `track`, a line from (10, 10) to (10, 20), byte for byte the same cue in both. `trace` starts at 3 s (its marker
// `cues.trace` says so in both), and `eval` reads the square's position there: x = 3 u, then 4 u, each within 1e-9.
// A cue's from-values are what its targets hold at its start, by the same pure evaluation, so `trace` starts where
// `slide` left the square.
//
// Wrong programs: from-values taken from the document as written (the square's own position, x = 0); a move_along
// that jumps to its path's start (x = 10); an expansion kept from the first film for the second (x = 3, not 4).
import { describe, expect, it } from 'vitest';
import {
  AC, TIMEOUT, VERBS_AT, VERBS_PACK, arr, cueList, docId, evalAt, expansionOf, fl, film, markerOf, num, present, presented, run, scenario,
  showTime, square, useFolders, useShow, valuesOf, type JsonObject,
} from './helpers.ts';

const show = useShow();
const folder = useFolders();

const track: JsonObject = { id: 'track', kind: 'path@1', name: 'Track', order: 'b0', params: { d: 'M 10 10 L 10 20', paint: { stroke: { role: 'ink', width: 2 } } } };
const cuesWith = (d: number): JsonObject[] => [
  { id: 'draw', kind: 'create', targets: ['sq'], span: '1s' },
  { id: 'slide', targets: ['sq'], set: { 'at/pos': [d, 0, 0] } },
  { id: 'pause', span: '1s' },
  { id: 'trace', kind: 'move_along', targets: ['sq'], params: { path: 'track' } },
];
const filmOf = (cues: JsonObject[], d: number): JsonObject => film(`Cue 2 at ${d} u`, [track, square('sq'), cueList(cues)], { span: 6, packs: [VERBS_AT] });
const START = fl(3);
const POS = 'items/sq/at/pos';

describe(`${AC[2]} a later cue starts from where the cues before it left its targets`, () => {
  it(`${AC[2]} changing cue 2 from 3 u to 4 u moves the start of the later move_along cue to x = 4 u within 1e-9, that cue unedited`, () => {
    const three = cuesWith(3); const four = cuesWith(4);
    expect(JSON.stringify(four[3]), 'the move_along cue is the same, byte for byte, in both films').toBe(JSON.stringify(three[3]));
    const [a, b, atA, atB] = run(show(), scenario(folder(), [
      present(docId(1), filmOf(three, 3)), present(docId(2), filmOf(four, 4)),
      evalAt(docId(1), START, { paths: [POS] }), evalAt(docId(2), START, { paths: [POS] }),
    ], { packs: [VERBS_PACK] }));
    for (const [reply, what] of [[a!, 'cue 2 at 3 u'], [b!, 'cue 2 at 4 u']] as const) {
      presented(reply, `the film with ${what}`);
      const t = markerOf(expansionOf(reply, `the film with ${what}`), 'trace', `the film with ${what}`).t;
      expect(t, `with ${what} the move_along cue starts at 3 s, got ${showTime(t)}`).toBe(START);
    }
    const x = (reply: JsonObject, what: string): number => num(arr(valuesOf(reply, what)[POS], `${what}: ${POS}`)[0], `${what}: x`);
    const x3 = x(atA!, 'the square at the move_along cue\'s start, cue 2 at 3 u');
    const x4 = x(atB!, 'the square at the move_along cue\'s start, cue 2 at 4 u');
    expect(Math.abs(x3 - 3) <= 1e-9, `with cue 2 at 3 u the move_along cue starts at x = 3 u within 1e-9, got ${x3}`).toBe(true);
    expect(Math.abs(x4 - 4) <= 1e-9, `with cue 2 at 4 u the move_along cue starts at x = 4 u within 1e-9, got ${x4}`).toBe(true);
  }, TIMEOUT);
});
