// #488.5827cbd0: a document or export rate whose frame isn't a whole number of flicks is refused naming
// the rate, and times written as `195f` or `@marker+1.25s` store exact flicks. A document's
// `transport.frame_rate` is checked at deep_show (`bad_rate` at `transport/frame_rate`, the issue
// naming the rate); an export's rate through the `export` call; a literal through the `time` call,
// which resolves against the document's own rate and markers; and a placement at `195f` really starts
// at that flick, seen through `eval` at a flick (README). The wrong programs: the base (a document at
// 85/1 is presented; no `export` or `time` call; `eval` takes no flick and resolves `195f` at a fixed
// 60/1, so frame 195 at 30 fps lands at 2,293,200,000 instead of 4,586,400,000), and a check that
// refuses the rate without naming it.
import { describe, expect, it } from 'vitest';
import {
  BACK, DOC, FLICKS, FULL, board, evalPixels, exportCall, frameRateText, int, label, outcome, presented, rect, refusedNaming, run, scenario, sec, show, slide, snapshotOf, timeCall,
  useBuilds, useEvidence, type JsonObject,
} from './helpers.ts';

const builds = useBuilds([FULL]);
const evidence = useEvidence();

const at = (frameRate: [number, number], extra: JsonObject = {}): JsonObject =>
  board(`Board at ${frameRateText(frameRate)} fps`, [BACK, rect('r1', [16, 40, 40, 30], 'a1', 'ink'), label('l1', 'Rates', [16, 150], 'a2')], { transport: { frame_rate: frameRate, span: '2s' }, ...extra });

/** Frame 195 at 30 fps: 195 × 23,520,000 flicks (Time and the flick: How documents write time). */
const FRAME_195_AT_30 = 4_586_400_000;
/** 1.25 s after the marker at 2 s. */
const MARKER_PLUS = sec(2) + sec(1.25);

/** A 30 fps board, 10 s long, with a marker `m` at 2 s and a rect that slides from x 0 to 200 over 2 s, placed at frame 195. */
const PLACED: JsonObject = board('Placed at frame 195', [
  BACK, rect('mover', [0, 0, 40, 30], 'a1', 'ink', { at: { pos: [100, 40, 0] } }), label('l1', 'Placed at frame', [16, 150], 'a2'),
], { transport: { frame_rate: [30, 1], span: '10s' }, markers: { m: { t: '2s', kind: 'cue', name: 'Marker m' } }, ...slide('mover', 0, 200, '2s', '195f') });

