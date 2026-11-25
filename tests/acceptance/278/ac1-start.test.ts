// AC1 #278.108a8250: With `players {min: 2, max: 8}`, three copies joined and the first player's Start clicked, the
// match starts with three played seats and five the piece's bots play, and every copy reads the same `net.seats`; a
// tour's entry, deep_drive's click in a replica and a synthetic click dispatched in the page each leave Start unpressed
// and the match unstarted; a planted module that starts the match on the third join with no click fails, naming the
// step
//
// The piece is fixtures.ts's eight-seat piece: its net item declares `players: {min: 2, max: 8}`, and its rules give a
// seat to each player a `joined` row of `net.seats` names and play every other seat with the piece's bot. Four runs:
// - in one process over the test relay (`match` with `start: {joined: 3}`): the three copies' rows, their seat entries
//   and their hashes;
// - in one process with Start never clicked (`start: {joined: 3, click: false}`): no copy runs a step; the planted
//   module is `net_starts_on_third_join`, and the step its failure names is 0, the first step a match runs;
// - live, three copies in the app through the shipped relay behind #549's door: the first player's scope shows Start
//   once the copies have joined; a tour's entry on the piece's own Start control and deep_drive's click in a replica
//   (the click a process posts, with no gesture serial) leave it open and `play_match` answers `not_started`; a
//   person's click presses it and the match plays;
// - live, the web player in headless Chrome as the first player with two app copies joined: every click a script in
//   the page can dispatch on the player's own Start leaves it open, with no frame through the door; a person's click
//   then starts the match.
// Wrong programs it fails: the merge base (one player count; the match starts when that many have joined); a match
// that waits for eight; a start with no `joined` rows, or with rows for seats nobody took; a Start a tour, a posted
// click or a page's script can press; a module that starts on the third join.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DOC, FLICKS, HASH_EVERY, JOINED, LIVE_TIMEOUT_S, SEATS, STATE, WINDOW, roomPiece, roomPlays, tourEntry } from './fixtures.ts';
import {
  AC, FULL, TIMEOUT, appCopy, arrayAt, exportWeb, failsNaming, framesThrough, hashesAgree, joinAt, joinedMatches, liveRoom, openPlayer, ownersAt, play, playedOf, playedOn,
  playersOf, relayAndDoor, rows, seatsOf, show, startOf, syntheticStartClicks, useBuilds, useCertificate, useChildren, useCleanup, useClosers, useTemp, waitFor, webStart,
  type Match, type Played, type Run,
} from './helpers.ts';

const builds = useBuilds({ show: [FULL], relay: true });
const certs = useCertificate();
useCleanup();
useChildren();
const closing = useClosers();
const temp = useTemp();
const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

/** Three played seats and five the piece's bot plays: `owner` after any step. */
const SEATED = Array.from({ length: SEATS }, (_, s) => (s < JOINED ? s + 1 : 0));
/** The rules' `tally` after step 0, when `net.seats` held `{1, joined}`, `{2, joined}` and `{3, joined}` in that order
 * and nothing else was read: each row folded as tally × 31 + player × 100 + state (106,572). */
const TALLY_0 = [1, 2, 3].reduce((t, p) => (Math.imul(t, 31) + p * 100 + STATE.joined) | 0, 0);
/** The three copies' seat entries at the start: one `joined` for each, at step 0, written by `net`. */
const JOINED_AT_0 = [1, 2, 3].map((player) => ({ step: 0, player, state: 'joined', writer: 'net' }));

/** A run's match, once the run took the scenario, the piece was presented and the match call answered. */
function started(r: Played): Match {
  expect(r.ok, `deep-show run takes the scenario: ${r.why}`).toBe(true);
  expect(r.outcome, `the eight-seat piece with players {min: 2, max: 8} is presented: ${r.why}`).toBe('presented');
  expect(r.code, `the match call answers: ${r.why}`).toBeNull();
  return r.match!;
}
/** With Start unclicked no copy runs a match step: each failure names the first step a copy ran, step 0. */
function unstarted(m: Match): string[] {
  const f: string[] = [];
  if (playersOf(m).join() !== '1,2,3') f.push(`the lobby holds copies ${playersOf(m).join(', ')}, not the three that joined`);
  for (const c of m.copies) {
    if (c.ran > 0) f.push(`copy ${c.player} ran match step 0 ${c.ranAt?.[0] !== undefined ? `at ${c.ranAt[0]} s ` : ''}and ${c.ran - 1} more with Start unclicked`);
    if (c.hashes.length) f.push(`copy ${c.player} reports ${c.hashes.length} full-state hashes of a match nobody started`);
    if (c.end !== null) f.push(`copy ${c.player}'s match ended ${c.end} before it started`);
  }
  return f;
}

