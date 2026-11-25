// AC3 #278.aa43e69b: A copy that left comes back: copy 3, killed at step 900 and stamped `left` as #277 stamps it,
// joins again at step 1,500 while `open` is true, receives only entries from step 0, replays them and enters with one
// `joined` entry, reaching the others' full-state hash at the next hash interval with the seat the piece's rules give
// it; with `open` false at step 1,500 its join is refused; a planted relay that answers it with its old seat's state
// instead of entries fails the log check, naming the frame
//
// The eight-seat piece in one process over the test relay (`match`), started by three copies; copy 3 is killed right
// after it runs step 900 (#277's `kill`: its last message is for step 902, and the others stamp `seat {3, left}` at
// 903), and its person clicks Join again right after the first player's copy runs step 1,500 (`join`), as player 3.
// The piece's rules give a joining player the seat of its own number, so its old seat, which the bot played from the
// leave. The second run's lobby is closed from step 300. The log check is helpers.ts's `onlyEntries` over what the
// relay handed copy 3 from the time copy 1 ran step 1,500: only frames of steps' entries, holding none of the piece's
// state, and carrying players 1 and 2's messages for every step from 0 through 1,500. The planted relay is
// `relay_sends_old_seat_state`. Wrong programs it fails: the merge base (a leave ends the match, and nobody joins
// after the start); a returning copy handed its old seat's state, or only the entries since it left; one seated as a
// new player; one that parts from the others; a return taken while the lobby is closed.
import { describe, expect, it } from 'vitest';
import { CLOSED_FROM, DOC, HASH_EVERY, JOINED, KILLED, KILL_STEP, LEFT_AT, REJOIN_STEP, STATE, WINDOW, roomPiece, roomPlays, type Piece } from './fixtures.ts';
import {
  AC, FULL, TIMEOUT, arrayAt, catchUpsOf, copyFor, failsNaming, hashesAgree, joinRefused, laterSeats, nextHashAgrees, oneSeat, onlyEntries, ownersAt, play, playedOn,
  playersOf, rows, seatsOf, show, tracksAgree, useBuilds, useChildren, useTemp, type Match, type Played,
} from './helpers.ts';

const builds = useBuilds({ show: [FULL] });
useChildren();
const temp = useTemp();
const STEPS = 2_400;
const STAYED = [1, 2];
const ask = (piece: Piece) => ({
  piece, steps: STEPS, plays: roomPlays(JOINED, STEPS), start: { joined: JOINED }, kill: [{ player: KILLED, step: KILL_STEP }], join: [{ player: KILLED, step: REJOIN_STEP }],
  relay: { seed: 278, log: true },
});

/** A run's match, once the run took the scenario, the piece was presented and the match call answered. */
function started(r: Played): Match {
  expect(r.ok, `deep-show run takes the scenario: ${r.why}`).toBe(true);
  expect(r.outcome, `the eight-seat piece with players {min: 2, max: 8} and an open array is presented: ${r.why}`).toBe('presented');
  expect(r.code, `the match call answers: ${r.why}`).toBeNull();
  return r.match!;
}
/** The log check: what the relay handed copy 3 once it joined again is only entries, from step 0. */
function logCheck(m: Match, what: string): string[] {
  const stayed = m.copies.filter((c) => c.player !== KILLED);
  const since = stayed[0]?.ranAt?.[REJOIN_STEP];
  if (since === undefined) return [`${what}: copy 1 doesn't say when it ran step ${REJOIN_STEP} (ran_at), so what the relay handed copy 3 after that can't be read`];
  return onlyEntries(m, { to: KILLED, since, from: STAYED, through: REJOIN_STEP, state: stayed }, what);
}
/** Copy 3 was killed at step 900 and stamped left as #277 stamps it: one `seat {3, left}` at 903 on copies 1 and 2. */
function leftFailures(stayed: Match['copies']): string[] {
  const left = oneSeat(stayed, KILLED, 'left', 'copies 1 and 2');
  return [...left.failures, ...(left.at !== null && left.at !== LEFT_AT ? [`the copies stamp seat {3, left} at step ${left.at}, not ${LEFT_AT}, the step after copy 3's last message`] : [])];
}

