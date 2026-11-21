// AC3 #277.a4a81099: A copy hidden for 20 s at step 1,200, four times the 5 s timeout, sends `absent` first: the other
// copies wait no longer than the window at that step, play on, and the match doesn't end; on return it catches up
// headless, sends `back`, and every copy reaches equal full-state hashes at the next hash interval; a planted catch-up
// that applies the missed messages in arrival order parts from the others and fails net.desync, naming the first step
// that differs; and a copy frozen without `absent` is `left` after the timeout, as the killed copy is
//
// The eight-seat piece in one process over the test relay (`match`), copy 4 hidden right after it runs step 1,200 for
// 20 s on the relay's clock (`hide`), with net@1's timeout of 5 s. Its `absent` rides on its next unsent step's
// message, 1,203. Every player sets `aim` at the same steps, so most steps hold several players' entries; the test
// relay answers a catch-up highest player first (README: the test relay), so arrival order is never player order. The
// planted catch-up is `net_catch_up_in_arrival_order`, with a hash at every step so the first step that differs is
// read from the copies' hashes. The frozen copy is copy 4 stopped right after step 1,200 with its connection open
// (`freeze`). Wrong programs it fails: the merge base (a hidden copy stalls the others until the timeout ends the
// match); a hidden copy that sends nothing first and is made `left`; a return that jumps ahead or replays out of
// order; a frozen copy that ends the match, or that is never handed to the bot.
import { describe, expect, it } from 'vitest';
import { ABSENT_AT, DOC, HASH_EVERY, HIDDEN, HIDE_S, HIDE_STEP, PEOPLE, RATE, TIMEOUT_S, WINDOW, arenaPiece, arenaPlays } from './fixtures.ts';
import {
  AC, FULL, TIMEOUT, catchUpsOf, desyncStep, firstParted, hashedThrough, hashesAgree, none, oneSeat, play, seatsOf, show, useBuilds, useChildren, useTemp, waitsFor,
} from './helpers.ts';

const builds = useBuilds({ show: [FULL] });
useChildren();
const temp = useTemp();
const STEPS = 3_000;
const hidden = { plays: arenaPlays(PEOPLE, STEPS), hide: [{ player: HIDDEN, step: HIDE_STEP, for: HIDE_S }], relay: { seed: 277 } };