describe(`${AC[1]} a match starts with whoever is there, on the first player's click alone`, () => {
  it(`${AC[1]} with players {min: 2, max: 8} and three copies joined, the match starts with three played seats and five the piece's bot plays, and every copy reads the same net.seats`, async () => {
    const STEPS = 600;
    const m = started(await play(builds.show(), temp(), 'AC1 three of eight', { piece: roomPiece(), steps: STEPS, plays: roomPlays(JOINED, STEPS), start: { joined: JOINED }, relay: { seed: 278 } }));
    const f: string[] = [];
    if (playersOf(m).join() !== '1,2,3') f.push(`the match holds copies ${playersOf(m).join(', ')}, not the three that joined`);
    for (const c of m.copies) {
      const what = `copy ${c.player}`;
      // The same net.seats: one joined entry for each copy that joined, at step 0, and none for a seat nobody took.
      const seats = seatsOf(c);
      if (JSON.stringify(seats) !== JSON.stringify(JOINED_AT_0)) f.push(`${what}'s record holds the seat entries ${show(seats, 500)}, not ${show(JOINED_AT_0)}`);
      const r = rows(c, 'AC1');
      const tally = arrayAt(r, 0, 'tally', what)[0];
      if (tally !== TALLY_0) f.push(`${what}'s rules read other net.seats rows at step 0: tally ${String(tally)}, not ${TALLY_0}, the fold of {1, joined}, {2, joined}, {3, joined}`);
      for (const k of [0, STEPS - 1]) if (JSON.stringify(ownersAt(r, k, what)) !== JSON.stringify(SEATED)) f.push(`${what}: after step ${k} the seats are played by ${show(ownersAt(r, k, what))}, not ${show(SEATED)} (0 the piece's bot)`);
      // Step 0 holds no entry yet (the first is stamped at step 2): a played seat rests at 2s − 7, and the bot has
      // moved each of its five.
      const pos = arrayAt(r, 0, 'pos', what);
      for (let s = 0; s < SEATS; s++) {
        const moved = pos[s] !== 2 * s - 7;
        if (s < JOINED && moved) f.push(`${what}: seat ${s + 1}, a player's, moved at step 0 with no entry (${String(pos[s])})`);
        if (s >= JOINED && !moved) f.push(`${what}: seat ${s + 1} rests at ${String(pos[s])} after step 0: the piece's bot didn't play it`);
      }
    }
    f.push(...playedOn(m.copies, STEPS, 'AC1'));
    f.push(...hashesAgree(m.copies, m.copies, 'AC1', Math.floor(STEPS / HASH_EVERY) - 2));
    expect(f, `${AC[1]} the match of three copies in an eight-seat piece:\n  ${f.slice(0, 30).join('\n  ')}`).toEqual([]);
  }, TIMEOUT);

  it(`${AC[1]} with three copies joined and Start unclicked no copy runs a step; a planted module that starts the match on the third join with no click fails, naming the step`, async () => {
    const ask = { piece: roomPiece(), steps: 120, plays: roomPlays(JOINED, 120), start: { joined: JOINED, click: false }, relay: { seed: 278 } };
    const honest = unstarted(started(await play(builds.show(), temp(), 'AC1 Start unclicked', ask)));
    expect(honest, `${AC[1]} three copies joined and nobody clicks Start:\n  ${honest.join('\n  ')}`).toEqual([]);
    const twin = started(await play(builds.show(), temp(), 'AC1 Start unclicked', { ...ask, planted: 'net_starts_on_third_join' }));
    failsNaming(unstarted(twin), [/ ran match step 0 /], 'the module that starts the match on the third join');
  }, TIMEOUT);

  it(`${AC[1]} in the app, a tour's entry and deep_drive's click in a replica leave Start unpressed and the match unstarted; the first player's own click starts it for the three copies`, async () => {
    const STEPS = 300;
    const plays = roomPlays(JOINED, STEPS);
    const at = { lobby: -1, shown: -1, afterTour: -1, afterPosted: -1, unstarted: -1, pressed: -1, played: -1 };
    const played: number[] = [];
    const room = await liveRoom({
      builds, certs, temp, closing, copies: JOINED, what: 'AC1 the app',
      piece: (relay) => roomPiece({ id: DOC.decoy, decoy: true, net: { relay, timeout: LIVE_TIMEOUT_S } }),
      first: (s, start) => {
        at.lobby = s.calls.length - 1;
        at.shown = s.scope();
        // A tour's entry on the piece's own Start control, and ten seconds for the piece's tour to play.
        s.add({ call: 'track', doc: DOC.decoy, load: [tourEntry(2), tourEntry(3)] });
        s.until(s.now / FLICKS + 10);
        at.afterTour = s.scope();
        // deep_drive's click in a replica: the click a person makes, posted by a process, with no gesture serial.
        s.click(start, true);
        at.afterPosted = s.scope();
        at.unstarted = s.playMatch(STEPS, { plays: plays['1']! });
        // A person's click.
        s.click(start);
        at.pressed = s.scope();
        at.played = s.playMatch(STEPS, { plays: plays['1']! });
      },
      others: (s, p) => { played[p] = s.playMatch(STEPS, { plays: plays[String(p)]! }); },
    });
    expect(room.outcome, `the eight-seat piece with players {min: 2, max: 8} is presented: ${room.why}`).toBe('presented');
    expect(room.start, `with two copies joined the app shows the first player a Start (scope's state.start): ${room.why}`).not.toBeNull();
    const one = room.first!;
    expect(one.ok, `the first player's run: ${one.why}`).toBe(true);
    const f: string[] = [];
    const lobby = one.replies[at.lobby]!;
    if (lobby['code'] !== undefined || lobby['joined'] !== JOINED || lobby['player'] !== 1) f.push(`the first player's lobby call answers ${show(lobby, 300)}, not player 1 with ${JOINED} copies joined`);
    for (const [i, label] of [[at.shown, 'with three copies joined'], [at.afterTour, 'after a tour\'s entry on the piece\'s own Start control'], [at.afterPosted, 'after deep_drive\'s click in a replica']] as const) {
      const s = startOf(one.replies[i]);
      if (s?.state !== 'open') f.push(`${label}, the app's Start is ${s ? s.state : s === null ? 'not shown' : 'missing from the scope\'s state'}, not open and unpressed`);
    }
    if (one.replies[at.unstarted]!['code'] !== 'not_started') f.push(`play_match with Start unpressed answers ${show(one.replies[at.unstarted], 300)}, not the code not_started: the match isn't unstarted`);
    if (startOf(one.replies[at.pressed])?.state === 'open') f.push('after a person\'s click the app\'s Start is still open');
    expect(f, `${AC[1]} the app's Start before and after a person's click:\n  ${f.join('\n  ')}`).toEqual([]);
    // The match the click started: the three copies play it with the three seats taken at step 0.
    const runs: [Run, number][] = [[one, at.played], ...room.others.map((r, i): [Run, number] => [r, played[i + 2]!])];
    const copies = runs.map(([r, i], k) => { expect(r.ok, `copy ${k + 1}'s run: ${r.why}`).toBe(true); return playedOf(r.replies[i]!, `AC1 the app's copy ${k + 1}`); });
    if (copies.map((c) => c.player).join() !== '1,2,3') f.push(`the copies are players ${copies.map((c) => c.player).join(', ')}, not 1, 2 and 3 in the order they joined`);
    for (const c of copies) {
      if (c.ran !== STEPS) f.push(`copy ${c.player} ran ${c.ran} match steps, not ${STEPS}; its match ended ${String(c.end)} (${show(c.raw['ended'] ?? null, 300)})`);
      const seats = seatsOf(c).filter((s) => s.step < STEPS - 2 * WINDOW);
      if (JSON.stringify(seats) !== JSON.stringify(JOINED_AT_0)) f.push(`copy ${c.player}'s record holds the seat entries ${show(seats, 500)}, not ${show(JOINED_AT_0)}`);
    }
    f.push(...hashesAgree(copies, copies, 'AC1 the app', Math.floor(STEPS / HASH_EVERY) - 2));
    if (framesThrough(room.door).length === 0) f.push('no frame crossed the door: the match went nowhere this file can see');
    expect(f, `${AC[1]} the live match of three app copies:\n  ${f.slice(0, 30).join('\n  ')}`).toEqual([]);
  }, TIMEOUT);

  it(`${AC[1]} in the web player, a synthetic click dispatched in the page leaves Start unpressed and the match unstarted`, async () => {
    const STEPS = 180;
    const door = await relayAndDoor(builds, certs(), closing);
    const piece = roomPiece({ id: DOC.live, net: { relay: door.url, timeout: LIVE_TIMEOUT_S } });
    const out = join(temp(), 'bundle');
    const exported = await exportWeb(builds.show(), temp(), piece, out, 'AC1 the web bundle');
    expect(exported.outcome, `the eight-seat piece with players {min: 2, max: 8} is presented and exported to the web: ${exported.why}`).toBe('presented');
    const tab = await openPlayer(certs(), out, closing, 'AC1 the web player');
    // The page's person clicks Join and is the first player; two copies in the app join through its link.
    const prompt = await tab.prompt();
    expect(prompt?.button, `the web player draws its own Join prompt with a button: ${show(prompt)}`).toBeTruthy();
    await tab.click(prompt!.button!.x + prompt!.button!.w / 2, prompt!.button!.y + prompt!.button!.h / 2);
    const mine = await waitFor(() => tab.match(), (m) => typeof m?.['link'] === 'string');
    expect(typeof mine?.['link'], `after a person's click on Join the web player's match gives the first player's link (probe().match.link): ${show(mine, 400)}`).toBe('string');
    const where = await joinAt(builds.show(), temp(), piece, certs().ca, 'AC1 an app copy');
    expect(where.outcome, `the app presents the piece: ${where.why}`).toBe('presented');
    const plays = roomPlays(JOINED, STEPS);
    const apps: Promise<Run>[] = [];
    const playedAt: number[] = [];
    for (const p of [2, 3]) {
      apps.push(appCopy(builds.show(), temp(), piece, { at: where.at, relayCa: certs().ca, link: String(mine!['link']) }, (s) => { playedAt[p] = s.playMatch(STEPS, { plays: plays[String(p)]! }); }, `AC1 the app's copy ${p}`));
      await waitFor(async () => joinedMatches(door).length, (n) => n >= p);
    }
    expect(joinedMatches(door).length, 'the page and two app copies joined the match at the relay').toBe(JOINED);
    const shown = await waitFor(() => webStart(tab), (s) => s?.state === 'open' && s.button !== null);
    expect(shown, 'with three copies joined the web player shows the first player its own Start, open, with a button (an element marked data-deep-start)').toMatchObject({ state: 'open' });
    expect(shown!.button, 'the web player\'s Start holds a button').not.toBeNull();
    // Synthetic clicks dispatched in the page, every way a script can make one.
    await syntheticStartClicks(tab);
    await sleep(3_000);
    const f: string[] = [];
    const after = await webStart(tab);
    if (after?.state !== 'open') f.push(`after the synthetic clicks the player's Start is ${after ? after.state : 'gone'}, not open and unpressed`);
    const still = await tab.match();
    if (Number(still?.['ran'] ?? 0) !== 0) f.push(`after the synthetic clicks the page's copy has run ${String(still?.['ran'])} match steps`);
    if (framesThrough(door).length) f.push(`${framesThrough(door).length} frames crossed the door with Start unpressed: the match isn't unstarted`);
    expect(f, `${AC[1]} the web player's Start after synthetic clicks:\n  ${f.join('\n  ')}`).toEqual([]);
    // The same button under a person's click starts the match, so the clicks above were refused, not lost.
    await tab.click(shown!.button!.x + shown!.button!.w / 2, shown!.button!.y + shown!.button!.h / 2);
    const runs = await Promise.all(apps);
    runs.forEach((r, i) => {
      expect(r.ok, `the app's copy ${i + 2}: ${r.why}`).toBe(true);
      const c = playedOf(r.replies[playedAt[i + 2]!]!, `AC1 the app's copy ${i + 2}`);
      expect(c.ran, `after a person's click on the web player's Start the app's copy ${c.player} plays its ${STEPS} match steps (ended ${String(c.end)})`).toBe(STEPS);
    });
    expect((await webStart(tab))?.state, 'after a person\'s click the web player\'s Start is no longer open').not.toBe('open');
  }, TIMEOUT);
});
