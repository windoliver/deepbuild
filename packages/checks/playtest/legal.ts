// rules.legal (#1048; canvas primitives: Check input: `rules.legal`): each action a game lists is taken, and an action
// it doesn't list is turned down. It reads the runs of the playtest it names: in each run it picks `samples` steps by
// hash(seed, run, i), spread over the steps where `legal.count` was above zero, and from the state the run reached at
// each, the replica tests entries one at a time, each in a throwaway copy, so none sees another's effects. Each listed
// row, put as its entry, must raise `accepted`, leave `refused` as it was and change another declared name; then
// `unlisted` entries drawn by hash(seed, run, step, j) from each action's arguments, held by no listed row, must each
// raise `refused` and change nothing else. A copy stepped with no entry is what each is compared with, so what the
// piece does on its own is no effect. It never takes the piece's word that an entry was legal: only what changed.
import { createHash } from 'node:crypto';
import type { CheckResult, Failure } from '@deepbuild/conformance';
import { lower, refusal } from './bots.ts';
import { legalPaths, listedAt, lockRefusal, type PlayIface } from './iface.ts';
import { ended, failure, runSeed, said } from './run.ts';
import type { Play, PlayAnswer, PlaytestInput } from './types.ts';

/** rules.legal's own input: the playtest it names, `samples` steps a run, `unlisted` entries a sample, and its seed. */
export interface LegalInput { playtest: string; samples?: number; unlisted?: number; seed: number }
/** What rules.legal found, beside check.kind@1's result. */
export interface LegalFound { tested: number; samples: { run: string; step: number }[]; listed_refused: { run: string; step: number; row: number[] }[]; unlisted_taken: { run: string; step: number; entry: number[] }[] }

/** hash(...parts): the first 8 bytes of SHA-256 over each part as a u64 LE, big-endian. */
export function h(...parts: number[]): bigint {
  const b = Buffer.alloc(8 * parts.length);
  parts.forEach((p, i) => b.writeBigUInt64LE(BigInt.asUintN(64, BigInt(p)), 8 * i));
  return createHash('sha256').update(b).digest().readBigUInt64BE(0);
}

/**
 * The `samples` steps of a run, by hash(seed, run, i), spread over the steps that list a row: the steps are split into
 * `samples` equal spans and one is drawn from each, so a run with fewer such steps tests each once.
 */
export function sampleSteps(listing: number[], samples: number, seed: number, run: number): number[] {
  const n = listing.length;
  const out: number[] = [];
  for (let i = 0; i < samples; i++) {
    const lo = Math.floor((i * n) / samples);
    const hi = Math.floor(((i + 1) * n) / samples);
    if (hi > lo) out.push(listing[lo + Number(h(seed, run, i) % BigInt(hi - lo))]!);
  }
  return out;
}

/** An action's arguments as rules.legal draws them. */
function drawArgs(args: string | undefined, play: PlayIface, x: bigint): [number, number] | undefined {
  const [w, hh] = (play.grid?.size as [number, number] | undefined) ?? [0, 0];
  const layers = Number(play.grid?.['layers'] ?? 1) || 1;
  switch (args ?? 'none') {
    case 'none': return [0, 0];
    case 'cell': return w > 0 && hh > 0 ? [Number(x % BigInt(w)), Number((x >> 20n) % BigInt(layers * hh))] : undefined;
    case 'option': return [Number(x % 16n), 0];
    case 'row': return [Number(x % 16n), Number((x >> 20n) % 16n)];
    // A stick or a look is the space form's: rules.legal reads the grid form.
    default: return undefined;
  }
}

/** Whether a listed row holds an entry: the same action, and for a cell, an option or a row's key, its arguments. */
export function held(entry: [number, number, number], listed: [number, number, number][], play: PlayIface): boolean {
  const actions = Object.values(play.actions ?? {});
  const args = actions[entry[0]]?.args ?? 'none';
  return listed.some((r) => r[0] === entry[0] && (args === 'none' || (r[1] === entry[1] && (args === 'option' || r[2] === entry[2]))));
}

/**
 * `n` unlisted entries at a step, each the j-th draw by hash(seed, run, step, j) of an action and its arguments that no
 * listed row holds; draws a listed row holds are passed over, up to 64 more.
 */
export function unlistedAt(play: PlayIface, listed: [number, number, number][], n: number, seed: number, run: number, step: number): [number, number, number][] {
  const actions = Object.values(play.actions ?? {});
  const out: [number, number, number][] = [];
  for (let j = 0; out.length < n && j < n + 64 && actions.length; j++) {
    const x = h(seed, run, step, j);
    const a = Number(x % BigInt(actions.length));
    const args = drawArgs(actions[a]!.args, play, x >> 8n);
    if (!args) continue;
    const entry: [number, number, number] = [a, args[0], args[1]];
    if (!held(entry, listed, play) && !out.some((e) => e.every((v, i) => v === entry[i]))) out.push(entry);
  }
  return out;
}

/** What a throwaway copy did, as the replica's probe answers it. */
export interface Tested { i: number; step: number; changed?: string[]; accepted?: boolean; refused?: boolean; refused_at_check?: string; trap?: Record<string, unknown> | null }

/** A listed row's test passes when it raised accepted, left refused and changed another declared name. */
export function listedTaken(t: Tested): boolean {
  return !t.trap && !t.refused_at_check && t.accepted === true && t.refused === false && (t.changed ?? []).some((n) => n !== 'accepted' && n !== 'refused');
}
/** An unlisted entry's test passes when it raised refused and changed no other declared name. */
export function unlistedRefused(t: Tested): boolean {
  return !t.trap && (t.refused_at_check !== undefined || (t.refused === true && (t.changed ?? []).every((n) => n === 'refused')));
}

