// AC2 #277.4413887e: With the test relay holding copy 3's last 4 messages back from copy 2 alone when copy 3 is
// killed, copy 2 gets them from the others before the `left` entry, which every copy stamps after the last of them; a
// planted module that skips the exchange stamps it 4 steps earlier on copy 2 and fails net.desync, naming the step
//
// The eight-seat piece in one process over the test relay (`match`), copy 3 killed right after it runs step 900 (its
// last message is for step 902) and `relay.withhold` keeping from copy 2 every frame that carries one of copy 3's last
// 4 messages (steps 899 to 902). Copy 3's script sets `aim` at every step from 880 to 900, so each of those messages
// holds an entry. The honest copies: one `seat {3, left}` entry at step 903 on copies 1, 2 and 4, after the last of
// them; copy 2's record holds copy 3's entries at steps 899 to 902 as copy 1's does; the relay's log shows those frames
// never reached copy 2; the copies play on with equal hashes. The planted module is `net_skips_last_exchange`. Wrong
// programs it fails: the merge base (a leave ends the match); a leave stamped at the highest step each copy itself
// holds; a copy that stamps the leave before it holds what the others hold; a check that names another step.
import { describe, expect, it } from 'vitest';
import { HELD_FROM, HELD_LAST, KILLED, KILL_STEP, LAST_SENT, LEFT_AT, PEOPLE, STEP, arenaPiece, arenaPlays } from './fixtures.ts';
import { AC, FULL, TIMEOUT, desyncStep, hashesAgree, isObject, none, num, oneSeat, play, seatsOf, show, trackLines, useBuilds, useChildren, useTemp } from './helpers.ts';

const builds = useBuilds({ show: [FULL] });
useChildren();
const temp = useTemp();
const STEPS = 1_500;
/** Copy 3's last 4 messages: steps 899, 900, 901 and 902. */
const HELD = Array.from({ length: HELD_LAST }, (_, i) => LAST_SENT - HELD_LAST + 1 + i);
const ask = {
  piece: arenaPiece(), steps: STEPS, plays: arenaPlays(PEOPLE, STEPS, { dense: { player: KILLED, from: KILL_STEP - 20, to: KILL_STEP } }),
  kill: [{ player: KILLED, step: KILL_STEP }], relay: { seed: 277, log: true, withhold: [{ player: KILLED, to: HELD_FROM, last: HELD_LAST }] },
};

describe(`${AC[2]} a leaver's last messages reach every copy before the leave`, () => {
  it(`${AC[2]} with copy 3's last 4 messages held back from copy 2, copy 2 gets them from the others and every copy stamps the leave after the last of them`, async () => {
    const r = await play(builds.show(), temp(), 'AC2', ask);
    const survivors = r.copies.filter((c) => c.player !== KILLED);
    const left = oneSeat(survivors, KILLED, 'left', 'copies 1, 2 and 4');
    const f = [...left.failures];
    if (left.at !== null && left.at !== LEFT_AT) f.push(`the copies stamp seat {3, left} at step ${left.at}, not ${LEFT_AT}, the step after copy 3's last message (${LAST_SENT})`);
    // The relay kept those frames from copy 2: each frame of copy 3's to copy 2 that carries one of them was never delivered.
    const log = Array.isArray(r.relay['log']) ? r.relay['log'] : [];
    const carrying = log.filter(isObject).filter((row) => {
      const [p, to, first, count] = [num(row['player'], 'relay.log[].player'), num(row['to'], 'relay.log[].to'), num(row['first'], 'relay.log[].first'), num(row['count'], 'relay.log[].count')];
      return p === KILLED && to === HELD_FROM && HELD.some((k) => k >= first && k < first + count);
    });
    if (carrying.length === 0) f.push(`the relay's log holds no frame of copy 3's to copy 2 carrying steps ${HELD.join(', ')}: ${show(log.slice(-6), 600)}`);
    const reached = carrying.filter((row) => row['delivered'] !== null);
    if (reached.length) f.push(`the relay delivered to copy 2 frames of copy 3's carrying its last 4 messages: ${show(reached, 400)}`);
    // Copy 2 holds copy 3's entries at those steps all the same, as copy 1 does.
    const of3 = (c: (typeof survivors)[number]): string[] => trackLines(c, LAST_SENT + 1).filter((l) => / p3 /.test(l) && HELD.includes(Number(l.split(' ')[0])));
    const [one, two] = [of3(survivors[0]!), of3(survivors[1]!)];
    if (one.length !== HELD_LAST) f.push(`copy 1's record holds ${one.length} of copy 3's entries at steps ${HELD.join(', ')}, not ${HELD_LAST}: ${show(one)}`);
    if (JSON.stringify(two) !== JSON.stringify(one)) f.push(`copy 2's record holds ${show(two)} of copy 3's entries at steps ${HELD.join(', ')}, where copy 1's holds ${show(one)}`);
    for (const c of survivors) if (c.ran !== STEPS || c.end !== null) f.push(`copy ${c.player} ran ${c.ran} of ${STEPS} steps and its match ended ${String(c.end)} (${show(c.raw['ended'] ?? null, 300)})`);
    f.push(...hashesAgree(survivors, 'copies 1, 2 and 4', Math.floor(STEPS / 60) - 2));
    none(f, `${AC[2]} copy 2 under the held-back messages`);
  }, TIMEOUT);

  it(`${AC[2]} a planted module that skips the exchange stamps the leave 4 steps earlier on copy 2 and fails net.desync, naming the step`, async () => {
    const r = await play(builds.show(), temp(), 'AC2', { ...ask, planted: 'net_skips_last_exchange' });
    const survivors = r.copies.filter((c) => c.player !== KILLED);
    const early = LEFT_AT - HELD_LAST;
    const leftOf = (c: (typeof survivors)[number]): number[] => seatsOf(c, STEP).filter((s) => s.player === KILLED && s.state === 'left').map((s) => s.step);
    expect(leftOf(survivors[1]!), `the planted copy 2 stamps seat {3, left} at step ${early}, 4 steps before ${LEFT_AT}: its seat entries ${show(seatsOf(survivors[1]!))}`).toEqual([early]);
    for (const c of [survivors[0]!, survivors[2]!]) expect(leftOf(c), `copy ${c.player} still stamps seat {3, left} at step ${LEFT_AT}`).toEqual([LEFT_AT]);
    for (const c of survivors) {
      expect(c.end, `copy ${c.player}'s match stops with net.desync: ${show(c.raw['desync'] ?? null, 400)}`).toBe('desync');
      expect(desyncStep(c), `copy ${c.player}'s net.desync names step ${early}: ${show(c.raw['desync'] ?? null, 400)}`).toBe(early);
    }
  }, TIMEOUT);
});
