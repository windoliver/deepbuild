// AC12 #184.af2d1b3a: "A test check plug-in whose input gives seed 7 plays the clean maze through deep.canvas.play with
// seed 7, and run i with hash(7, i); a call with seed 8, which its input doesn't give, is refused, naming the seed; and a
// planted host that plays any seed a runner passes accepts seed 8 and fails, naming the plug-in"
//
// The maze player's input gives seed 7 and 3 runs. It plays the clean maze (60 steps) with seed 7, then with hash(7, i)
// for runs 0 to 2, then with seed 8. The seed rule's judge reads what it got and what the replica played: on the hub
// every play but seed 8's goes through with its seed and seed 8's is refused naming it, so the judge finds nothing; on a
// host planted `plays-any-seed` seed 8 is played, and the judge fails, naming the plug-in.
import { describe, expect, it } from 'vitest';
import { AC, DOC, PLAYER_ID, Pool, TIMEOUT, driveBin, macOnly, none, openHub, putPiece, runPlayer, runSeed, type Hub, type Played, type Seen } from './helpers.ts';
import { mazePiece, mazeProgram } from './programs.ts';

const SEEDS = [7, runSeed(7, 0), runSeed(7, 1), runSeed(7, 2)];

/** The seed rule over one run of the maze player: the given seeds played as given, seed 8 refused naming it and never played. */
function seedFailures(seen: Seen[], log: Played[], plugin: string): string[] {
  const failures: string[] = [];
  SEEDS.forEach((seed, n) => {
    if (seen[n]?.reply['error'] !== undefined) failures.push(`the host refused seed ${seed}, which ${plugin}'s input gives: ${String(seen[n]?.reply['error'])}`);
    if (!log.some((p) => p.call['seed'] === seed)) failures.push(`no replica played seed ${seed} for ${plugin}`);
  });
  const eight = seen[SEEDS.length]?.reply['error'];
  if (eight === undefined || log.some((p) => p.call['seed'] === 8)) failures.push(`the host played seed 8 for ${plugin}, a seed its input doesn't give`);
  else if (!/\bseed\b/i.test(String(eight)) || !/\b8\b/.test(String(eight))) failures.push(`the refusal of ${plugin}'s seed 8 doesn't name the seed: ${String(eight)}`);
  return failures;
}

describe(`${AC[12]} deep.canvas.play plays only the seeds a check's input gives`, () => {
  it(`${AC[12]} seed 7 and hash(7, i) are played, seed 8 refused naming it; a host planted plays-any-seed plays 8 and fails, naming the plug-in`, async () => {
    macOnly();
    const piece = putPiece(DOC.clean, mazePiece(mazeProgram('clean')));
    const input = { piece, seed: 7, runs: 3, span: { steps: 60 } };
    const plays = [...SEEDS, 8].map((seed) => ({ piece, run: { seed, span: { steps: 60 }, values: ['maze.cell'], frames: [] } }));
    const once = async (hub: Hub, pool: Pool): Promise<string[]> => {
      const from = pool.log.length;
      const { seen } = await runPlayer(hub, input, { plays, testsRun: 3, evidence: 'tracks' });
      return seedFailures(seen, pool.log.slice(from), PLAYER_ID);
    };

    const pool = await Pool.open([{ bin: driveBin('debug') }]);
    none(await once(await openHub({ pool, playtest: 'none', player: { docs: [DOC.clean] } }), pool), 'the seed rule on the hub');

    const failures = await once(await openHub({ pool, playtest: 'none', player: { docs: [DOC.clean] }, plant: 'plays-any-seed' }), pool);
    expect(failures.some((f) => f.startsWith('the host played seed 8') && f.includes(PLAYER_ID)),`on the planted host the seed rule fails, naming ${PLAYER_ID}: ${failures.join('; ')}`).toBe(true);
  }, TIMEOUT);
});
