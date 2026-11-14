// AC5 #507.44897258: "A stage with `hold: loop {from}` on a marker 2 s before it, held for 7 s, shows the span's frames at
// clock offsets 0, 2, 4 and 6 s exactly, seeking equal to playing, and an advance goes on from the stage marker; B blanks
// the presented display, and "7 Enter" goes to stage 7, each as one `present` entry, while "3 Enter" from stage 7 writes
// no entry and shows the notice"
//
// The loop film (helpers.ts `loopFilm`): → at 1 s leaves stage s1; the timeline reaches s2 (6 s), which holds on a loop
// of [4 s, 6 s), 6 s after that advance's stamp; → again 7 s into the hold. The loop replays the span on the clock, so
// at offset d into the hold the frame is the timeline's at 4 + (d mod 2) s: at 0, 2, 4 and 6 s the span's first frame,
// the one the timeline showed at 4 s on its way there, and at 1 and 5 s its frame at 5 s. Played and sought are
// `determinism`'s two sides (#488). After the advance the timeline goes on from 6 s. The Oracle lane
// (tests/acceptance/507-oracle/) ports the pinned looping playback test's offsets across loop boundaries on the same
// session. The keys run on the nine-stage piece (`ninePiece`). Wrong programs: a loop that holds the stage's frame or
// the span's first frame, runs on the timeline instead of the clock, or replays another span; an advance that goes on
// from where the loop was; keys that write no entry, two entries, or an entry for an earlier stage.
import { describe, expect, it } from 'vitest';
import {
  A, DISPLAY_A, DOC, Driver, FLICKS, LOOP, TIMEOUT, appendedOf, arr, enterPresent, evalAt, fl, int, key, loopFilm, ninePiece, none, obj,
  positionOf, presentEntry, presentOf, presentState, secs, show, stageAt, str, useShow, useTemp,
} from './helpers.ts';

const ID = 'AC5 #507.44897258';
const bin = useShow();
const temp = useTemp();

