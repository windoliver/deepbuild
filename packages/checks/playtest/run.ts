// One playtest (Check input: playtest): each bot's runs, run i at hash(the check's seed, i), each played headless in a
// replica through `play`, judged from what it recorded, then its track played again without its bot, which must reach
// the same full-state hashes. Evidence for each run: its track by hash and its frames by hash, its first, its
// outcome's and any the input asks for. testsRun counts runs; a failure names its run (`bot <b> run <i>`) and starts
// with its code. Before any run, each bot plays no step at the check's own seed: a bot the piece can't take, such as a
// policy naming a control it doesn't declare, is refused there by the replica, and the check ends with no run counted.
import { createHash } from 'node:crypto';
import type { CheckResult, Failure } from '@deepbuild/conformance';
import { lower } from './bots.ts';
import { firstDiffering, goalSteps, outcomeOf } from './judge.ts';
import type { Outcome, Play, PlayAnswer, PlaytestInput, Span } from './types.ts';

const FLICKS = 705_600_000;
/** Runs played at once: a playtest's replicas are leased two at a time. */
const AT_ONCE = 2;

/** Run i's seed: hash(the check's seed, i), the first 8 bytes of SHA-256(seed as u64 LE, i as u32 LE) big-endian, shifted right 11 bits to stay a JSON-safe integer. */
export function runSeed(seed: number, i: number): number {
  const b = Buffer.alloc(12);
  b.writeBigUInt64LE(BigInt(seed));
  b.writeUInt32LE(i, 8);
  return Number(createHash('sha256').update(b).digest().readBigUInt64BE(0) >> 11n);
}

const failure = (test: string, message: string, assertion = true): Failure => ({ test, file: '', line: 0, stack: null, assertion, message });
/** A span or a stuck rule's time as the piece's steps. */
const steps = (s: Span, step: number): number => (typeof s === 'number' ? Math.round((s * FLICKS) / step) : s.steps);

interface Ran { test: string; seed: number; outcome: Outcome; first: PlayAnswer; replay: PlayAnswer; reached: Set<string> }

