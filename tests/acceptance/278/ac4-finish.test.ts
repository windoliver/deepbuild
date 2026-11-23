// AC4 #278.bbb4eb66: A piece that writes 1 to `finish` at step 3,000 ends the match as finished on every copy once
// step 3,000 is confirmed; when a late entry rolls back over step 3,000 and the corrected run doesn't write it, the
// match plays on, and a planted module that ends on the predicted step ends it on one copy alone and fails, naming the
// step; after a finished match the first player's Start begins the next from the document's start with the same seats
// and no Join, and the two matches record two tracks, each replaying alone to its own full-state hashes
//
// The eight-seat piece whose logic item names `done` as `finish`: its rules write 1 to it at step 3,000 unless a
// player's `stay` entry has reached them. Three runs:
// - in one process (`match`, three copies, `next`): the match ends as finished on every copy, naming step 3,000; the
//   room's next match starts from the document's start with the same three seats and plays 600 steps on other
//   scripts; each match's record, replayed alone (#551's `replay`), gives that match's hashes;
// - in one process, player 2's `stay` entry stamped at step 3,000 reaching copy 1 only once it has run step 3,004
//   (#551's `relay.deliver`): copy 1 runs step 3,000 on a prediction that writes `finish`, rolls back over it, and the
//   match plays on; the planted module is `net_finishes_on_predicted_step`;
// - live, three copies in the app through the shipped relay behind #549's door: after the match finishes, the first
//   player's click on Start begins the next on the same three connections, with no second Join.
// Wrong programs it fails: the merge base (no `finish`; a match ends only by a leave, a timeout, a desync or a fault);
// a finish that ends one copy, or ends on a predicted step; a room that needs a new Join or re-seats its copies; a
// next match that carries the last one's state or track.
import { describe, expect, it } from 'vitest';
import {
  DELAY, DOC, FINISH_AT, HASH_EVERY, JOINED, LATE, LIVE_TIMEOUT_S, NEXT_STEPS, SEATS, STATE, WINDOW, roomPiece, roomPlays, type JsonValue, type Plays,
} from './fixtures.ts';
import {
  AC, FULL, Script, TIMEOUT, arrayAt, endedStep, failsNaming, hashesAgree, hashesOf, joinedMatches, liveRoom, ownersAt, play, playedOf, playedOn, playersOf, replayCall, rows,
  runShow, seatsOf, sentThrough, show, startOf, trackLines, useBuilds, useCertificate, useChildren, useCleanup, useClosers, useTemp, world, type Copy, type Match, type Played,
  type Run,
} from './helpers.ts';
import { putEvidence } from '../549/helpers.ts';

const builds = useBuilds({ show: [FULL], relay: true });
const certs = useCertificate();
useCleanup();
useChildren();
const closing = useClosers();
const temp = useTemp();

const SEATED = Array.from({ length: SEATS }, (_, s) => (s < JOINED ? s + 1 : 0));
/** The rules' `tally` after step 0 of a match of three: the fold of `{1, joined}`, `{2, joined}`, `{3, joined}`. */
const TALLY_0 = [1, 2, 3].reduce((t, p) => (Math.imul(t, 31) + p * 100 + STATE.joined) | 0, 0);
const JOINED_AT_0 = [1, 2, 3].map((player) => ({ step: 0, player, state: 'joined', writer: 'net' }));

