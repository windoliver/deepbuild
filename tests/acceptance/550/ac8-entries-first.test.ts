// AC8 #550.acebf9a7: In a three-copy match over the test relay with direct paths on, a planted copy 3 that sends copy 1
// one entry and copy 2 another for match step 310 is caught at the hash for step 360: copies 1 and 2 stop with
// `net.desync` naming cause entries, player 3 and step 310, and neither names a module or a field; a planted locator
// that compares state alone names a field of the ball and fails
//
// The paddle piece for three players (`players: 3`), every copy in one process over the test relay with `direct: true`,
// so each copy's frames go to each other copy apart (README: `match`). Player 3 only spins the ball; its script also
// holds the planted pair: spin 0.5 made at step 306 for copy 1 alone (`to: [1]`) and spin −0.5 made at 306 for copy 2
// alone (`to: [2]`), both landing at step 310, while the ball is in play. Each copy's record keeps the entry it held
// (the Scope). The planted locator is `net_locates_by_state_alone` (README: Planted twins), judged by the same function.
// Wrong programs it fails: the merge base (no direct paths, no `to`: every copy holds both entries and nothing parts);
// a locator that compares state alone (the planted one: it names the ball's rise); a record that keeps another entry.
import { describe, it } from 'vitest';
import { STEP, rally, withEntries } from './fixtures.ts';
import { AC, FULL, TIMEOUT, caughtFailures, failsNaming, none, play, players, show, useBuilds, useChildren, useTemp, type NetCopy } from './helpers.ts';

const builds = useBuilds({ show: [FULL] });
useChildren();
const temp = useTemp();
const plays = withEntries(rally(3, 600), 3, [
  { step: 306, control: 'spin', value: 0.5, to: [1] },
  { step: 306, control: 'spin', value: -0.5, to: [2] },
]);
/** What each of copies 1 and 2 was sent for player 3 at step 310. */
const HELD: Record<number, number> = { 1: 0.5, 2: -0.5 };

/** The criterion's judge, on copies 1 and 2. */
function entriesFailures(copies: NetCopy[], what: string): string[] {
  const [one, two] = players(copies, 3, what);
  const f = caughtFailures(one, two, what, { trackOnly: true });
  for (const c of [one, two]) {
    const d = c.desync;
    if (d === undefined) { f.push(`${what}: copy ${c.player}'s report has no desync (README: A copy's report)`); continue; }
    if (d === null) { f.push(`${what}: copy ${c.player} reports no net.desync`); continue; }
    const said = show(d.raw, 500);
    if (d.cause !== 'entries' || d.player !== 3 || d.step !== 310) f.push(`${what}: copy ${c.player}'s net.desync is ${said}, not cause entries, player 3, step 310`);
    if ((d.module ?? null) !== null || (d.field ?? null) !== null) f.push(`${what}: copy ${c.player}'s net.desync names a module or a field: ${said}`);
    const kept = (c.record?.track ?? []).filter((e) => e.player === 3 && e.t === 310 * STEP && e.control === 'spin').map((e) => e.value);
    if (JSON.stringify(kept) !== JSON.stringify([HELD[c.player]])) f.push(`${what}: copy ${c.player}'s record keeps ${JSON.stringify(kept)} for player 3's spin at step 310, not the entry it held, ${HELD[c.player]}`);
  }
  return f;
}

describe(`${AC[8]} entries first: a copy that sends two peers different entries`, () => {
  it(`${AC[8]} copies 1 and 2 stop at the hash for step 360 with net.desync naming cause entries, player 3 and step 310 and no field, and a locator that compares state alone names the ball and fails`, async () => {
    const { copies } = await play(builds.show(), temp(), 'AC8 copy 3 sends two entries', { steps: 600, players: 3, plays, relay: { seed: 550, direct: true } });
    none(entriesFailures(copies, 'AC8'), 'copies 1 and 2 name player 3\'s entries at step 310');
    const state = await play(builds.show(), temp(), 'AC8 the state-only locator', { steps: 600, players: 3, plays, relay: { seed: 550, direct: true }, planted: 'net_locates_by_state_alone' });
    failsNaming(entriesFailures(state.copies, 'AC8 planted'), [/ball/], 'the locator that compares state alone');
  }, TIMEOUT);
});
