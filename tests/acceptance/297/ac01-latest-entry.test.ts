// AC1 #297.688a1e6a: Player 1 commits "Kai" at step 30 and "Kai Ng" at step 90 to a `name` control with `max_bytes`
// 16, and player 2 commits "Ana" at step 95; an entry text for player 1 shows the default at step 10, "Kai" from step
// 30 and "Kai Ng" from step 90, also after a seek to step 100; a planted text that shows the control's latest entry by
// any player shows "Ana" at step 95 and fails, naming the item
//
// Through `deep-show run` (README: The surface under test): the nameplates piece (`plate1` bound to player 1, `plate2`
// to player 2) with the three commits loaded as a match's recorded track (`track`'s `load`); `eval` at steps 10, 29,
// 30, 89, 90 and 95 in order, then at step 100 (the seek) and back at 10, 30, 90 and 95; each frame's `shown`. The
// planted `entry_any_player` (README: Planted twins) shows the control's latest entry by any player.
import { describe, it } from 'vitest';
import { DEFAULT_NAME, namesDoc, seatsProgram } from './fixtures.ts';
import {
  AC, DOC, Script, TIMEOUT, at, commit, failsNaming, named, none, once, presented, putEvidence, runShow, scenario, shownOf, trackOf, useShow, useTemp,
  type Planted,
} from './helpers.ts';

const show = useShow();
const temp = useTemp();
const D = DOC(1);
const TRACK = trackOf([commit(30, 1, 'Kai'), commit(90, 1, 'Kai Ng'), commit(95, 2, 'Ana')]);
/** What each seat's entry text shows at a step, from the commits (the default before a seat's first). */
const expected = (k: number): { plate1: string; plate2: string } => ({
  plate1: k >= 90 ? 'Kai Ng' : k >= 30 ? 'Kai' : DEFAULT_NAME,
  plate2: k >= 95 ? 'Ana' : DEFAULT_NAME,
});
const PLAYED = [10, 29, 30, 89, 90, 95];
const SEEKED = [100, 10, 30, 90, 95];

function judge(planted?: Planted): string[] {
  const ev = temp();
  const seats = seatsProgram();
  putEvidence(ev, seats.bytes);
  const s = new Script();
  s.present(D, namesDoc(seats));
  s.track(D, TRACK);
  const frames = [...PLAYED.map((k) => ({ k, how: 'played', i: s.eval(D, at(k)) })), ...SEEKED.map((k) => ({ k, how: 'after the seek to step 100', i: s.eval(D, at(k)) }))];
  const r = runShow(show(), scenario(ev, [D], s.calls, planted), 'AC1 the three commits on the track, and the frames');
  presented(r[0]!, 'the nameplates piece');
  const failures: string[] = [];
  for (const f of frames) {
    const shown = shownOf(r[f.i]!, `the frame at step ${f.k} (${f.how})`);
    const want = expected(f.k);
    for (const item of ['plate1', 'plate2'] as const) {
      if (shown[item] !== want[item]) failures.push(`item ${item} (seat ${item === 'plate1' ? 1 : 2}) at step ${f.k} (${f.how}) shows ${shown[item] === undefined ? 'nothing it reports' : named(shown[item])}, not ${named(want[item])}`);
    }
  }
  return failures;
}
const honest = once(() => judge());

describe(`${AC[1]} an entry text shows its player's latest committed entry to the control at or before t`, () => {
  it(`${AC[1]} player 1's entry text shows the default at step 10, "Kai" from step 30 and "Kai Ng" from step 90, also after a seek to step 100, and player 2's shows "Ana" from step 95`, () => {
    none(honest(), 'the entry texts of seat 1 and seat 2');
  }, TIMEOUT);
  it(`${AC[1]} the planted text that shows the control's latest entry by any player shows "Ana" at step 95 and fails, naming the item`, () => {
    failsNaming(judge('entry_any_player'), [/item plate1 \(seat 1\) at step 95 \(played\) shows "Ana"/], 'entry_any_player');
  }, TIMEOUT);
});
