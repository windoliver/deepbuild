// AC7 #551.9ce1e5fd: In the two-player piece, with logic checkpoints every 60 steps, player 2's entry stamped at step
// 598 arriving after the copy has run step 601 replaces the checkpoint logic took at step 600; after the match, a seek
// in that copy to step 610 gives the full-state hash a straight replay of its record has there; a planted rollback
// that keeps the replaced checkpoint fails that seek, naming checkpoint 600
//
// The paddle piece (logic checkpoints every 60 steps, fixtures.ts) over the test relay: player 2 moves its paddle at
// step 596 (stamped 598) and makes no other entry from 586 to 612, and `deliver` holds every frame of player 2's
// carrying its message for step 598 from copy 1 until copy 1 has run step 601. After the match, `match`'s `seek` asks
// copy 1 for step 610: the seek restores each module's nearest checkpoint at or before it on its own ring (`from`) and
// steps on. The straight replay is `replay` of copy 1's record from step 0, a full-state hash at every step. The
// planted rollback is `net_keeps_replaced_checkpoint`. Wrong programs it fails: the merge base; a rollback that keeps
// the checkpoint its replaced steps took; a seek that steps from the start and so never reads the ring.
import { describe, it } from 'vitest';
import { DOC, EVERY_STEP, lastValue, paddleDoc, rally, rulesProgram, withOnly, type JsonValue, type Planted } from './fixtures.ts';
import { AC, FULL, TIMEOUT, failsNaming, hashesOf, none, num, play, replayCall, rollbacksOf, show, useBuilds, useChildren, useTemp, world } from './helpers.ts';
import { Script, putEvidence, runShow } from '../549/helpers.ts';

const builds = useBuilds({ show: [FULL] });
useChildren();
const temp = useTemp();
const STEPS = 700;
const LATE = 598;
const RAN = 601;
const CHECKPOINT = 600;
const SEEK = 610;
const base = rally(2, STEPS);
const moved = lastValue(base, 2, 'paddle2', 586) === 2.5 ? -2.5 : 2.5;
const plays = withOnly(base, 2, 586, 612, [{ step: LATE - 2, control: 'paddle2', value: moved }]);
const document = paddleDoc({ hash_every: EVERY_STEP });

/** The match with the late entry, the seek after it in copy 1, and the straight replay of copy 1's record; the
 * criterion's judge on them. Each failure names the checkpoint the seek restored. */
async function seekAndReplay(what: string, planted?: Planted): Promise<{ failures: string[]; rolledToLate: boolean }> {
  const held = await play(builds.show(), temp(), `${what}: the late entry`, {
    document, steps: STEPS, plays, relay: { seed: 551, deliver: [{ player: 2, step: LATE, to: 1, at: RAN }] }, seek: [{ player: 1, step: SEEK }], ...(planted ? { planted } : {}),
  });
  const one = held.copies[0]!;
  const rolledToLate = rollbacksOf(one, what).some((r) => r.to === LATE && r.from >= RAN);
  const seek = held.seeks.find((x) => x['player'] === 1 && x['step'] === SEEK);
  if (!seek) return { failures: [`${what}: no seek of copy 1 to step ${SEEK} in the reply's seeks: ${show(held.seeks)}`], rolledToLate };
  const evidence = temp();
  putEvidence(evidence, rulesProgram().bytes);
  const s = new Script();
  s.present(DOC.paddle, document);
  const k = s.add(replayCall(DOC.paddle, (one.record?.raw['track'] ?? []) as JsonValue[], SEEK + 1, EVERY_STEP));
  const straight = hashesOf((await runShow(builds.show(), world(evidence, [DOC.paddle], s.calls), `${what}: the straight replay`))[k], `${what}: the straight replay of copy 1's record`).get(SEEK);
  const from = num(seek['from'], `${what}: the seek's from (the checkpoint it restored)`);
  const f: string[] = [];
  if (from !== CHECKPOINT) f.push(`${what}: the seek to step ${SEEK} restored checkpoint ${from}, not ${CHECKPOINT}, the nearest at or before it`);
  if (seek['hash'] !== straight) f.push(`${what}: the seek to step ${SEEK} from checkpoint ${from} gives ${String(seek['hash'])}, where a straight replay of the record gives ${String(straight)}`);
  return { failures: f, rolledToLate };
}

describe(`${AC[7]} a late entry replaces logic's checkpoint at step 600`, () => {
  it(`${AC[7]} player 2's entry stamped at step 598, arriving after step 601, replaces the checkpoint at 600, and a seek to step 610 after the match gives a straight replay's hash`, async () => {
    const { failures, rolledToLate } = await seekAndReplay('AC7');
    none([...(rolledToLate ? [] : [`AC7: copy 1 didn't roll back to step ${LATE} once it had run step ${RAN}`]), ...failures], 'the seek after the match');
  }, TIMEOUT);

  it(`${AC[7]} a planted rollback that keeps the replaced checkpoint fails that seek, naming checkpoint 600`, async () => {
    const { failures } = await seekAndReplay('AC7 planted', 'net_keeps_replaced_checkpoint');
    failsNaming(failures, [new RegExp(`from checkpoint ${CHECKPOINT} gives`)], 'the rollback that keeps the replaced checkpoint');
  }, TIMEOUT);
});