/** A run's match, once the run took the scenario, the piece was presented and the match call answered. */
function started(r: Played): Match {
  expect(r.ok, `deep-show run takes the scenario: ${r.why}`).toBe(true);
  expect(r.outcome, `the eight-seat piece with players {min: 2, max: 8} and a finish array is presented: ${r.why}`).toBe('presented');
  expect(r.code, `the match call answers: ${r.why}`).toBeNull();
  return r.match!;
}
/** Every `aim` entry of a script as a record's merged track holds it before `before`, stamped `delay` steps later. */
function scriptLines(plays: Plays, before: number): string[] {
  const out: { step: number; player: number; line: string }[] = [];
  for (const [p, list] of Object.entries(plays)) for (const e of list) {
    if (e.control === 'aim' && e.step + DELAY < before) out.push({ step: e.step + DELAY, player: Number(p), line: `${e.step + DELAY} p${p} ${JSON.stringify({ control: 'aim', value: e.value })}` });
  }
  return out.sort((x, y) => x.step - y.step || x.player - y.player).map((x) => x.line);
}
const aimLines = (c: Copy, before: number): string[] => trackLines(c, before).filter((l) => l.includes('"aim"'));
/** A match that finished at step 3,000 on this copy. */
function finishedFailures(c: Copy, what: string): string[] {
  const f: string[] = [];
  if (c.end !== 'finished') f.push(`${what}'s match ended ${String(c.end)}, not finished (${show(c.raw['ended'] ?? null, 300)})`);
  if (endedStep(c) !== FINISH_AT) f.push(`${what}'s report names step ${String(endedStep(c))} (ended.step), not ${FINISH_AT}, the step whose finish ended the match`);
  if (c.record?.end !== 'finished') f.push(`${what}'s record ends ${String(c.record?.end)}, not finished`);
  if ((c.record?.confirmed ?? -1) < FINISH_AT) f.push(`${what}'s record is confirmed through step ${String(c.record?.confirmed)}, short of step ${FINISH_AT}, which ended the match`);
  if (c.ran <= FINISH_AT || c.ran > FINISH_AT + 1 + WINDOW) f.push(`${what} ran ${c.ran} match steps, not step ${FINISH_AT} and at most its window of ${WINDOW} past it`);
  return f;
}

