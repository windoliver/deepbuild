// AC2 #278.9b37a90c: While the piece's `open` array is true, a fourth copy that joins at match step 600 receives only
// entries, as the relay's log shows, replays them from step 0 and enters with one `joined` entry at a stamped step,
// reaching the others' full-state hash at the next hash interval; while it's false the same join is refused; a planted
// relay that sends a joiner state instead of entries fails the log check, naming the frame
//
// The eight-seat piece in one process over the test relay (`match`), started by three copies (`start: {joined: 3}`);
// copy 4's person clicks Join right after the first player's copy runs step 600 (`join`), and the relay's log is kept.
// The piece's `open` array is its rules' `lobby`: true at every step in the first and third runs, and in the second
// true for steps 0 to 299 and false from step 300. The log check is helpers.ts's `onlyEntries`: every frame the relay
// handed copy 4 is a relay frame of steps' entries that holds none of the piece's state, and together they carry
// players 1 to 3's messages for every step from 0 through 600. The planted relay is `relay_sends_joiner_state`. Wrong
// programs it fails: the merge base (nobody joins after the start); a joiner handed the state, or entries only from
// the present; a join stamped at different steps, twice, or never; a joiner that parts from the others; a join taken
// while the lobby is closed.
import { describe, expect, it } from 'vitest';
import { CLOSED_FROM, DOC, HASH_EVERY, JOINED, JOINER, JOIN_STEP, WINDOW, roomPiece, roomPlays, type Piece } from './fixtures.ts';
import {
  AC, FULL, TIMEOUT, arrayAt, catchUpsOf, copyFor, failsNaming, hashesAgree, joinRefused, laterSeats, logOf, nextHashAgrees, oneSeat, onlyEntries, ownersAt, play, playedOn,
  playersOf, rows, seatsOf, show, trackLines, tracksAgree, useBuilds, useChildren, useTemp, type Match, type Played,
} from './helpers.ts';

const builds = useBuilds({ show: [FULL] });
useChildren();
const temp = useTemp();
const STEPS = 1_500;
const OTHERS = [1, 2, 3];
const ask = (piece: Piece) => ({
  piece, steps: STEPS, plays: roomPlays(JOINER, STEPS), start: { joined: JOINED }, join: [{ player: JOINER, step: JOIN_STEP }], relay: { seed: 278, log: true },
});

/** A run's match, once the run took the scenario, the piece was presented and the match call answered. */
function started(r: Played): Match {
  expect(r.ok, `deep-show run takes the scenario: ${r.why}`).toBe(true);
  expect(r.outcome, `the eight-seat piece with players {min: 2, max: 8} and an open array is presented: ${r.why}`).toBe('presented');
  expect(r.code, `the match call answers: ${r.why}`).toBeNull();
  return r.match!;
}
/** The log check: what the relay handed copy 4 is only entries, from step 0. */
const logCheck = (m: Match, what: string): string[] => onlyEntries(m, { to: JOINER, since: 0, from: OTHERS, through: JOIN_STEP, state: m.copies.filter((c) => c.player !== JOINER) }, what);