describe(`${AC[3]} a copy that left comes back while the piece's lobby is open, from entries alone`, () => {
  it(`${AC[3]} copy 3, killed at step 900 and stamped left, joins again at step 1,500 while open is true, receives only entries from step 0, replays them and enters with one joined entry, reaching the others' full-state hash at the next hash interval with the seat the piece's rules give it`, async () => {
    const m = started(await play(builds.show(), temp(), 'AC3 open', ask(roomPiece())));
    const f: string[] = [];
    if (playersOf(m).join() !== '1,2,3') f.push(`the match reply holds copies ${playersOf(m).join(', ')}, not 1 to 3 (player 3's the copy that came back)`);
    const three = copyFor(m, KILLED);
    const stayed = m.copies.filter((c) => c.player !== KILLED);
    const one = rows(stayed[0]!, 'AC3');
    if (arrayAt(one, REJOIN_STEP, 'lobby', 'copy 1')[0] !== true) f.push(`the piece's open array (rules.lobby) is ${show(arrayAt(one, REJOIN_STEP, 'lobby', 'copy 1'))} after step ${REJOIN_STEP}, not true`);
    f.push(...leftFailures(stayed));
    // One joined entry for player 3 after its leave, at one stamped step, on every copy, its own too.
    const joined = oneSeat(m.copies, KILLED, 'joined', 'every copy', { from: LEFT_AT + 1 });
    f.push(...joined.failures);
    const at = joined.at;
    if (at !== null && at <= REJOIN_STEP) f.push(`the copies stamp seat {3, joined} at step ${at}, not after step ${REJOIN_STEP}, at which it joined again`);
    for (const c of stayed) {
      const other = laterSeats(c).filter((s) => !(s.player === KILLED && ((s.state === 'left' && s.step === LEFT_AT) || (s.state === 'joined' && s.step === at))));
      if (other.length) f.push(`copy ${c.player}'s record holds seat entries no seat change made: ${show(other, 400)}`);
    }
    // Only entries, as the relay's log shows, from step 0.
    f.push(...logCheck(m, 'AC3'));
    // It replays them from step 0.
    const ups = catchUpsOf(three, 'copy 3');
    if (ups.length !== 1) f.push(`the copy that came back reports ${ups.length} replays (catch_ups), not one: ${show(ups.map((u) => u.raw))}`);
    const up = ups[0];
    if (up && up.from !== 0) f.push(`its replay starts at step ${up.from}, not 0`);
    if (up && up.to < REJOIN_STEP) f.push(`its replay runs to step ${up.to} only, short of step ${REJOIN_STEP}, at which it joined again`);
    if (up && up.steps !== up.to - up.from + 1) f.push(`its replay counts ${up.steps} steps from ${up.from} to ${up.to}`);
    // The seat the piece's rules give it: its old seat 3, the bot's from the leave until it enters.
    f.push(...playedOn(m.copies, STEPS, 'AC3'));
    if (at !== null) {
      const owner = (k: number): unknown => ownersAt(one, k, 'copy 1')[KILLED - 1];
      const gone = (k: number): unknown => arrayAt(one, k, 'gone', 'copy 1')[KILLED - 1];
      if (owner(LEFT_AT - 1) !== KILLED) f.push(`copy 1: before the leave seat 3 is played by ${String(owner(LEFT_AT - 1))}, not player 3`);
      const notBot = Array.from({ length: at - LEFT_AT }, (_, i) => LEFT_AT + i).find((k) => owner(k) !== 0 || gone(k) !== STATE.left);
      if (notBot !== undefined) f.push(`copy 1: at step ${notBot}, after the leave and before the return, seat 3 is played by ${String(owner(notBot))} (gone ${String(gone(notBot))}), not the bot (0) for a seat whose player left`);
      const notBack = Array.from({ length: STEPS - at }, (_, i) => at + i).find((k) => owner(k) !== KILLED || gone(k) !== 0);
      if (notBack !== undefined) f.push(`copy 1: at step ${notBack}, after the return, seat 3 is played by ${String(owner(notBack))} (gone ${String(gone(notBack))}), not player 3, as the piece's rules give a returning player its old seat`);
      const its = ownersAt(rows(three, 'AC3'), at, 'copy 3');
      if (JSON.stringify(its) !== JSON.stringify([1, 2, 3, 0, 0, 0, 0, 0])) f.push(`the copy that came back: after step ${at} the seats are played by ${show(its)}, not players 1 to 3 and the bot for the other five`);
      f.push(...nextHashAgrees(m.copies, at, 'AC3'));
    }
    f.push(...hashesAgree(m.copies, stayed, 'AC3', Math.floor(STEPS / HASH_EVERY) - 2));
    const confirmed = Math.min(...m.copies.map((c) => c.record?.confirmed ?? -1));
    if (confirmed < STEPS - 3 * WINDOW) f.push(`the three copies confirmed only through step ${confirmed} of ${STEPS}`);
    f.push(...tracksAgree(m.copies, confirmed + 1, 'AC3 the three copies\' records'));
    expect(f, `${AC[3]} copy 3 killed at step ${KILL_STEP} and joining again at step ${REJOIN_STEP} while the lobby is open:\n  ${f.slice(0, 30).join('\n  ')}`).toEqual([]);
  }, TIMEOUT);

  it(`${AC[3]} with open false at step 1,500 its join is refused`, async () => {
    const m = started(await play(builds.show(), temp(), 'AC3 closed', ask(roomPiece({ id: DOC.closed, open: { until: CLOSED_FROM } }))));
    const f: string[] = [];
    const three = copyFor(m, KILLED);
    const stayed = m.copies.filter((c) => c.player !== KILLED);
    const one = rows(stayed[0]!, 'AC3 closed');
    if (arrayAt(one, REJOIN_STEP, 'lobby', 'copy 1')[0] !== false) f.push(`the piece's open array (rules.lobby) is ${show(arrayAt(one, REJOIN_STEP, 'lobby', 'copy 1'))} after step ${REJOIN_STEP}, not false`);
    f.push(...leftFailures(stayed));
    if (joinRefused(three) !== 'started') f.push(`the returning copy's join is ${joinRefused(three) === null ? 'not refused' : `refused ${joinRefused(three)}`} (join_refused), not refused started, as a join after a match's first frame is today`);
    if (three.ran !== 0) f.push(`the returning copy, refused, ran ${three.ran} match steps`);
    for (const c of stayed) {
      const again = seatsOf(c).filter((s) => s.player === KILLED && s.state === 'joined' && s.step > 0);
      if (again.length) f.push(`copy ${c.player}'s record holds a joined entry for the refused copy: ${show(again)}`);
    }
    if (ownersAt(one, STEPS - 1, 'copy 1')[KILLED - 1] !== 0) f.push(`copy 1: after the last step seat 3 is played by ${String(ownersAt(one, STEPS - 1, 'copy 1')[KILLED - 1])}, not the bot (0), which keeps a refused player's seat`);
    f.push(...playedOn(stayed, STEPS, 'AC3 closed'));
    f.push(...hashesAgree(stayed, stayed, 'AC3 closed', Math.floor(STEPS / HASH_EVERY) - 2));
    expect(f, `${AC[3]} copy 3 joining again at step ${REJOIN_STEP} while the lobby is closed:\n  ${f.slice(0, 30).join('\n  ')}`).toEqual([]);
  }, TIMEOUT);

  it(`${AC[3]} a planted relay that answers it with its old seat's state instead of entries fails the log check, naming the frame`, async () => {
    const m = started(await play(builds.show(), temp(), 'AC3 planted', { ...ask(roomPiece()), planted: 'relay_sends_old_seat_state' }));
    failsNaming(logCheck(m, 'AC3 planted'), [/^frame \d+ \(to copy 3, /], 'the relay that answers with the old seat\'s state');
  }, TIMEOUT);
});