describe(`${AC[4]} a piece ends its match as finished, and the room plays the next`, () => {
  it(`${AC[4]} a piece that writes 1 to finish at step 3,000 ends the match as finished on every copy; the first player's Start begins the next from the document's start with the same seats, and the two matches record two tracks, each replaying alone to its own full-state hashes`, async () => {
    const steps = FINISH_AT + 600;
    const plays = roomPlays(JOINED, steps);
    const nextPlays = roomPlays(JOINED, NEXT_STEPS, { seed: 2780 });
    const piece = roomPiece({ id: DOC.finish, finishAt: FINISH_AT });
    const m = started(await play(builds.show(), temp(), 'AC4 finish', { piece, steps, plays, start: { joined: JOINED }, relay: { seed: 278 }, next: { steps: NEXT_STEPS, plays: nextPlays } }));
    const f: string[] = [];
    if (playersOf(m).join() !== '1,2,3') f.push(`the match holds copies ${playersOf(m).join(', ')}, not the three that joined`);
    for (const c of m.copies) {
      f.push(...finishedFailures(c, `copy ${c.player}`));
      const r = rows(c, 'AC4');
      for (const [k, want] of [[FINISH_AT - 1, 0], [FINISH_AT, 1]] as const) if (arrayAt(r, k, 'done', `copy ${c.player}`)[0] !== want) f.push(`copy ${c.player}: the piece's finish array (rules.done) is ${show(arrayAt(r, k, 'done', `copy ${c.player}`))} after step ${k}, not ${want}`);
    }
    f.push(...hashesAgree(m.copies, m.copies, 'AC4', FINISH_AT / HASH_EVERY - 2));
    expect(f, `${AC[4]} the match that finishes at step ${FINISH_AT}:\n  ${f.slice(0, 30).join('\n  ')}`).toEqual([]);

    // The next match: the same room, from the document's start.
    expect(m.next, `the match reply holds the room's next match (next: {copies, relay}); it holds ${Object.keys(m.reply).join(', ')}`).not.toBeNull();
    const n = m.next!;
    if (playersOf(n).join() !== '1,2,3') f.push(`the next match holds copies ${playersOf(n).join(', ')}, not the same three`);
    for (const c of n.copies) {
      const what = `the next match's copy ${c.player}`;
      if (JSON.stringify(seatsOf(c)) !== JSON.stringify(JOINED_AT_0)) f.push(`${what}'s record holds the seat entries ${show(seatsOf(c), 500)}, not the same three seats at step 0`);
      const r = rows(c, 'AC4 next');
      if (JSON.stringify(ownersAt(r, 0, what)) !== JSON.stringify(SEATED)) f.push(`${what}: after step 0 the seats are played by ${show(ownersAt(r, 0, what))}, not ${show(SEATED)}`);
      if (arrayAt(r, 0, 'tally', what)[0] !== TALLY_0) f.push(`${what}: after step 0 the rules' tally is ${show(arrayAt(r, 0, 'tally', what))}, not ${TALLY_0}: the next match doesn't start from the document's start`);
      if (arrayAt(r, NEXT_STEPS - 1, 'done', what)[0] !== 0) f.push(`${what}: the piece's finish array is ${show(arrayAt(r, NEXT_STEPS - 1, 'done', what))} after step ${NEXT_STEPS - 1}: the last match's finish was carried over`);
    }
    f.push(...playedOn(n.copies, NEXT_STEPS, 'AC4 next'));
    f.push(...hashesAgree(n.copies, n.copies, 'AC4 next', Math.floor(NEXT_STEPS / HASH_EVERY) - 2));
    // Two tracks: each record holds its own match's entries, the scripts' own, and the two scripts differ.
    const upTo = NEXT_STEPS - 3 * WINDOW;
    expect(scriptLines(plays, upTo), 'the two matches\' scripts differ, so their tracks can be told apart').not.toEqual(scriptLines(nextPlays, upTo));
    const [first, second] = [m.copies[0]!, n.copies[0]!];
    if (JSON.stringify(aimLines(first, upTo)) !== JSON.stringify(scriptLines(plays, upTo))) f.push(`the first match's record doesn't hold its own players' entries before step ${upTo}: ${show(aimLines(first, upTo).slice(0, 6))} where they made ${show(scriptLines(plays, upTo).slice(0, 6))}`);
    if (JSON.stringify(aimLines(second, upTo)) !== JSON.stringify(scriptLines(nextPlays, upTo))) f.push(`the next match's record doesn't hold its own players' entries before step ${upTo}: ${show(aimLines(second, upTo).slice(0, 6))} where they made ${show(scriptLines(nextPlays, upTo).slice(0, 6))}`);
    expect(f, `${AC[4]} the room's next match:\n  ${f.slice(0, 30).join('\n  ')}`).toEqual([]);

    // Each record replayed alone gives its own match's full-state hashes.
    const evidence = temp();
    putEvidence(evidence, piece.program.bytes);
    const s = new Script();
    s.present(DOC.finish, piece.doc);
    const trackOf = (c: Copy): JsonValue[] => (Array.isArray(c.record?.raw['track']) ? c.record!.raw['track'] : []);
    const replays = [s.add(replayCall(DOC.finish, trackOf(first), FINISH_AT + 1, HASH_EVERY), 0.5), s.add(replayCall(DOC.finish, trackOf(second), NEXT_STEPS, HASH_EVERY), 0.5)];
    const r = await runShow(builds.show(), world(evidence, DOC.finish, s.calls), 'AC4 the replays');
    expect(r.ok, `the replays' run: ${r.why}`).toBe(true);
    const alone = replays.map((i, k) => hashesOf(r.replies[i], `AC4 the replay of the ${k === 0 ? 'first' : 'next'} match's record`));
    for (const [k, c, least] of [[0, first, FINISH_AT / HASH_EVERY - 2], [1, second, Math.floor(NEXT_STEPS / HASH_EVERY) - 2]] as const) {
      const which = k === 0 ? 'first' : 'next';
      const same = c.hashes.filter((h) => alone[k]!.get(h.step) === h.hash).length;
      const other = c.hashes.find((h) => alone[k]!.has(h.step) && alone[k]!.get(h.step) !== h.hash);
      if (other) f.push(`the ${which} match's record, replayed alone, gives another full-state hash at step ${other.step} than the match did`);
      if (same < least) f.push(`the ${which} match's record, replayed alone, gives the match's full-state hash at only ${same} hash intervals, fewer than ${least}`);
    }
    // Its own: the next match's hashes aren't the first's (their entries differ from step 2 on).
    const apart = second.hashes.find((h) => h.step > 0 && first.hashes.some((x) => x.step === h.step && x.hash !== h.hash));
    if (!apart) f.push('the two matches report the same full-state hash at every hash interval both ran, though their players made other entries');
    expect(f, `${AC[4]} each match's record replayed alone:\n  ${f.join('\n  ')}`).toEqual([]);
  }, TIMEOUT);

  it(`${AC[4]} when a late entry rolls back over step 3,000 and the corrected run doesn't write finish, the match plays on; a planted module that ends on the predicted step ends it on one copy alone and fails, naming the step`, async () => {
    const steps = FINISH_AT + 600;
    const ask = {
      piece: roomPiece({ id: DOC.finish, finishAt: FINISH_AT }), steps, plays: roomPlays(JOINED, steps, { stay: { player: LATE.player, step: LATE.madeAt } }), start: { joined: JOINED },
      relay: { seed: 278, deliver: [{ player: LATE.player, step: FINISH_AT, to: LATE.to, at: LATE.at }] },
    };
    /** No copy may end the match: the corrected run of step 3,000 doesn't write finish. */
    const judge = (m: Match): string[] => m.copies.filter((c) => c.end === 'finished').map((c) => `copy ${c.player} ended the match as finished at step ${String(endedStep(c))}, a step whose corrected run doesn't write finish; copies ${m.copies.filter((x) => x.end !== 'finished').map((x) => x.player).join(' and ') || 'none'} didn't`);
    const m = started(await play(builds.show(), temp(), 'AC4 a late entry', ask));
    const f = judge(m);
    f.push(...playedOn(m.copies, steps, 'AC4 a late entry'));
    // Copy 1 ran step 3,000 on its prediction and rolled back over it when player 2's entry came.
    const one = m.copies[LATE.to - 1]!;
    const rolled = Array.isArray(one.raw['rolled_back']) ? one.raw['rolled_back'] : [];
    if (!rolled.some((b) => typeof b === 'object' && b !== null && !Array.isArray(b) && b['to'] === FINISH_AT && Number(b['from']) >= LATE.at)) f.push(`copy 1 reports no rollback to step ${FINISH_AT} from step ${LATE.at} or later (rolled_back): ${show(rolled.slice(-4))}`);
    for (const c of m.copies) {
      const r = rows(c, 'AC4 a late entry');
      if (arrayAt(r, FINISH_AT, 'held', `copy ${c.player}`)[0] !== 1 || arrayAt(r, FINISH_AT, 'done', `copy ${c.player}`)[0] !== 0) f.push(`copy ${c.player}: after the corrected step ${FINISH_AT} the rules hold held ${show(arrayAt(r, FINISH_AT, 'held', `copy ${c.player}`))} and done ${show(arrayAt(r, FINISH_AT, 'done', `copy ${c.player}`))}, not 1 and 0`);
    }
    f.push(...hashesAgree(m.copies, m.copies, 'AC4 a late entry', Math.floor(steps / HASH_EVERY) - 2));
    expect(f, `${AC[4]} the late entry that rolls back over step ${FINISH_AT}:\n  ${f.slice(0, 30).join('\n  ')}`).toEqual([]);

    const twin = started(await play(builds.show(), temp(), 'AC4 a late entry', { ...ask, planted: 'net_finishes_on_predicted_step' }));
    const ended = twin.copies.filter((c) => c.end === 'finished').map((c) => c.player);
    expect(ended, `the planted module ends the match on copy ${LATE.to} alone, the one that predicted step ${FINISH_AT}: ${show(twin.copies.map((c) => ({ player: c.player, end: c.end, ended: c.raw['ended'] ?? null })), 600)}`).toEqual([LATE.to]);
    failsNaming(judge(twin), [new RegExp(`^copy ${LATE.to} ended the match as finished at step ${FINISH_AT},`)], 'the module that ends on the predicted step');
  }, TIMEOUT);

  it(`${AC[4]} in the app, after a finished match the first player's Start begins the next with the same seats and no Join`, async () => {
    const steps = FINISH_AT + 600;
    const plays = roomPlays(JOINED, steps);
    const nextPlays = roomPlays(JOINED, NEXT_STEPS, { seed: 2780 });
    const at = { first: -1, again: -1, next: -1 };
    const played: [number, number][] = [];
    const room = await liveRoom({
      builds, certs, temp, closing, copies: JOINED, what: 'AC4 the app',
      piece: (relay) => roomPiece({ id: DOC.liveFinish, finishAt: FINISH_AT, net: { relay, timeout: LIVE_TIMEOUT_S } }),
      first: (s, start) => {
        s.click(start);
        at.first = s.playMatch(steps, { plays: plays['1']! });
        at.again = s.scope();
        s.click(start);
        at.next = s.playMatch(NEXT_STEPS, { plays: nextPlays['1']! });
      },
      others: (s, p) => { played[p] = [s.playMatch(steps, { plays: plays[String(p)]! }), s.playMatch(NEXT_STEPS, { plays: nextPlays[String(p)]! })]; },
    });
    expect(room.outcome, `the eight-seat piece with players {min: 2, max: 8} and a finish array is presented: ${room.why}`).toBe('presented');
    expect(room.start, `with two copies joined the app shows the first player a Start (scope's state.start): ${room.why}`).not.toBeNull();
    const runs: [Run, number, number][] = [[room.first!, at.first, at.next], ...room.others.map((r, i): [Run, number, number] => [r, ...played[i + 2]!])];
    runs.forEach(([r], k) => expect(r.ok, `copy ${k + 1}'s run: ${r.why}`).toBe(true));
    const f: string[] = [];
    const firsts = runs.map(([r, i], k) => playedOf(r.replies[i]!, `AC4 the app's copy ${k + 1}, the first match`));
    for (const c of firsts) f.push(...finishedFailures(c, `copy ${c.player}`));
    // After the finish the app shows the first player Start again, where it showed it before.
    const again = startOf(room.first!.replies[at.again]);
    if (again?.state !== 'open') f.push(`after the finished match the app's Start is ${again ? again.state : again === null ? 'not shown' : 'missing from the scope\'s state'}, not open for the next match`);
    else if (JSON.stringify(again.button) !== JSON.stringify(room.start!.button)) f.push(`the next match's Start is drawn at ${show(again.button)}, not where the lobby's was (${show(room.start!.button)})`);
    expect(f, `${AC[4]} the live match that finishes at step ${FINISH_AT}:\n  ${f.slice(0, 30).join('\n  ')}`).toEqual([]);
    const nexts = runs.map(([r, , i], k) => playedOf(r.replies[i]!, `AC4 the app's copy ${k + 1}, the next match`));
    if (nexts.map((c) => c.player).join() !== '1,2,3') f.push(`in the next match the copies are players ${nexts.map((c) => c.player).join(', ')}, not 1, 2 and 3 as before`);
    if (new Set(nexts.map((c) => c.match)).size !== 1 || nexts[0]!.match === firsts[0]!.match) f.push(`the next match's ID is ${[...new Set(nexts.map((c) => c.match))].join(', ')} and the first's ${firsts[0]!.match}: a match ID is drawn for each match, one all its copies share`);
    for (const c of nexts) {
      if (c.ran !== NEXT_STEPS) f.push(`in the next match copy ${c.player} ran ${c.ran} match steps, not ${NEXT_STEPS}; it ended ${String(c.end)} (${show(c.raw['ended'] ?? null, 300)})`);
      const seats = seatsOf(c).filter((s) => s.step < NEXT_STEPS - 2 * WINDOW);
      if (JSON.stringify(seats) !== JSON.stringify(JOINED_AT_0)) f.push(`the next match's copy ${c.player}'s record holds the seat entries ${show(seats, 500)}, not the same three seats at step 0`);
    }
    f.push(...hashesAgree(nexts, nexts, 'AC4 the next match', Math.floor(NEXT_STEPS / HASH_EVERY) - 2));
    // No Join: the room keeps its three connections, and each sent one join.
    const joinsSent = sentThrough(room.door).filter((x) => x.message.member === 'join').length;
    const lobbyOfTwo = 2;
    if (joinedMatches(room.door).length !== lobbyOfTwo + JOINED || joinsSent !== lobbyOfTwo + JOINED) f.push(`${joinsSent - lobbyOfTwo} join messages crossed the door for the room's two matches, not ${JOINED}, one a copy`);
    if (room.door.connections.length !== lobbyOfTwo + JOINED) f.push(`${room.door.connections.length - lobbyOfTwo} connections reached the relay for the room's two matches, not ${JOINED}: the room didn't keep its connections`);
    expect(f, `${AC[4]} the room's next match in the app:\n  ${f.slice(0, 30).join('\n  ')}`).toEqual([]);
  }, TIMEOUT);
});
