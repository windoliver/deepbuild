// AC6 #277.402a14da: In an 8-seat strategy fixture at 30 Hz, killing copy 3 at step 27,000 stamps one `seat {3,
// left}`; its units pass to the piece's bot, or to player 4 by a `take` entry; and the other copies play 9,000 more
// steps with equal full-state hashes
//
// The strategy fixture (fixtures.ts): 8 players, 30 Hz, lockstep (window 0, the design's mode for a strategy game),
// delay 4, a hash every 60 steps, two units a seat and the `take` control, played by its 8 copies in one process over
// the test relay (`match`) for 36,000 steps, copy 3 killed right after it runs step 27,000 (its last message is for
// 27,004). Both ways the criterion names happen in one match: from the leave, seat 3's units are the bot's (`owner` 0);
// player 4's `take` of seat 3, made at step 27,300 and stamped at 27,304, passes them to player 4, an ally (seats 1 to
// 4 are one team) whose own seat is still played, which the rules validate. Read from two copies' rows (#540's: each
// step's arrays). Wrong programs it fails: the merge base (a leave ends the match); a leave not at the step after the
// last message; a seat whose units nobody plays after the leave; copies that part on the take or the leave.
import { describe, it } from 'vitest';
import { KILLED, LOGIC, S_KILL_STEP, S_LEFT_AT, S_MORE, S_STEP, S_TAKER, S_TAKE_AT, STATE, strategyPiece, strategyPlays } from './fixtures.ts';
import { AC, FULL, TIMEOUT, element, hashedThrough, hashesAgree, none, oneSeat, play, rowsOf, show, useBuilds, useChildren, useTemp } from './helpers.ts';

const builds = useBuilds({ show: [FULL] });
useChildren();
const temp = useTemp();
const STEPS = S_KILL_STEP + S_MORE;

describe(`${AC[6]} a dropped seat in a long strategy match passes to the bot, or to an ally by a take entry`, () => {
  it(`${AC[6]} killing copy 3 at step 27,000 stamps one seat {3, left}; its units pass to the bot, then to player 4 by a take entry; the other copies play 9,000 more steps with equal full-state hashes`, async () => {
    const r = await play(builds.show(), temp(), 'AC6', { piece: strategyPiece(), steps: STEPS, plays: strategyPlays(STEPS), kill: [{ player: KILLED, step: S_KILL_STEP }], relay: { seed: 277 } });
    const others = r.copies.filter((c) => c.player !== KILLED);
    const left = oneSeat(others, KILLED, 'left', 'the other seven copies', { step: S_STEP });
    const f = [...left.failures];
    if (left.at !== null && left.at !== S_LEFT_AT) f.push(`the copies stamp seat {3, left} at step ${left.at}, not ${S_LEFT_AT}, the step after copy 3's last message`);
    for (const c of others) if (c.ran !== STEPS || c.end !== null) f.push(`copy ${c.player} ran ${c.ran} of ${STEPS} steps and its match ended ${String(c.end)} (${show(c.raw['ended'] ?? null, 300)})`);
    // Seat 3's units: player 3's until the leave, the bot's (0) from it, player 4's from the take.
    for (const c of [others[0]!, others.find((x) => x.player === S_TAKER)!]) {
      const rows = rowsOf(c.raw['steps'], `AC6 copy ${c.player}`);
      const owner = (k: number): number => element(rows, k, `${LOGIC}.owner`, KILLED - 1, `AC6 copy ${c.player}`);
      const gone = (k: number): number => element(rows, k, `${LOGIC}.gone`, KILLED - 1, `AC6 copy ${c.player}`);
      if (owner(S_LEFT_AT - 1) !== KILLED) f.push(`copy ${c.player}: before the leave seat 3's units are ${owner(S_LEFT_AT - 1)}'s, not player 3's`);
      const notBot = Array.from({ length: S_TAKE_AT - S_LEFT_AT }, (_, i) => S_LEFT_AT + i).find((k) => owner(k) !== 0 || gone(k) !== STATE.left);
      if (notBot !== undefined) f.push(`copy ${c.player}: at step ${notBot}, after the leave and before the take, seat 3's units are ${owner(notBot)}'s (gone ${gone(notBot)}), not the bot's (0) for a seat whose player left`);
      const notTaker = Array.from({ length: STEPS - S_TAKE_AT }, (_, i) => S_TAKE_AT + i).find((k) => owner(k) !== S_TAKER);
      if (notTaker !== undefined) f.push(`copy ${c.player}: at step ${notTaker}, after player 4's take, seat 3's units are ${owner(notTaker)}'s, not player 4's`);
    }
    f.push(...hashesAgree(others, 'the other seven copies', Math.floor(STEPS / 60) - 2));
    for (const c of others) { const gap = hashedThrough(c, S_KILL_STEP, STEPS - 120); if (gap !== null) f.push(`copy ${c.player} reports no full-state hash for the interval at step ${gap}`); }
    none(f, `${AC[6]} the strategy match after copy 3 was killed at step 27,000`);
  }, TIMEOUT);
});
