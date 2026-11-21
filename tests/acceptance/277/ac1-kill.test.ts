// AC1 #277.bbe9c183: In an eight-seat test piece whose net item declares `players: 4` and whose rules play the other
// four seats, and any left seat, with the piece's bot, played by four copies, two in the app and two in headless
// Chrome's web player, from seeded tracks over the test relay, killing copy 3 at match step 900 stamps one `seat {3,
// left}` entry at the same step on the other three copies, which play on for 3,600 steps with equal full-state hashes
// at every hash interval and record the same track; a planted module that stamps the leave at the step each copy
// noticed the close makes the copies part, and the match stops with net.desync naming that step
//
// The piece is fixtures.ts's eight-seat piece (4 players; seats 5 to 8 the bot's; 60 Hz, delay 2, window 8, a hash
// every 60 steps). The live match: the shipped relay behind #549's door on 127.0.0.1, signals dropped so every frame
// crosses the door; copies 1 and 2 in the app (`play_match` of 4,500 steps on their seeded scripts), copies 3 and 4 in
// headless Chrome's web player, each in a browser of its own, whose person presses aim's keys. Once copy 3 has run step
// 900 the test crashes its page (Page.crash), so its process dies with its connection, as a kill's does; the leave's
// step is the step after the highest step copy 3 sent a message for through the door. The planted module is
// `net_leave_at_notice` under `match` in one process, copy 3 killed right after it runs step 900 and copy 1's frames
// held at the relay for 0.5 s just before, so copies 2 and 4 stand at their window when the close comes, with a hash
// at every step. Wrong programs it fails: the merge base (a leave ends the match on every copy); a leave stamped where
// each copy noticed it; a leave stamped before the last message a copy holds; a web copy that ends or parts on a leave;
// a check that names another step than the first that differs.
import { describe, expect, it } from 'vitest';
import { DOC, KILLED, KILL_STEP, LAST_SENT, LEFT_AT, LIVE_TIMEOUT_S, NOTICE_HOLD, PEOPLE, PLAY_ON, RATE, WINDOW, arenaPiece, arenaPlays } from './fixtures.ts';
import {
  AC, FULL, TIMEOUT, appCopy, desyncStep, firstParted, gaveUp, hashedThrough, hashesAgree, lastSentThrough, liveMatch, none, oneSeat, play, pressKeys, seatsOf, show, tracksAgree,
  useBuilds, useCertificate, useChildren, useCleanup, useClosers, useTemp, webCopy, webReaches, webUntil,
} from './helpers.ts';

const builds = useBuilds({ show: [FULL], relay: true });
const certs = useCertificate();
useCleanup();
useChildren();
const closing = useClosers();
const temp = useTemp();
/** Step 900, then the 3,600 the other copies play on for. */
const STEPS = KILL_STEP + PLAY_ON;