describe(`${AC[3]} a hidden copy says it is absent, nobody waits on it, and it catches up on its return`, () => {
  it(`${AC[3]} a copy hidden for 20 s at step 1,200 sends absent first; the others wait no longer than the window and play on; on return it catches up headless, sends back, and every copy's hashes agree at the next hash interval`, async () => {
    const r = await play(builds.show(), temp(), 'AC3 hidden', { piece: arenaPiece(), steps: STEPS, ...hidden });
    const f: string[] = [];
    const absent = oneSeat(r.copies, HIDDEN, 'absent', 'every copy');
    f.push(...absent.failures);
    if (absent.at !== null && absent.at !== ABSENT_AT) f.push(`the copies stamp seat {4, absent} at step ${absent.at}, not ${ABSENT_AT}, copy 4's next unsent step when it was hidden`);
    for (const c of r.copies) {
      const gone = seatsOf(c).filter((s) => s.player === HIDDEN && s.state === 'left');
      if (gone.length) f.push(`copy ${c.player} holds seat {4, left}: a copy that said absent first was made to leave: ${show(gone)}`);
      if (c.ran !== STEPS || c.end !== null) f.push(`copy ${c.player} ran ${c.ran} of ${STEPS} steps and its match ended ${String(c.end)} (${show(c.raw['ended'] ?? null, 300)})`);
    }
    // The other copies wait no longer than the window: 8 match steps, 0.133 s.
    for (const c of r.copies.filter((x) => x.player !== HIDDEN)) {
      const long = waitsFor(c, HIDDEN).filter((w) => w.seconds > WINDOW / RATE + 1e-9);
      if (long.length) f.push(`copy ${c.player} waited for copy 4 longer than the window (${(WINDOW / RATE).toFixed(3)} s): ${show(long)}`);
    }
    const back = oneSeat(r.copies, HIDDEN, 'back', 'every copy');
    f.push(...back.failures);
    if (back.at !== null && back.at < HIDE_STEP + HIDE_S * RATE) f.push(`the copies stamp seat {4, back} at step ${back.at}, before copy 4's 20 s away had passed (step ${HIDE_STEP + HIDE_S * RATE})`);
    const four = r.copies[HIDDEN - 1]!;
    const ups = catchUpsOf(four, 'copy 4');
    if (ups.length !== 1) f.push(`copy 4 reports ${ups.length} catch-ups, not one: ${show(ups.map((u) => u.raw))}`);
    const up = ups[0];
    if (up && up.from !== HIDE_STEP + 1) f.push(`copy 4's catch-up starts at step ${up.from}, not ${HIDE_STEP + 1}, the first step it hadn't run`);
    if (up && up.to < HIDE_STEP + HIDE_S * RATE) f.push(`copy 4's catch-up runs to step ${up.to} only, short of the ${HIDE_S * RATE} steps it owed`);
    if (up && up.steps !== up.to - up.from + 1) f.push(`copy 4's catch-up counts ${up.steps} steps from ${up.from} to ${up.to}`);
    // It ran every step it missed: a hash at every interval, equal to every other copy's, and at the next interval
    // after its back, every copy's.
    f.push(...hashesAgree(r.copies, 'the four copies', Math.floor(STEPS / HASH_EVERY) - 2));
    const gap = hashedThrough(four, 0, STEPS - 2 * HASH_EVERY);
    if (gap !== null) f.push(`copy 4 reports no full-state hash for the interval at step ${gap}`);
    if (back.at !== null) {
      const next = Math.ceil((back.at + 1) / HASH_EVERY) * HASH_EVERY;
      for (const c of r.copies) if (!c.hashes.some((h) => h.step === next)) f.push(`copy ${c.player} reports no full-state hash at step ${next}, the next hash interval after the back`);
    }
    none(f, `${AC[3]} copy 4 hidden for 20 s at step 1,200`);
  }, TIMEOUT);

  it(`${AC[3]} a planted catch-up that applies the missed messages in arrival order parts from the others and fails net.desync, naming the first step that differs`, async () => {
    const r = await play(builds.show(), temp(), 'AC3 hidden', { piece: arenaPiece({ id: DOC.arenaEvery, net: { hash_every: 1 } }), steps: STEPS, ...hidden, planted: 'net_catch_up_in_arrival_order' });
    const others = r.copies.filter((c) => c.player !== HIDDEN);
    expect(firstParted(others), 'the copies that weren\'t hidden agree among themselves').toBeNull();
    const parted = firstParted(r.copies);
    expect(parted, `under the planted catch-up copy 4 parts from the others: ${show(r.copies.map((c) => ({ player: c.player, end: c.end, hashes: c.hashes.length })), 600)}`).not.toBeNull();
    expect(parted!, 'they part only in what copy 4 caught up').toBeGreaterThanOrEqual(ABSENT_AT);
    for (const c of r.copies) {
      expect(c.end, `copy ${c.player}'s match stops with net.desync: ${show(c.raw['desync'] ?? null, 400)}`).toBe('desync');
      expect(desyncStep(c), `copy ${c.player}'s net.desync names step ${parted}, the first that differs: ${show(c.raw['desync'] ?? null, 400)}`).toBe(parted);
    }
  }, TIMEOUT);

  it(`${AC[3]} a copy frozen without absent is left after the timeout, as the killed copy is`, async () => {
    const steps = 2_400;
    const r = await play(builds.show(), temp(), 'AC3 frozen', { piece: arenaPiece(), steps, plays: arenaPlays(PEOPLE, steps), freeze: [{ player: HIDDEN, step: HIDE_STEP }], relay: { seed: 277 } });
    const others = r.copies.filter((c) => c.player !== HIDDEN);
    const left = oneSeat(others, HIDDEN, 'left', 'copies 1 to 3');
    const f = [...left.failures];
    if (left.at !== null && left.at !== ABSENT_AT) f.push(`the copies stamp seat {4, left} at step ${left.at}, not ${ABSENT_AT}, the step after copy 4's last message`);
    for (const c of others) {
      const absent = seatsOf(c).filter((s) => s.player === HIDDEN && s.state === 'absent');
      if (absent.length) f.push(`copy ${c.player} holds seat {4, absent} for a copy that never said so: ${show(absent)}`);
      if (c.ran !== steps || c.end !== null) f.push(`copy ${c.player} ran ${c.ran} of ${steps} steps and its match ended ${String(c.end)} (${show(c.raw['ended'] ?? null, 300)})`);
      // Left only after the timeout: until then it waited at the window, as today.
      const longest = Math.max(0, ...waitsFor(c, HIDDEN).map((w) => w.seconds));
      if (longest < TIMEOUT_S - 0.25 || !Number.isFinite(longest)) f.push(`copy ${c.player}'s longest wait for copy 4 is ${longest} s: the leave came without the ${TIMEOUT_S} s timeout, or never ended a wait`);
    }
    f.push(...hashesAgree(others, 'copies 1 to 3', Math.floor(steps / HASH_EVERY) - 2));
    none(f, `${AC[3]} copy 4 frozen at step 1,200 without absent`);
  }, TIMEOUT);
});