describe(`${ID} a stage that holds on a loop, and the blank and stage-number keys`, () => {
  it(`${ID} held 7 s, the loop shows the span's frames at offsets 0, 2, 4 and 6 s exactly, sought as played; an advance goes on from the stage`, () => {
    const d = new Driver(bin(), { evidence: temp(), displays: [DISPLAY_A], doc: DOC.loop });
    enterPresent(d, DOC.loop, loopFilm(), A, 'the loop film in present mode');
    const [adv] = d.step([key(fl(1), 'ArrowRight')], 'leaving stage s1');
    const e1 = presentEntry(adv, 'advance', '→ on stage s1').t;
    const hold = e1 + fl(LOOP.stage);
    // [clock, the timeline's position its frame shows (s)]: two on the way to the stage, then offsets into the hold.
    const offsets = [0, 1, 2, 4, 5, 6];
    const times: [number, number][] = [[e1 + fl(4), 4], [e1 + fl(5), 5], ...offsets.map((o): [number, number] => [hold + fl(o), LOOP.from + (o % LOOP.span)])];
    const r = d.step([
      key(hold + fl(7), 'ArrowRight'),
      evalAt(hold + fl(7.5), DOC.loop), evalAt(hold + fl(9), DOC.loop),
      { call: 'determinism', at: hold + fl(10), doc: DOC.loop, display_hz: LOOP.fps, at_times: times.map(([t]) => t) },
    ], 'the hold, the advance and the comparison');
    const e2 = presentEntry(r[0], 'advance', '→ 7 s into the hold').t;
    const failures: string[] = [];
    const frame = FLICKS / LOOP.fps;
    for (const [i, t] of [[1, hold + fl(7.5)], [2, hold + fl(9)]] as const) {
      const got = positionOf(r[i], `eval at ${secs(t)}`);
      const want = fl(LOOP.stage) + (t - e2);
      if (Math.abs(got - want) > frame) failures.push(`${secs(t - e2)} after the advance the timeline is at ${secs(got)}, not ${secs(want)}: it doesn't go on from the stage marker`);
    }
    const det = obj(r[3], 'determinism');
    expect(det['outcome'], `determinism compares: ${show(det)}`).toBe('compared');
    const frames = arr(det['frames'], 'determinism: frames').map((f, i) => obj(f, `frames[${i}]`));
    const sorted = [...times].sort((a, b) => a[0] - b[0]);
    expect(frames.map((f) => f['t']), 'one frame per time asked, in time order').toEqual(sorted.map(([t]) => t));
    const hash = new Map<number, string>();
    frames.forEach((f, i) => {
      const [t, p] = sorted[i]!;
      const label = t < hold ? `on the way, ${secs(t - e1)} after the advance` : `${secs(t - hold)} into the hold`;
      for (const side of ['play', 'seek'] as const) {
        const got = int(obj(f[side], side)['position'], `${label}: the ${side} side's position`);
        if (got !== fl(p)) failures.push(`${label} the ${side} side shows the timeline at ${secs(got)}, not ${p} s`);
      }
      const [ph, sh] = [str(obj(f['play'], 'play')['pixel_hash'], 'play.pixel_hash'), str(obj(f['seek'], 'seek')['pixel_hash'], 'seek.pixel_hash')];
      if (ph !== sh) failures.push(`${label} the frame sought differs from the frame played`);
      hash.set(t, ph);
    });
    const [at4, at5] = [hash.get(e1 + fl(4)), hash.get(e1 + fl(5))];
    if (at4 === at5) failures.push("the timeline's frames at 4 s and 5 s are the same: the fixture tells nothing apart");
    for (const o of offsets) {
      const want = o % LOOP.span === 0 ? at4 : at5;
      if (hash.get(hold + fl(o)) !== want) failures.push(`${o} s into the hold the frame isn't the span's frame at ${LOOP.from + (o % LOOP.span)} s`);
    }
    none(failures, 'the looped hold');
  }, TIMEOUT);

  it(`${ID} B blanks the presented display and "7 Enter" goes to stage 7, one present entry each; "3 Enter" from stage 7 writes none and shows the notice`, () => {
    const d = new Driver(bin(), { evidence: temp(), displays: [DISPLAY_A], doc: DOC.nine });
    enterPresent(d, DOC.nine, ninePiece(), A, 'the nine-stage piece in present mode');
    const r = d.step([
      key(fl(1), 'b'), presentState(fl(1.2)),
      key(fl(2), '7'), key(fl(2.2), 'Return'), presentState(fl(2.5)), evalAt(fl(2.5), DOC.nine),
      key(fl(3), '3'), key(fl(3.2), 'Return'), presentState(fl(3.5)), evalAt(fl(3.5), DOC.nine),
    ], 'the keys');
    const failures: string[] = [];
    presentEntry(r[0], 'blank', 'B');
    if (!presentOf(r[1], 'present after B').blank) failures.push(`after B the presented display isn't blank: ${show(presentOf(r[1], 'present after B').raw)}`);
    if (appendedOf(r[2], '7').length !== 0) failures.push(`7 alone appends ${show(appendedOf(r[2], '7'))}`);
    presentEntry(r[3], { goto: 's7' }, '7 then Enter');
    const at7 = presentOf(r[4], 'present after 7 Enter');
    if (at7.stage !== 's7' || at7.number !== 7) failures.push(`after 7 Enter present mode shows ${String(at7.stage)} (number ${String(at7.number)}), not stage 7`);
    if (positionOf(r[5], 'eval after 7 Enter') !== fl(stageAt(7))) failures.push(`after 7 Enter the timeline isn't held at stage 7's ${stageAt(7)} s`);
    for (const [i, k] of [[6, '3'], [7, 'Enter after 3']] as const) if (appendedOf(r[i], k).length !== 0) failures.push(`${k} from stage 7 appends ${show(appendedOf(r[i], k))}`);
    const at3 = presentOf(r[8], 'present after 3 Enter');
    if (at3.notice === null || !/back/i.test(at3.notice)) failures.push(`after 3 Enter from stage 7 no notice says that back goes back: ${show(at3.raw)}`);
    if (at3.stage !== 's7') failures.push(`after 3 Enter present mode left stage 7 for ${String(at3.stage)}`);
    if (positionOf(r[9], 'eval after 3 Enter') !== fl(stageAt(7))) failures.push('after 3 Enter the timeline left stage 7');
    none(failures, 'B, 7 Enter and 3 Enter');
  }, TIMEOUT);
});
