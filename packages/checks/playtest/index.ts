// deepbuild/playtest (#184): the check that requires live play, a first-party plug-in, so the canvas core and its
// modules know nothing of it. It registers kind `playtest` through deep.registerCheck: bots, a scripted input policy
// or a logic program, play seeded runs of the piece itself headless in replicas through deep.canvas.play; a run that
// gets stuck, misses a goal, traps or passes its step ceiling fails; and every run's track replays exactly. Its input,
// the spec's `play`, comes from the brief or definition, so the working agent can't change it or pick a lucky seed.
import type { CheckResult } from '@deepbuild/conformance';
import { lockRefusal, type PlayIface } from './iface.ts';
import { runEdges, type EdgesInput } from './edges.ts';
import { runLegal, type LegalInput } from './legal.ts';
import type { Ask } from './model.ts';
import { runPlaytest } from './run.ts';
import type { Play, PlaytestInput } from './types.ts';

/** The plug-in's model source (#1048): a model bot's asks go through the hub as calls of it. */
export const MODEL_SOURCE = 'ext.playtest.model';

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

interface Spec { play?: PlaytestInput; legal?: LegalInput; edges?: EdgesInput }
interface Deep {
  registerCheck(type: string, runner: (spec: Spec) => Promise<CheckResult>): void;
  canvas: { play: Play };
  source: { ask(name: string, request: { provider: string; prompt: string }): Promise<{ status: number | null; body: string }> };
}

const nothing = (kind: string, what: string): CheckResult => ({ outcome: 'ran_nothing', testsRun: 0, failures: [{ test: kind, file: '', line: 0, stack: null, assertion: false, message: what }], evidence: [], read: [], mask: null });

export default function register(deep: Deep): void {
  const play: Play = (piece, run) => deep.canvas.play(piece, run);
  // A model's reply is the answer's body; no answer is no reply, which sends no entry.
  const ask: Ask = async (provider, prompt) => {
    const answer = await deep.source.ask(MODEL_SOURCE, { provider, prompt });
    return { text: answer.status === 200 ? answer.body : '' };
  };
  deep.registerCheck('playtest', async (spec) => {
    if (!spec.play) return nothing('playtest', 'the check gives no playtest input in its spec\'s play');
    return runPlaytest(spec.play, play, ask);
  });
  // #1048: rules.legal reads the runs of the playtest it names, whose input its spec's play gives.
  deep.registerCheck('rules.legal', async (spec) => {
    if (!spec.legal) return nothing('rules.legal', 'the check gives no rules.legal input in its spec\'s legal');
    if (!spec.play) return { ...nothing('rules.legal', `BLOCKED: the playtest ${spec.legal.playtest} it names is unrun: its spec gives no playtest input in play`), outcome: 'missing' };
    return runLegal(spec.legal, spec.play, play);
  });
  // #1048: logic.edges puts each listed control's edge values from the states the named playtest's runs pass through.
  deep.registerCheck('logic.edges', async (spec) => {
    if (!spec.edges) return nothing('logic.edges', 'the check gives no logic.edges input in its spec\'s edges');
    if (!spec.play) return { ...nothing('logic.edges', `BLOCKED: the playtest ${spec.edges.playtest} it names is unrun: its spec gives no playtest input in play`), outcome: 'missing' };
    return runEdges(spec.edges, spec.play, play);
  });
}
