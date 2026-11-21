// AC5 #297.50f2c738: In a two-seat match, an entry text bound to player 5 shows nothing and raises `entry.missing`,
// naming the control, player 5 and the step; a planted text that falls back to player 1's entry shows it and fails,
// naming the item
//
// Through `deep-show run` (README: The surface under test): the nameplates piece of the two-seat match with `ghost`, an
// entry text bound to player 5, and the match's recorded track loaded (`track`'s `load`): seat 1 commits "Kai" at step
// 10, seat 2 "Ana" at step 20. `eval` at step 0 and at step 40: what each entry text shows (`shown`) and the issues each
// frame raises. The planted `entry_falls_back_to_player_1` (README: Planted twins) shows player 1's entry for a player
// with no seat.
import { describe, it } from 'vitest';
import { NAME, seat5Doc, seatsProgram } from './fixtures.ts';
import {
  AC, DOC, Script, TIMEOUT, at, commit, failsNaming, issuesOf, named, none, once, presented, putEvidence, runShow, scenario, show as text, shownOf,
  trackOf, useShow, useTemp, type Planted,
} from './helpers.ts';

const show = useShow();
const temp = useTemp();
const D = DOC(6);
const FRAMES = [0, 40];

function judge(planted?: Planted): string[] {
  const ev = temp();
  const seats = seatsProgram();
  putEvidence(ev, seats.bytes);
  const s = new Script();
  s.present(D, seat5Doc(seats));
  s.track(D, trackOf([commit(10, 1, 'Kai'), commit(20, 2, 'Ana')]));
  const frames = FRAMES.map((k) => ({ k, i: s.eval(D, at(k)) }));
  const r = runShow(show(), scenario(ev, [D], s.calls, planted), 'AC5 player 5 in a two-seat match');
  presented(r[0]!, 'the piece with an entry text bound to player 5');
  const failures: string[] = [];
  const raised: string[] = [];
  let missing = false;
  for (const f of frames) {
    const shown = shownOf(r[f.i]!, `the frame at step ${f.k}`);
    if (shown['ghost'] !== '') failures.push(`item ghost (player 5, no seat) shows ${shown['ghost'] === undefined ? 'no string it reports' : named(shown['ghost'])} at step ${f.k}, not nothing`);
    const issues = issuesOf(r[f.i]!).filter((i) => i['code'] === 'entry.missing');
    raised.push(...issues.map((i) => `step ${f.k}: ${text(i, 300)}`));
    // Raised by the frame of the step it names (as keyed copy's copy.missing is): step 0, where player 5 first has no seat.
    if (issues.some((i) => i['control'] === NAME && i['player'] === 5 && i['step'] === f.k)) missing = true;
  }
  if (!missing) failures.push(`no frame raises entry.missing {control: name, player: 5, step} naming its own step; entry.missing raised: ${raised.length ? raised.join('; ') : 'none'}`);
  return failures;
}
const honest = once(() => judge());

describe(`${AC[5]} a player number with no seat shows nothing and raises entry.missing`, () => {
  it(`${AC[5]} in a two-seat match, the entry text bound to player 5 shows nothing and raises entry.missing, naming the control, player 5 and the step`, () => {
    none(honest(), 'the entry text bound to player 5');
  }, TIMEOUT);
  it(`${AC[5]} the planted text that falls back to player 1's entry shows it and fails, naming the item`, () => {
    failsNaming(judge('entry_falls_back_to_player_1'), [/item ghost \(player 5, no seat\) shows "Kai" .* at step 40/], 'entry_falls_back_to_player_1');
  }, TIMEOUT);
});
