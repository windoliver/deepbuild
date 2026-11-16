// One playtest (Check input: playtest): each bot's runs, run i at hash(the check's seed, i), each played headless in a
// replica through `play`, judged from what it recorded, then its track played again without its bot, which must reach
// the same full-state hashes. Evidence for each run: its track by hash and its frames by hash, its first, its
// outcome's and any the input asks for. testsRun counts runs; a failure names its run (`bot <b> run <i>`) and starts
// with its code. Before any run, each bot plays no step at the check's own seed: a bot the piece can't take, such as a
// policy naming a control it doesn't declare, is refused there by the replica, and the check ends with no run counted.
// With a play interface (#555), the interface is played first for no step, so a name the piece publishes no array of
// the right type for fails play.missing before any run; goals are expressions over its names; a name's range fails a
// run that publishes a value outside it with play.out_of_range; and each bot's bands and expectations hold over its runs.
import { createHash } from 'node:crypto';
import type { CheckResult, Failure } from '@deepbuild/conformance';
import { kindOf, lower, refusal } from './bots.ts';
import { declared, goalTest, legalPaths, linkOffGrid, linksOf, lockRefusal, outOfRange, ranged } from './iface.ts';
import { firstDiffering, goalSteps, outcomeOf, type Judged } from './judge.ts';
import { actingSteps, modelReplies, type Ask } from './model.ts';
import { onReferenceMac, soakFailure, windowsOf } from './soak.ts';
import type { Bot, Outcome, Play, PlayAnswer, PlaytestInput, Span } from './types.ts';

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

export const failure = (test: string, message: string, assertion = true): Failure => ({ test, file: '', line: 0, stack: null, assertion, message });
/** A span or a stuck rule's time as the piece's steps. */
export const steps = (s: Span, step: number): number => (typeof s === 'number' ? Math.round((s * FLICKS) / step) : s.steps);

/** A run played and replayed; a model bot's run carries how its replay ends by the same rule. */
interface Ran { test: string; bot: number; seed: number; outcome: Outcome; first: PlayAnswer; replay: PlayAnswer; reached: Map<string, number>; model?: { replayed: Outcome } }

export const ended = (failures: Failure[], evidence: string[] = [], testsRun = 0): CheckResult => ({ outcome: 'failed', testsRun, failures, evidence, read: [], mask: null });
/** A refusal's words led by the code the replica names: the host's message without its prefix, or a replica's error. */
export function said(e: unknown): string {
  const raw = String((e as Error)?.message ?? e);
  try {
    const j = JSON.parse(raw) as { code?: unknown; message?: unknown };
    if (typeof j?.code === 'string') return `${j.code}: ${String(j.message ?? '')}`;
  } catch { /* not a replica's error as JSON */ }
  return raw.replace(/^deep\.canvas\.play: (?:refused: )?/, '');
}

/** A run as the result lists it (#1048): counted false for a model bot's, whose runs count only through replay. */
export interface RunShown { test: string; seed: number; track: string; outcome: Outcome; replay: string; frames: string[]; counted: boolean }