describe(`${AC[2]} a copy joins a started match while the piece's lobby is open, from entries alone`, () => {
  it(`${AC[2]} while open is true, a fourth copy that joins at step 600 receives only entries, replays them from step 0 and enters with one joined entry at a stamped step, reaching the others' full-state hash at the next hash interval`, async () => {
    const m = started(await play(builds.show(), temp(), 'AC2 open', ask(roomPiece())));
    const f: string[] = [];
    if (playersOf(m).join() !== '1,2,3,4') f.push(`the match reply holds copies ${playersOf(m).join(', ')}, not 1 to 4`);
    const four = copyFor(m, JOINER);
    const others = m.copies.filter((c) => c.player !== JOINER);
    const one = rows(others[0]!, 'AC2');
    if (arrayAt(one, JOIN_STEP, 'lobby', 'copy 1')[0] !== true) f.push(`the piece's open array (rules.lobby) is ${show(arrayAt(one, JOIN_STEP, 'lobby', 'copy 1'))} after step ${JOIN_STEP}, not true`);
    // One joined entry for copy 4 at one stamped step, on every copy, its own too; and no other seat entry.
    const joined = oneSeat(m.copies, JOINER, 'joined', 'every copy');
    f.push(...joined.failures);
    const at = joined.at;
    if (at !== null && at <= JOIN_STEP) f.push(`the copies stamp seat {4, joined} at step ${at}, not after step ${JOIN_STEP}, at which it joined`);
    for (const c of m.copies) {
      const start = seatsOf(c).filter((s) => s.state === 'joined' && s.step === 0).map((s) => s.player);
      if (start.join() !== OTHERS.join()) f.push(`copy ${c.player}'s record holds joined entries at step 0 for players ${start.join(', ') || 'none'}, not 1, 2 and 3`);
      const other = laterSeats(c).filter((s) => !(s.player === JOINER && s.state === 'joined'));
      if (other.length) f.push(`copy ${c.player}'s record holds seat entries no seat change made: ${show(other, 400)}`);
    }
    // Only entries, as the relay's log shows, from step 0.
    f.push(...logCheck(m, 'AC2'));
    // It replays them from step 0.
    const ups = catchUpsOf(four, 'copy 4');
    if (ups.length !== 1) f.push(`copy 4 reports ${ups.length} replays (catch_ups), not one: ${show(ups.map((u) => u.raw))}`);
    const up = ups[0];
    if (up && up.from !== 0) f.push(`copy 4's replay starts at step ${up.from}, not 0`);
    if (up && up.to < JOIN_STEP) f.push(`copy 4's replay runs to step ${up.to} only, short of step ${JOIN_STEP}, at which it joined`);
    if (up && up.steps !== up.to - up.from + 1) f.push(`copy 4's replay counts ${up.steps} steps from ${up.from} to ${up.to}`);
    // It enters: the rules give it seat 4 at the joined entry's step, on its copy as on the others', and every copy
    // plays on to the end.
    f.push(...playedOn(m.copies, STEPS, 'AC2'));
    if (at !== null) {
      if (ownersAt(one, at - 1, 'copy 1')[JOINER - 1] !== 0) f.push(`copy 1: before step ${at} seat 4 is played by ${String(ownersAt(one, at - 1, 'copy 1')[JOINER - 1])}, not the piece's bot (0)`);
      for (const c of [others[0]!, four]) for (const k of [at, STEPS - 1]) {
        const owner = ownersAt(rows(c, 'AC2'), k, `copy ${c.player}`);
        if (JSON.stringify(owner) !== JSON.stringify([1, 2, 3, 4, 0, 0, 0, 0])) f.push(`copy ${c.player}: after step ${k} the seats are played by ${show(owner)}, not players 1 to 4 and the bot for the other four`);
      }
      f.push(...nextHashAgrees(m.copies, at, 'AC2'));
      // Its own entries travel from then on, and none before.
      const mine = trackLines(others[0]!, STEPS).filter((l) => / p4 /.test(l) && l.includes('"aim"')).map((l) => Number(l.split(' ')[0]));
      if (mine.length === 0) f.push('copy 1\'s record holds no entry of player 4\'s: the copy that entered never played');
      if (mine.some((k) => k < at)) f.push(`copy 1's record holds an entry of player 4's at step ${Math.min(...mine)}, before it entered at step ${at}`);
    }
    f.push(...hashesAgree(m.copies, others, 'AC2', Math.floor(STEPS / HASH_EVERY) - 2));
    const confirmed = Math.min(...m.copies.map((c) => c.record?.confirmed ?? -1));
    if (confirmed < STEPS - 3 * WINDOW) f.push(`the four copies confirmed only through step ${confirmed} of ${STEPS}`);
    f.push(...tracksAgree(m.copies, confirmed + 1, 'AC2 the four copies\' records'));
    expect(f, `${AC[2]} copy 4 joining at step ${JOIN_STEP} while the lobby is open:\n  ${f.slice(0, 30).join('\n  ')}`).toEqual([]);
  }, TIMEOUT);

  it(`${AC[2]} while open is false the same join is refused`, async () => {
    const m = started(await play(builds.show(), temp(), 'AC2 closed', ask(roomPiece({ id: DOC.closed, open: { until: CLOSED_FROM } }))));
    const f: string[] = [];
    const four = copyFor(m, JOINER);
    const others = m.copies.filter((c) => c.player !== JOINER);
    const one = rows(others[0]!, 'AC2 closed');
    // The fixture's lobby: open through step 299, closed from 300, so closed when copy 4 joins.
    for (const [k, want] of [[CLOSED_FROM - 1, true], [CLOSED_FROM, false], [JOIN_STEP, false]] as const) {
      if (arrayAt(one, k, 'lobby', 'copy 1')[0] !== want) f.push(`the piece's open array (rules.lobby) is ${show(arrayAt(one, k, 'lobby', 'copy 1'))} after step ${k}, not ${want}`);
    }
    if (joinRefused(four) !== 'started') f.push(`copy 4's join is ${joinRefused(four) === null ? 'not refused' : `refused ${joinRefused(four)}`} (join_refused), not refused started, as a join after a match's first frame is today`);
    if (four.ran !== 0) f.push(`copy 4, refused, ran ${four.ran} match steps`);
    for (const c of m.copies) {
      const its = seatsOf(c).filter((s) => s.player === JOINER);
      if (its.length) f.push(`copy ${c.player}'s record holds seat entries for the refused copy: ${show(its)}`);
    }
    const handed = logOf(m, 'AC2 closed').filter((r) => r.to === JOINER && r.delivered !== null);
    if (handed.length) f.push(`the relay handed the refused copy ${handed.length} frames of the match`);
    f.push(...playedOn(others, STEPS, 'AC2 closed'));
    f.push(...hashesAgree(others, others, 'AC2 closed', Math.floor(STEPS / HASH_EVERY) - 2));
    expect(f, `${AC[2]} copy 4 joining at step ${JOIN_STEP} while the lobby is closed:\n  ${f.slice(0, 30).join('\n  ')}`).toEqual([]);
  }, TIMEOUT);

  it(`${AC[2]} a planted relay that sends a joiner state instead of entries fails the log check, naming the frame`, async () => {
    const m = started(await play(builds.show(), temp(), 'AC2 planted', { ...ask(roomPiece()), planted: 'relay_sends_joiner_state' }));
    failsNaming(logCheck(m, 'AC2 planted'), [/^frame \d+ \(to copy 4, /], 'the relay that sends a joiner state');
  }, TIMEOUT);
});
