// AC7 #507.13a7577b: "The keymap check names Space, ←, → and 0-9 as shadowed while present mode runs, and present mode's
// meaning wins"
//
// The nine-stage piece (helpers.ts `ninePiece`, stage k at 4(k − 1) s), a film the film viewer (#501, Transport: film
// viewer) takes keys for: Space plays and pauses, ← and → seek 5 s, 0 to 9 a tenth of the span. Present mode holds →
// and Space (advance), ← (back) and the digits (a stage number, then Enter). The keymap check (#501's `keymap` call,
// whose `conflicts` already name each viewer key a control holds) must name exactly those thirteen while present mode
// runs, and none before it or after Esc; and each key does what present mode says: → plays to the next stage (not +5 s),
// Space plays on from a held stage, ← goes back to the stage before and holds (not −5 s), 5 alone moves nothing (not to
// 18 s, half the span) and Enter after it goes to stage 5. Wrong programs: a check that names other keys, too few, or
// names them after present mode ends; the viewer's meaning taken for any of the keys.
import { describe, it } from 'vitest';
import {
  A, DISPLAY_A, DOC, Driver, FLICKS, MS, TIMEOUT, appendedOf, arr, enterPresent, evalAt, fl, key, keymap, ninePiece, none, obj, positionOf,
  presentEntry, secs, show, stageAt, useShow, useTemp, type JsonObject,
} from './helpers.ts';

const ID = 'AC7 #507.13a7577b';
const bin = useShow();
const temp = useTemp();

const SHADOWED = ['space', 'arrowleft', 'arrowright', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
/** The chords the keymap check names as present mode's, on this piece. */
function shadowed(reply: JsonObject | undefined, what: string): string[] {
  return arr(obj(reply, what)['conflicts'], `${what}: conflicts`).map((c, i) => obj(c, `${what}: conflicts[${i}]`))
    .filter((c) => c['by'] === 'present_mode' && c['context'] === 'film_viewer' && c['doc'] === DOC.nine)
    .map((c) => String(c['chord'])).sort();
}

describe(`${ID} the keys present mode shadows, and whose meaning wins`, () => {
  it(`${ID} the keymap check names Space, ←, → and 0-9 as shadowed while present mode runs, and each does what present mode says`, () => {
    const d = new Driver(bin(), { evidence: temp(), displays: [DISPLAY_A], doc: DOC.nine });
    enterPresent(d, DOC.nine, ninePiece(), A, 'the nine-stage piece in present mode');
    const r = d.step([
      keymap(50 * MS), keymap(fl(0.3)),
      key(fl(1), 'ArrowRight'), evalAt(fl(1.5), DOC.nine),
      key(fl(6), ' '), evalAt(fl(6.5), DOC.nine),
      key(fl(11), 'ArrowLeft'), evalAt(fl(11.5), DOC.nine),
      key(fl(12), '5'), evalAt(fl(12.3), DOC.nine),
      key(fl(12.5), 'Return'), evalAt(fl(12.8), DOC.nine),
      key(fl(13), 'Escape'), keymap(fl(13.5)),
    ], 'the keys in present mode');
    const failures: string[] = [];
    const before = shadowed(r[0], 'the keymap before present mode');
    if (before.length) failures.push(`before present mode the keymap check names ${before.join(', ')} as present mode's`);
    const during = shadowed(r[1], 'the keymap in present mode');
    if (JSON.stringify(during) !== JSON.stringify([...SHADOWED].sort())) failures.push(`in present mode the keymap check names ${show(during)} as shadowed, not ${show(SHADOWED)}`);
    const after = shadowed(r[13], 'the keymap after Esc');
    if (after.length) failures.push(`after Esc the keymap check still names ${after.join(', ')}`);
    const frame = FLICKS / 30;
    const near = (i: number, at: number, want: number, what: string): void => {
      const got = positionOf(r[i], `eval at ${at} s`);
      if (Math.abs(got - want) > frame) failures.push(`${what}: at ${at} s the timeline is at ${secs(got)}, not ${secs(want)}`);
    };
    const right = presentEntry(r[2], 'advance', '→ on stage 1');
    near(3, 1.5, fl(1.5) - right.t, '→ plays on toward stage 2');
    const space = presentEntry(r[4], 'advance', 'Space on stage 2');
    near(5, 6.5, fl(stageAt(2)) + fl(6.5) - space.t, 'Space plays on from stage 2');
    presentEntry(r[6], 'back', '← on stage 3');
    near(7, 11.5, fl(stageAt(2)), '← goes back to stage 2 and holds');
    if (appendedOf(r[8], '5 alone').length) failures.push(`5 alone appends ${show(appendedOf(r[8], '5 alone'))}`);
    near(9, 12.3, fl(stageAt(2)), '5 alone moves nothing');
    presentEntry(r[10], { goto: 's5' }, '5 then Enter');
    near(11, 12.8, fl(stageAt(5)), '5 then Enter goes to stage 5');
    none(failures, 'the shadowed keys');
  }, TIMEOUT);
});