/** Runs played two at a time, as a playtest's replicas are leased. */
const AT_ONCE = 2;

/**
 * rules.legal over the runs of the playtest whose input is `input`: each bot's run i at hash(the playtest's seed, i),
 * played as the playtest plays it, then tested at its samples in throwaway copies. testsRun counts the runs it read;
 * `legal.tested` the entries it put.
 */
export async function runLegal(legal: LegalInput, input: PlaytestInput, play: Play): Promise<CheckResult & { legal: LegalFound }> {
  const found: LegalFound = { tested: 0, samples: [], listed_refused: [], unlisted_taken: [] };
  const stop = (f: Failure): CheckResult & { legal: LegalFound } => ({ ...ended([f]), legal: found });
  const iface = input.play;
  if (!iface) return stop(failure('rules.legal', 'refused before any run: rules.legal reads the play interface of the playtest it names, and its input gives none', false));
  const locked = lockRefusal(iface);
  if (locked) return stop(failure('play', `refused before any run: ${locked}`, false));
  const paths = legalPaths(iface);
  if (!paths) return stop(failure('play', 'play.missing: legal: rules.legal puts the rows the piece lists, and the interface declares no legal list', false));
  const common = { span: input.span ?? 120, play: iface, ...(input.piece_seed ? { piece_seed: input.piece_seed } : {}) };
  // The interface taken by the piece before any run (play.missing names the name), then each bot.
  try {
    await play(input.piece, { seed: input.seed, span: { steps: 0 }, play: iface, values: [], frames: [] });
  } catch (e) {
    const why = said(e);
    return stop(failure('play', why.startsWith('play.missing') ? why : `refused before any run: ${why}`, false));
  }
  for (const [b, bot] of input.bots.entries()) {
    const why = refusal(bot, iface);
    if (why) return stop(failure(`bot ${b}`, `refused before any run: ${why}`, false));
  }
  const runs = input.runs ?? 20;
  const samples = legal.samples ?? 50;
  const unlisted = legal.unlisted ?? 8;
  const jobs = input.bots.flatMap((bot, b) => Array.from({ length: runs }, (_, i) => ({ bot, n: b * runs + i, test: `bot ${b} run ${i}`, seed: runSeed(input.seed, i) })));
  const done: { test: string; n: number; track: string }[] = [];
  const failures: Failure[] = [];
  let refused: Failure | undefined;
  const next = async (): Promise<void> => {
    for (let job = jobs.shift(); job && !refused; job = jobs.shift()) {
      let first: PlayAnswer;
      try {
        first = await play(input.piece, { ...common, seed: job.seed, bot: lower(job.bot), values: [paths.rows, paths.count], frames: [] });
      } catch (e) {
        refused = failure(job.test, `refused: ${said(e)}`, false);
        return;
      }
      const rows = first.values[paths.rows] ?? [];
      const counts = first.values[paths.count] ?? [];
      // A step's rows are put at the next step: the last step lists none a test could put.
      const listing = Array.from({ length: Math.max(0, first.steps - 1) }, (_, k) => k).filter((k) => listedAt(rows[k], counts[k]).length > 0);
      const at = sampleSteps(listing, samples, legal.seed, job.n).map((step) => {
        const listed = listedAt(rows[step], counts[step]);
        return { step, listed, unlisted: unlistedAt(iface, listed, unlisted, legal.seed, job.n, step) };
      });
      const tests = at.flatMap((a) => [...a.listed.map((row) => ({ step: a.step, row, listed: true })), ...a.unlisted.map((row) => ({ step: a.step, row, listed: false }))]);
      const answer = (await play(input.piece, {
        ...common, seed: job.seed, track: first.entries, values: [], frames: [],
        probe: { at: at.map((a) => ({ step: a.step, tests: [...a.listed, ...a.unlisted].map((row) => ({ row })) })) },
      })) as unknown as { tests: Tested[] };
      found.tested += tests.length;
      found.samples.push(...at.map((a) => ({ run: job.test, step: a.step })));
      for (const t of answer.tests) {
        const { step, row, listed } = tests[t.i]!;
        const name = Object.keys(iface.actions ?? {})[row[0]] ?? `action ${row[0]}`;
        const why = t.trap ? `, trapping (${String(t.trap['kind'])} in ${String(t.trap['function'])} at offset ${String(t.trap['offset'])})` : '';
        if (listed && !listedTaken(t)) {
          found.listed_refused.push({ run: job.test, step, row });
          failures.push(failure(job.test, `rules.listed_refused: ${job.test} (seed ${job.seed}): at step ${step}, the listed row [${row.join(', ')}] (${name}) ${t.accepted ? 'raised accepted' : 'didn\'t raise accepted'}, ${t.refused ? 'raised refused' : 'left refused'} and changed ${(t.changed ?? []).join(', ') || 'nothing'}${why}`));
        } else if (!listed && !unlistedRefused(t)) {
          found.unlisted_taken.push({ run: job.test, step, entry: row });
          failures.push(failure(job.test, `rules.unlisted_taken: ${job.test} (seed ${job.seed}): at step ${step}, the unlisted entry [${row.join(', ')}] (${name}) ${t.refused ? 'raised refused' : 'didn\'t raise refused'} and changed ${(t.changed ?? []).join(', ') || 'nothing'}${why}`));
        }
      }
      done.push({ test: job.test, n: job.n, track: first.track });
    }
  };
  await Promise.all(Array.from({ length: AT_ONCE }, next));
  done.sort((a, b) => a.n - b.n);
  const evidence = done.map((d) => d.track);
  if (refused) return { ...ended([refused, ...failures], evidence, done.length), legal: found };
  return { outcome: failures.length ? 'failed' : 'passed', testsRun: done.length, failures, evidence, read: [], mask: null, legal: found };
}