describe(`${AC[1]} a killed copy's seat passes to the piece's bot at one step every copy agrees on`, () => {
  it(`${AC[1]} two copies in the app and two in headless Chrome's web player: killing copy 3 at step 900 stamps one seat {3, left} at the same step on the other three, which play on for 3,600 steps with equal full-state hashes and the same track`, async () => {
    const plays = arenaPlays(PEOPLE, STEPS);
    const live = await liveMatch({
      builds, certs, temp, closing, piece: (relay) => arenaPiece({ id: DOC.arenaLive, net: { relay, timeout: LIVE_TIMEOUT_S } }),
      apps: 2, webs: 2, steps: STEPS, plays, what: 'AC1',
    });
    const tab3 = live.tabs.get(3)!;
    const tab4 = live.tabs.get(4)!;
    let killed = false;
    let done = false;
    const presses = [pressKeys(tab3, 2773, () => !killed), pressKeys(tab4, 2774, () => !done)];
    const at = await webReaches(tab3, KILL_STEP, 'AC1 web copy 3');
    killed = true;
    await tab3.send('Page.crash', {}, 5_000).catch(() => undefined);
    const f: string[] = [];
    if (at['player'] !== KILLED) f.push(`the first web copy is player ${String(at['player'])}, not ${KILLED}: the app's copies join first`);
    const lastSent = lastSentThrough(live.door, KILLED, 'AC1');
    if (lastSent > LAST_SENT + RATE) gaveUp(`AC1: copy 3 sent messages through step ${lastSent} before its page crashed, more than a second past step ${LAST_SENT}`);
    const apps = await Promise.all(live.apps.map((c, i) => appCopy(c, `AC1 the app's copy ${i + 1}`)));
    const w4m = await webUntil(tab4, STEPS, 'AC1 web copy 4');
    done = true;
    await Promise.all(presses);
    const three = [...apps, webCopy(w4m, 'AC1 web copy 4')];
    expect(three.map((c) => c.player), 'AC1: the app\'s copies are players 1 and 2, the second web copy player 4').toEqual([1, 2, 4]);
    for (const c of apps) if (c.ran !== STEPS) f.push(`the app's copy ${c.player} ran ${c.ran} match steps, not ${STEPS}; its match ended ${String(c.end)} (${show(c.raw['ended'] ?? null, 300)})`);
    if (three[2]!.ran < STEPS) f.push(`web copy 4 ran ${three[2]!.ran} match steps, not ${STEPS}; its match ended ${String(three[2]!.end)} (${show(three[2]!.raw['ended'] ?? null, 300)})`);
    const left = oneSeat(three, KILLED, 'left', 'the other three copies');
    f.push(...left.failures);
    if (left.at !== null && left.at !== lastSent + 1) f.push(`the copies stamp seat {3, left} at step ${left.at}, not ${lastSent + 1}, the step after the highest step copy 3 sent a message for`);
    for (const c of three) {
      const other = seatsOf(c).filter((s) => s.step < STEPS - 2 * WINDOW && !(s.player === KILLED && s.state === 'left'));
      if (other.length) f.push(`copy ${c.player}'s record holds seat entries no seat change made: ${show(other, 400)}`);
    }
    const confirmed = Math.min(...three.map((c) => c.record?.confirmed ?? -1));
    if (confirmed < STEPS - 3 * WINDOW) f.push(`the three copies confirmed only through step ${confirmed} of ${STEPS}`);
    f.push(...hashesAgree(three, 'the other three copies', Math.floor(STEPS / 60) - 2));
    for (const c of three) { const gap = hashedThrough(c, 0, STEPS - 120); if (gap !== null) f.push(`copy ${c.player} reports no full-state hash for the interval at step ${gap}`); }
    f.push(...tracksAgree(three, confirmed + 1, 'the other three copies\' records'));
    none(f, `${AC[1]} the live match after copy 3 was killed at step 900`);
  }, TIMEOUT);

  it(`${AC[1]} a planted module that stamps the leave at the step each copy noticed the close makes the copies part, and the match stops with net.desync naming that step`, async () => {
    const steps = 1_500;
    const ask = {
      piece: arenaPiece({ id: DOC.arenaEvery, net: { hash_every: 1 } }), steps, plays: arenaPlays(PEOPLE, steps),
      kill: [{ player: KILLED, step: KILL_STEP }], relay: { seed: 277, hold: [NOTICE_HOLD] },
    };
    // The honest module under the same schedule: one leave at the agreed step, and the copies agree at every step.
    const honest = await play(builds.show(), temp(), 'AC1 in one process', ask);
    const survivors = honest.copies.filter((c) => c.player !== KILLED);
    const left = oneSeat(survivors, KILLED, 'left', 'the honest copies');
    const f = [...left.failures];
    if (left.at !== null && left.at !== LEFT_AT) f.push(`the honest copies stamp seat {3, left} at step ${left.at}, not ${LEFT_AT}, the step after copy 3's last message`);
    for (const c of survivors) if (c.ran !== steps || c.end !== null) f.push(`honest copy ${c.player} ran ${c.ran} of ${steps} steps and its match ended ${String(c.end)}`);
    f.push(...hashesAgree(survivors, 'the honest copies', steps - 3 * WINDOW, 1));
    none(f, `${AC[1]} the honest copies under the planted run's schedule`);
    const twin = await play(builds.show(), temp(), 'AC1 in one process', { ...ask, planted: 'net_leave_at_notice' });
    const copies = twin.copies.filter((c) => c.player !== KILLED);
    const parted = firstParted(copies);
    expect(parted, `under the planted module the copies part: ${show(copies.map((c) => ({ player: c.player, end: c.end, seats: seatsOf(c) })), 800)}`).not.toBeNull();
    expect(copies.some((c) => seatsOf(c).some((s) => s.player === KILLED && s.state === 'left' && s.step === parted)), `a planted copy stamps its leave at step ${parted}, where the copies part: ${show(copies.map((c) => ({ player: c.player, seats: seatsOf(c) })), 800)}`).toBe(true);
    for (const c of copies) {
      expect(c.end, `planted copy ${c.player}'s match stops with net.desync: ${show(c.raw['desync'] ?? null, 400)}`).toBe('desync');
      expect(desyncStep(c), `planted copy ${c.player}'s net.desync names step ${parted}, the first that differs: ${show(c.raw['desync'] ?? null, 400)}`).toBe(parted);
    }
  }, TIMEOUT);
});
