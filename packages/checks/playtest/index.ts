// deepbuild/playtest (#184): the check that requires live play, a first-party plug-in, so the canvas core and its
// modules know nothing of it. It registers kind `playtest` through deep.registerCheck: bots, a scripted input policy
// or a logic program, play seeded runs of the piece itself headless in replicas through deep.canvas.play; a run that
// gets stuck, misses a goal, traps or passes its step ceiling fails; and every run's track replays exactly. Its input,
// the spec's `play`, comes from the brief or definition, so the working agent can't change it or pick a lucky seed.
import type { CheckResult } from '@deepbuild/conformance';
import { lockRefusal, type PlayIface } from './iface.ts';
import { runPlaytest } from './run.ts';
import type { Play, PlaytestInput } from './types.ts';

/**
 * The play interface `game.play@1` as the brief locks it (#555), before anything is generated: the interface as
 * locked, a copy no later change to the brief's own object reaches, or an Error naming why it's refused, such as a
 * name carrying a unit the canvas doesn't name.
 */
export function lockPlay(play: PlayIface): PlayIface {
  const why = lockRefusal(play);
  if (why) throw Error(`the play interface can't be locked: ${why}`);
  return JSON.parse(JSON.stringify(play)) as PlayIface;
}

/**
 * The check's source for the verdict: `own` when every bot is the working agent's (`by: "agent"`), so a pass binds
 * only its own checks and leaves the requirement INCONCLUSIVE with one ask; else the definition's.
 */
export function playtestSource(input: PlaytestInput): 'own' | 'definition' {
  return input.bots.length > 0 && input.bots.every((b) => b.by === 'agent') ? 'own' : 'definition';
}

interface Deep {
  registerCheck(type: string, runner: (spec: { play?: PlaytestInput }) => Promise<CheckResult>): void;
  canvas: { play: Play };
}

export default function register(deep: Deep): void {
  deep.registerCheck('playtest', async (spec) => {
    if (!spec.play) return { outcome: 'ran_nothing', testsRun: 0, failures: [{ test: 'playtest', file: '', line: 0, stack: null, assertion: false, message: 'the check gives no playtest input in its spec\'s play' }], evidence: [], read: [], mask: null };
    return runPlaytest(spec.play, (piece, run) => deep.canvas.play(piece, run));
  });
}
