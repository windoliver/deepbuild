// AC8 #2777.a05e43e4: "The lane runs in the local preflight in under 5 s and reads no network"
//
// asserts: structure first, on any machine: a lane of the local preflight (scripts/lanes.mjs `checks`, which
// scripts/checks.mjs runs) lists a command running `scripts/canvas-closures.mjs fields`; with the full `deep-show` built
// in the checkout's target folder, each such command, run from the checkout as listed, exits 0 with a PASS fields line
// and its one NOTE fields reading. It reads no network: inside a Seatbelt profile that denies every network operation
// (a control shows a child inside it can't reach a listener on 127.0.0.1 that a child outside reaches), the same
// commands pass with the same PASS and NOTE lines. Then, on a reference Mac fit to judge (#412's gate: Mac15,7 or
// Mac15,12, Low Power Mode off, thermal state nominal, a 1-minute load at most the core count; mains power never
// gates), five runs after a warm-up, each the wall time of the lane's commands, judged against 5 s by #412's judge.
// Elsewhere, or between the limit and the margin, the timing skips as INCONCLUSIVE after the checks above; it never
// passes by skipping. Without /usr/bin/sandbox-exec (not macOS), the no-network leg skips as INCONCLUSIVE likewise.

import { describe, expect, it } from 'vitest';
import {
  FULL, LANE, LANE_BUDGET_S, environmentProblem, judgeRuns, laneCommands, linesStarting, passes, readingOf, runCommand, sandboxProblem, settle, useBuilds,
  type ScriptRun,
} from './helpers.ts';

// The last build listed is the one the checkout's target folder holds when the lane runs.
const builds = useBuilds([FULL]);

describe('AC8 #2777.a05e43e4 the lane in the local preflight', () => {
  it('AC8 #2777.a05e43e4 the lane runs in the local preflight in under 5 s and reads no network', async (ctx) => {
    builds.bin(FULL);
    const commands = await laneCommands();
    expect(commands.map((c) => `${c.lane}: ${c.command.join(' ')}`), 'a lane of the local preflight (scripts/lanes.mjs checks) runs scripts/canvas-closures.mjs fields').not.toEqual([]);
    const runAll = (sandbox: boolean): ScriptRun[] => commands.map((c) => runCommand(c.command, { sandbox }));
    const plain = runAll(false);
    plain.forEach((r, i) => {
      const what = `${commands[i]!.lane}: ${commands[i]!.command.join(' ')}`;
      console.log(`${what} (${(r.ms / 1000).toFixed(2)} s):\n${r.out}`);
      passes(r, LANE, what);
      expect(typeof readingOf(r), `${what}: the lane prints its one reading: ${String(readingOf(r))}`).toBe('object');
    });

    const problem = await sandboxProblem();
    if (problem?.startsWith('no /usr/bin/sandbox-exec')) ctx.skip(`INCONCLUSIVE (platform): ${problem}, so "reads no network" can't be read here`);
    expect(problem ?? '', 'the profile with no network denies a child a loopback connection').toBe('');
    runAll(true).forEach((r, i) => {
      const what = `${commands[i]!.lane}: ${commands[i]!.command.join(' ')}, with no network`;
      passes(r, LANE, what);
      expect(linesStarting(r, `PASS ${LANE}:`), `${what}: the same PASS line`).toEqual(linesStarting(plain[i]!, `PASS ${LANE}:`));
      expect(linesStarting(r, `NOTE ${LANE}:`), `${what}: the same reading`).toEqual(linesStarting(plain[i]!, `NOTE ${LANE}:`));
    });

    const seconds = (rs: readonly ScriptRun[]): number => rs.reduce((s, r) => s + r.ms, 0) / 1000;
    const env = environmentProblem();
    if (env) ctx.skip(`INCONCLUSIVE (reading only): ${env}; the lane took ${seconds(plain).toFixed(2)} s here`);
    runAll(false);
    const runs: number[] = [];
    for (let k = 0; k < 5; k++) runs.push(seconds(runAll(false)));
    settle(ctx, [judgeRuns('AC8 the closure lane in the local preflight (s)', runs, LANE_BUDGET_S)]);
  }, 3_600_000);
});