describe('#488.5827cbd0 a document or export rate whose frame isn\'t a whole number of flicks is refused naming the rate, and times written as 195f or @marker+1.25s store exact flicks', () => {
  it('#488.5827cbd0 a document at 85/1 or 11/1 fps is refused with bad_rate at transport/frame_rate, naming the rate; one at 30000/1001 or 8/1 is presented and exports at its own rate', () => {
    const replies = run(builds.bin(FULL), scenario(evidence(), [
      show(at([85, 1])), show(at([11, 1]), { doc: DOC.b }),
      show(at([30000, 1001])), exportCall(DOC.a),
      show(at([8, 1]), { doc: DOC.b }), exportCall(DOC.b),
    ]));
    refusedNaming(replies[0]!, 'bad_rate', 'transport/frame_rate', '85/1', 'the board at 85/1 fps');
    refusedNaming(replies[1]!, 'bad_rate', 'transport/frame_rate', '11/1', 'the board at 11/1 fps');
    presented(replies[2]!, 'the board at 30000/1001 fps');
    expect(outcome(replies[3]!), `the export of the 30000/1001 board is planned: ${JSON.stringify(replies[3]).slice(0, 600)}`).toBe('planned');
    expect(replies[3]!['frame_rate'], 'at the document\'s rate').toEqual([30000, 1001]);
    expect(int(replies[3]!['frame'], 'the export frame'), '705,600,000 × 1001 ÷ 30000').toBe(23_543_520);
    presented(replies[4]!, 'the board at 8/1 fps');
    expect(outcome(replies[5]!), 'the export of the 8 fps board is planned').toBe('planned');
    expect(int(replies[5]!['frame'], 'the export frame'), 'frames held on threes: 88,200,000 flicks').toBe(88_200_000);
  }, 600_000);

  it('#488.5827cbd0 an export at 85/1 fps of a 30 fps document is refused naming the rate; an export at 24000/1001 is planned', () => {
    const replies = run(builds.bin(FULL), scenario(evidence(), [show(at([30, 1])), exportCall(DOC.a, { frame_rate: [85, 1] }), exportCall(DOC.a, { frame_rate: [24000, 1001] })]));
    presented(replies[0]!, 'the 30 fps board');
    const refused = replies[1]!;
    expect(outcome(refused), `the export at 85/1 is refused: ${JSON.stringify(refused).slice(0, 600)}`).toBe('refused');
    expect(refused['code'], 'with bad_rate').toBe('bad_rate');
    expect(JSON.stringify(refused), 'naming the rate').toContain('85/1');
    expect(outcome(replies[2]!), 'the export at 24000/1001 is planned').toBe('planned');
    expect(int(replies[2]!['frame'], 'its frame'), '705,600,000 × 1001 ÷ 24000').toBe(29_429_400);
  }, 600_000);

  it('#488.5827cbd0 at 30 fps, 195f resolves to 4,586,400,000 flicks and @m+1.25s to 2,293,200,000, exactly, through the document\'s rate and markers', () => {
    const replies = run(builds.bin(FULL), scenario(evidence(), [show(PLACED), timeCall(DOC.a, '195f'), timeCall(DOC.a, '@m+1.25s'), timeCall(DOC.a, '@m-0.5s'), timeCall(DOC.a, '1.25s'), timeCall(DOC.a, '@m'), timeCall(DOC.a, '@nowhere+1s')]));
    presented(replies[0]!, 'the placed board');
    const resolved = (i: number, text: string): number => {
      expect(outcome(replies[i]!), `${text} resolves: ${JSON.stringify(replies[i]).slice(0, 400)}`).toBe('resolved');
      return int(replies[i]!['t'], `${text}: t`);
    };
    expect(resolved(1, '195f'), 'frame 195 at 30 fps, not at 60').toBe(FRAME_195_AT_30);
    expect(resolved(2, '@m+1.25s'), '2 s + 1.25 s').toBe(MARKER_PLUS);
    expect(resolved(3, '@m-0.5s'), '2 s − 0.5 s').toBe(sec(1.5));
    expect(resolved(4, '1.25s'), '1.25 s').toBe(882_000_000);
    expect(resolved(5, '@m'), 'the marker itself').toBe(2 * FLICKS);
    expect(outcome(replies[6]!), 'an unknown marker is refused').toBe('refused');
    expect(replies[6]!['code'], 'as unresolved').toBe('time_unresolved');
  }, 600_000);

  it('#488.5827cbd0 a placement at 195f starts at flick 4,586,400,000: the frame there differs from the one a flick before, which is the frame at 0; eval\'s literal 195f lands on the same flick', () => {
    const replies = run(builds.bin(FULL), scenario(evidence(), [show(PLACED), evalPixels(DOC.a, 0), evalPixels(DOC.a, FRAME_195_AT_30 - 1), evalPixels(DOC.a, FRAME_195_AT_30), evalPixels(DOC.a, '195f'), evalPixels(DOC.a, '@m+1.25s'), evalPixels(DOC.a, MARKER_PLUS)]));
    presented(replies[0]!, 'the placed board');
    const [at0, before, start, literal, markerLiteral, markerFlick] = [1, 2, 3, 4, 5, 6].map((i) => snapshotOf(replies[i]!, `the frame of call ${i}`));
    expect(before, 'one flick before the placement the rect is still at its own position').toBe(at0);
    expect(start, 'at the placement\'s first flick the clip\'s first key moves it').not.toBe(before);
    expect(literal, 'eval at the literal 195f is the frame at 4,586,400,000').toBe(start);
    expect(int(replies[4]!['t'], 'eval\'s t for 195f'), 'the reply\'s t is the exact flick').toBe(FRAME_195_AT_30);
    expect(markerLiteral, 'eval at @m+1.25s is the frame at 2,293,200,000').toBe(markerFlick);
    expect(int(replies[5]!['t'], 'eval\'s t for @m+1.25s')).toBe(MARKER_PLUS);
  }, 600_000);
});