export async function runPlaytest(input: PlaytestInput, play: Play): Promise<CheckResult> {
  const runs = input.runs ?? 20;
  const span = input.span ?? 120;
  const goals = input.goals ?? [];
  const values = [...new Set([input.stuck?.measure, ...goals.map((g) => g.when)].filter((v): v is string => v !== undefined))];
  const common = { span, values, ...(input.piece_seed ? { piece_seed: input.piece_seed } : {}) };
  const jobs = input.bots.flatMap((bot, b) => Array.from({ length: runs }, (_, i) => ({ bot, test: `bot ${b} run ${i}`, seed: runSeed(input.seed, i) })));
  const ran: Ran[] = [];
  let refused: Failure | undefined;
  const next = async (): Promise<void> => {
    for (let job = jobs.shift(); job && !refused; job = jobs.shift()) {
      const { test, seed } = job;
      let first: PlayAnswer;
      try {
        first = await play(input.piece, { ...common, seed, bot: lower(job.bot, seed), frames: [0] });
      } catch (e) {
        refused = failure(test, `refused: ${String((e as Error)?.message ?? e)}`, false);
        return;
      }
      const stuck = input.stuck && { measure: input.stuck.measure, by: input.stuck.by ?? 1, within: steps(input.stuck.within ?? 10, first.step) };
      const outcome = outcomeOf(first, goals, stuck);
      const every = input.frames?.every ? steps(input.frames.every, first.step) : 0;
      const keep = [...new Set([0, outcome.step, ...(every ? Array.from({ length: Math.floor((first.steps - 1) / every) + 1 }, (_, n) => n * every) : [])])].filter((k) => k < first.steps);
      const replay = await play(input.piece, { ...common, seed, track: first.entries, frames: keep });
      const reached = new Set([...goalSteps(first, goals)].filter(([, k]) => k !== undefined).map(([g]) => g));
      ran.push({ test, seed, outcome, first, replay, reached });
    }
  };
  // Each bot taken by the piece before any run: a play of no step at the check's own seed, which the replica refuses,
  // naming what, for a bot the piece can't take, such as a policy on a control it doesn't declare.
  for (const [b, bot] of input.bots.entries()) {
    try {
      await play(input.piece, { seed: input.seed, span: { steps: 0 }, bot: lower(bot, input.seed), values: [], frames: [] });
    } catch (e) {
      refused = failure(`bot ${b}`, `refused before any run: ${String((e as Error)?.message ?? e)}`, false);
      break;
    }
  }
  if (!refused) await Promise.all(Array.from({ length: AT_ONCE }, next));
  const order = (r: Ran): number[] => r.test.split(' ').filter((w) => /^\d+$/.test(w)).map(Number);
  ran.sort((a, b) => order(a)[0]! - order(b)[0]! || order(a)[1]! - order(b)[1]!);

  const failures: Failure[] = [];
  const evidence: string[] = [];
  for (const r of ran) {
    evidence.push(r.first.track, r.replay.track, ...[...r.first.frames, ...r.replay.frames].map((f) => f.sha256));
    const message = said(r);
    if (message) failures.push(failure(r.test, message, r.outcome.kind !== 'invalid'));
    const differs = firstDiffering(r.first, r.replay);
    if (differs !== undefined) failures.push(failure(r.test, `playtest.replay: ${r.test} (seed ${r.seed}): its track played again without its bot first differs in the full-state hash at step ${differs}`));
  }
  // A refused bot ends the check before any run: nothing was played to reach or miss a goal.
  if (refused) return { outcome: 'failed', testsRun: ran.length, failures: [refused, ...failures], evidence, read: [], mask: null };
  const counted = ran.filter((r) => r.outcome.kind !== 'invalid');
  for (const g of goals) {
    if (g.each) {
      for (const r of counted.filter((x) => !x.reached.has(g.name))) failures.push(failure(r.test, `playtest.goal_missed: ${r.test} (seed ${r.seed}) never reached ${g.name}, which each run must`));
    } else if (!counted.some((r) => r.reached.has(g.name))) {
      failures.push(failure(`goal ${g.name}`, `playtest.goal_missed: no run reached ${g.name}`));
    }
  }
  const outcome = !failures.length ? 'passed' : failures.every((f) => !f.assertion) ? 'ran_nothing' : 'failed';
  return { outcome, testsRun: ran.length, failures, evidence, read: [], mask: null };
}

/** What a run's outcome says, or nothing when it reached its goals or ended. */
function said(r: Ran): string | undefined {
  const o = r.outcome;
  const run = `${r.test} (seed ${r.seed})`;
  switch (o.kind) {
    case 'stuck': {
      const value = JSON.stringify(r.first.values[o.measure]?.[o.from_step]);
      const frame = r.replay.frames.find((f) => f.step === o.step)?.sha256 ?? 'not kept';
      return `playtest.stuck: ${run}: ${o.measure} last moved at step ${o.from_step}, to ${value}, and was found stuck at step ${o.step}; its frame there is ${frame}`;
    }
    case 'trap': {
      const read = Array.isArray(o.trap['inputs']) ? (o.trap['inputs'] as unknown[]).map((e) => JSON.stringify(e)).join(', ') : '';
      return `playtest.trap: ${run}: ${String(o.trap['item'])} trapped at step ${o.step} (${String(o.trap['kind'])}), reading ${read || 'no entry'}`;
    }
    case 'over_budget':
      return `playtest.over_budget: ${run}: ${o.item}'s step ${o.step} took ${o.fuel} fuel, past its ceiling of ${o.ceiling}`;
    case 'invalid':
      return `invalid: ${run}: ${o.why}, so the run counts toward nothing`;
    default:
      return undefined;
  }
}