export async function runPlaytest(input: PlaytestInput, play: Play, ask?: Ask): Promise<CheckResult & { runs: RunShown[] }> {
  const runs = input.runs ?? 20;
  const span = input.span ?? 120;
  const iface = input.play;
  // The interface, its goals and its bots, each refused before any run.
  const locked = iface && lockRefusal(iface);
  if (locked) return ended([failure('play', `refused before any run: ${locked}`, false)]);
  let goals: Judged[];
  let reads: string[];
  try {
    const tests = (input.goals ?? []).map((g) => ({ name: g.name, ...goalTest(g.when, iface) }));
    goals = tests;
    reads = tests.flatMap((t) => t.reads);
  } catch (e) {
    return ended([failure('goals', `refused before any run: ${said(e)}`, false)]);
  }
  for (const [b, bot] of input.bots.entries()) {
    const why = refusal(bot, iface);
    if (why) return ended([failure(`bot ${b}`, `refused before any run: ${why}`, false)]);
  }
  const bounds = iface ? ranged(iface) : [];
  const links = iface && linksOf(iface);
  const values = [...new Set([input.stuck?.measure, ...reads, ...bounds.map((r) => r.path), links?.rows, links?.count].filter((v): v is string => v !== undefined))];
  const common = { span, values, ...(input.piece_seed ? { piece_seed: input.piece_seed } : {}), ...(iface ? { play: iface } : {}) };
  const jobs = input.bots.flatMap((bot, b) => Array.from({ length: runs }, (_, i) => ({ bot, b, test: `bot ${b} run ${i}`, seed: runSeed(input.seed, i) })));
  const ran: Ran[] = [];
  let refused: Failure | undefined;
  // A model bot's prompt reads the interface's names, never one the brief hides from players.
  const hidden = new Set((iface?.['hidden'] as string[] | undefined) ?? []);
  const shownNames = iface ? Object.fromEntries(declared(iface).filter((d) => !hidden.has(d.name)).map((d) => [d.name, typeof d.at === 'string' ? d.at : d.at.name])) : {};
  const legal = iface && legalPaths(iface);
  const next = async (): Promise<void> => {
    for (let job = jobs.shift(); job && !refused; job = jobs.shift()) {
      const { test, seed } = job;
      const bot = lower(job.bot);
      let first: PlayAnswer;
      let rows: number[][] | undefined;
      try {
        if ('model' in job.bot) {
          // A model bot's run: its replies, grown by playing to each of its turns and asking, then the run itself.
          const step = (await play(input.piece, { ...common, seed, bot, rows: [], span: { steps: 1 }, frames: [] })).step;
          const total = steps(span, step);
          const asked = await modelReplies({
            bot: job.bot.model, steps: total, legal: legal!, names: shownNames, actions: Object.keys(iface?.actions ?? {}),
            playTo: (n, r) => play(input.piece, { ...common, values: [...new Set([...common.values, legal!.rows, legal!.count, ...Object.values(shownNames)])], seed, bot, rows: r, span: { steps: n }, frames: [] }),
            ask: ask ?? (async () => ({ text: '' })),
          });
          rows = asked.rows;
          first = await play(input.piece, { ...common, seed, bot, rows, frames: [0] });
        } else {
          first = await play(input.piece, { ...common, seed, bot, frames: [0] });
        }
      } catch (e) {
        refused = failure(test, `refused: ${String((e as Error)?.message ?? e)}`, false);
        return;
      }
      const stuck = input.stuck && { measure: input.stuck.measure, by: input.stuck.by ?? 1, within: steps(input.stuck.within ?? 10, first.step) };
      // A model run's stuck rule counts only the steps at which its track holds a bot entry, run and replay alike.
      const acting = rows ? actingSteps(rows) : undefined;
      const outcome = outcomeOf(first, goals, stuck, acting);
      const every = input.frames?.every ? steps(input.frames.every, first.step) : 0;
      const keep = [...new Set([0, outcome.step, ...(every ? Array.from({ length: Math.floor((first.steps - 1) / every) + 1 }, (_, n) => n * every) : [])])].filter((k) => k < first.steps);
      const replay = await play(input.piece, { ...common, seed, track: first.entries, frames: keep });
      const reached = new Map([...goalSteps(first, goals)].flatMap(([g, k]) => (k === undefined ? [] : [[g, k] as const])));
      const model = rows ? { replayed: outcomeOf(replay, goals, stuck, acting) } : undefined;
      ran.push({ test, bot: job.b, seed, outcome, first, replay, reached, model });
    }
  };
  // The interface taken by the piece before any run, then each bot: a play of no step at the check's own seed, which the
  // replica refuses, naming what, for a name the piece publishes no array of the right type for (play.missing), or a
  // bot the piece can't take, such as a policy on a control it doesn't declare.
  if (iface) {
    try {
      await play(input.piece, { seed: input.seed, span: { steps: 0 }, play: iface, values: [], frames: [] });
    } catch (e) {
      const why = said(e);
      return ended([failure('play', why.startsWith('play.missing') ? why : `refused before any run: ${why}`, false)]);
    }
  }
  for (const [b, bot] of input.bots.entries()) {
    try {
      await play(input.piece, { seed: input.seed, span: { steps: 0 }, bot: lower(bot), values: [], frames: [], ...(iface ? { play: iface } : {}) });
    } catch (e) {
      refused = failure(`bot ${b}`, `refused before any run: ${said(e)}`, false);
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
    // A model run's stuck, trap or over-budget outcome stands only when its track, played again without the model,
    // fails the same way at the same step; otherwise the run is refused.
    const o = r.outcome;
    const failing = o.kind === 'stuck' || o.kind === 'trap' || o.kind === 'over_budget';
    if (r.model && failing && (r.model.replayed.kind !== o.kind || r.model.replayed.step !== o.step)) {
      failures.push(failure(r.test, `refused: ${r.test} (seed ${r.seed}), a model bot's run, ended ${o.kind} at step ${o.step}, and its track played again without the model ends ${r.model.replayed.kind} at step ${r.model.replayed.step}, so it counts for nothing`, false));
      continue;
    }
    const message = told(r);
    if (message) failures.push(failure(r.test, message, r.outcome.kind !== 'invalid'));
    const differs = firstDiffering(r.first, r.replay);
    if (differs !== undefined) failures.push(failure(r.test, `playtest.replay: ${r.test} (seed ${r.seed}): its track played again without its bot first differs in the full-state hash at step ${differs}`));
    for (const { name, path, range } of bounds) {
      const out = outOfRange(r.first.values[path] ?? [], range);
      if (out) failures.push(failure(r.test, `play.out_of_range: ${r.test} (seed ${r.seed}): ${name} row ${out.row} is ${out.value} at step ${out.step}, outside [${range[0]}, ${range[1]}]`));
    }
    const off = links && linkOffGrid(r.first.values[links.rows] ?? [], r.first.values[links.count] ?? [], links.cells);
    if (off) failures.push(failure(r.test, `play.out_of_range: ${r.test} (seed ${r.seed}): links row ${off.row} names cell ${off.cell} at step ${off.step}, off the grid's cells 0 to ${links!.cells - 1}`));
  }
  const shown: RunShown[] = ran.map((r) => ({
    test: r.test, seed: r.seed, track: r.first.track, outcome: r.outcome, replay: r.replay.track,
    frames: [...r.first.frames, ...r.replay.frames].map((f) => f.sha256), counted: !r.model,
  }));
  // A refused bot ends the check before any run: nothing was played to reach or miss a goal.
  if (refused) return { outcome: 'failed', testsRun: ran.length, failures: [refused, ...failures], evidence, read: [], mask: null, runs: shown };
  // The soak: one long run of its bot, read every `every` steps against the brief's limits.
  if (input.soak) failures.push(...(await soaked(input, common, play)));
  // Goals, bands and expectations rest on counted runs: never a model bot's.
  const counted = ran.filter((r) => r.outcome.kind !== 'invalid' && !r.model);
  for (const g of input.goals ?? []) {
    if (g.each) {
      for (const r of counted.filter((x) => !x.reached.has(g.name))) failures.push(failure(r.test, `playtest.goal_missed: ${r.test} (seed ${r.seed}) never reached ${g.name}, which each run must`));
    } else if (!counted.some((r) => r.reached.has(g.name))) {
      failures.push(failure(`goal ${g.name}`, `playtest.goal_missed: no run reached ${g.name}`));
    }
  }
  for (const [b, bot] of input.bots.entries()) failures.push(...held(b, bot, counted.filter((r) => r.bot === b)));
  const outcome = !failures.length ? 'passed' : failures.every((f) => !f.assertion) ? 'ran_nothing' : 'failed';
  return { outcome, testsRun: ran.length, failures, evidence, read: [], mask: null, runs: shown };
}

/** The soak's failures: its run refused, or playtest.soak at the first window over a limit. */
async function soaked(input: PlaytestInput, common: { span: Span; values: string[] }, play: Play): Promise<Failure[]> {
  const soak = input.soak!;
  const every = soak.every ?? 3_600;
  const name = `the soak of ${kindOf(soak.bot as Bot)}`;
  let answer: PlayAnswer;
  try {
    answer = await play(input.piece, { ...common, values: [], seed: input.seed, bot: lower(soak.bot as Bot), span: { steps: soak.steps }, frames: [], soak: { every } });
  } catch (e) {
    return [failure('soak', `refused: ${name}: ${said(e)}`, false)];
  }
  if (answer.trap) return [failure('soak', `playtest.trap: ${name}: ${String(answer.trap['item'])} trapped at step ${String(answer.trap['step'])} (${String(answer.trap['kind'])})`)];
  const why = soakFailure(name, windowsOf(answer, every), soak.limits, onReferenceMac());
  return why ? [failure('soak', why)] : [];
}

/**
 * A bot's bands and expectations over its counted runs: the share that reach each goal it bands must lie in the band
 * (playtest.band, naming the bot, the goal, the share and the band), and a goal it must miss fails each run that
 * reaches it (playtest.expect, naming the run and the step).
 */
function held(b: number, bot: Bot, runs: Ran[]): Failure[] {
  const out: Failure[] = [];
  const name = `bot ${b} (${kindOf(bot)})`;
  for (const [goal, [min, max]] of Object.entries(bot.share ?? {})) {
    const n = runs.filter((r) => r.reached.has(goal)).length;
    const share = runs.length ? n / runs.length : 0;
    if (!(share >= min && share <= max)) out.push(failure(`bot ${b}`, `playtest.band: ${name}: ${goal} reached in ${n} of its ${runs.length} runs, share ${share}, outside [${min}, ${max}]`));
  }
  for (const [goal, want] of Object.entries(bot.expect ?? {})) {
    if (want !== 'miss') continue;
    for (const r of runs.filter((x) => x.reached.has(goal))) out.push(failure(r.test, `playtest.expect: ${r.test} (seed ${r.seed}) of ${name} reached ${goal} at step ${r.reached.get(goal)}, which it must miss`));
  }
  return out;
}

/** What a run's outcome says, or nothing when it reached its goals or ended. */
function told(r: Ran): string | undefined {
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
