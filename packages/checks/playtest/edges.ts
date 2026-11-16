// logic.edges (#1048): a check kind of the playtest plug-in that puts every control the play interface lists at the
// edge values of its kind, as the kind's `control@1` entry declares them, on the control's own range: from `samples`
// states each run of the playtest it names passes through, in a throwaway copy, one control at a time with the others
// as the run had them, then `settle` steps. A trap, a non-finite value written to a declared array or a value outside
// its name's range fails, naming the control, the value, the step it was put in from and the run, with the track of a
// replica play that reproduces it. A value the logic module's check refuses, such as a text past its control's
// max_bytes, never reaches a step: it's listed as refused and fails nothing. It reads the piece's own arrays and traps,
// never pixels, and its values come from the registry, never the working agent.
import type { CheckResult, Failure } from '@deepbuild/conformance';
import { lower, refusal } from './bots.ts';
import { declared, lockRefusal, ranged } from './iface.ts';
import { h } from './legal.ts';
import { ended, failure, runSeed, said } from './run.ts';
import type { Play, PlayAnswer, PlaytestInput } from './types.ts';

/** logic.edges's own input: the playtest it names, `samples` states a run, `settle` steps after each value, its seed. */
export interface EdgesInput { playtest: string; samples?: number; settle?: number; seed: number }
interface Put { run: string; step: number; control: string; value: string }
/** What logic.edges put and what the logic module's check refused, beside check.kind@1's result. */
export interface EdgesFound { put: Put[]; refused: Put[] }

/** A value as the check names it: a number as JavaScript prints it, or a text by its length in bytes. */
const spelled = (v: unknown): string => (typeof v === 'string' ? `text of ${Buffer.byteLength(v, 'utf8')} bytes` : String(v));
/** The probe's answer for one value it put. */
interface Edged { i: number; step: number; control?: string; value?: unknown; refused_at_check?: string; trap?: Record<string, unknown> | null; nonfinite?: Record<string, unknown>[]; out_of_range?: Record<string, unknown>[]; track?: Record<string, unknown>[] }

const AT_ONCE = 2;

/** `samples` steps of a run's `steps`, by hash(seed, run, i), one from each of `samples` equal spans of the steps a value can be put after. */
function samplesOf(steps: number, samples: number, seed: number, run: number): number[] {
  const n = Math.max(0, steps - 1);
  const out: number[] = [];
  for (let i = 0; i < samples; i++) {
    const lo = Math.floor((i * n) / samples);
    const hi = Math.floor(((i + 1) * n) / samples);
    if (hi > lo) out.push(lo + Number(h(seed, run, i) % BigInt(hi - lo)));
  }
  return out;
}

export async function runEdges(edges: EdgesInput, input: PlaytestInput, play: Play): Promise<CheckResult & { edges: EdgesFound }> {
  const found: EdgesFound = { put: [], refused: [] };
  const stop = (f: Failure): CheckResult & { edges: EdgesFound } => ({ ...ended([f]), edges: found });
  const iface = input.play;
  if (!iface) return stop(failure('logic.edges', 'refused before any run: logic.edges puts the controls the play interface lists, and the input of the playtest it names gives none', false));
  const locked = lockRefusal(iface);
  if (locked) return stop(failure('play', `refused before any run: ${locked}`, false));
  const controls = [...new Set(Object.values(iface.actions ?? {}).map((a) => a.control))];
  const ranges = Object.fromEntries(ranged(iface).map((r) => [r.path, r.range]));
  // Every declared name's array, read at each step of a run: what its values show.
  const values = [...new Set(declared(iface).map((d) => (typeof d.at === 'string' ? d.at : d.at.name)))];
  const common = { span: input.span ?? 120, play: iface, ...(input.piece_seed ? { piece_seed: input.piece_seed } : {}) };
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
  const settle = edges.settle ?? 1;
  const jobs = input.bots.flatMap((bot, b) => Array.from({ length: runs }, (_, i) => ({ bot, n: b * runs + i, test: `bot ${b} run ${i}`, seed: runSeed(input.seed, i) })));
  const done: { n: number; track: string }[] = [];
  const failures: Failure[] = [];
  let refused: Failure | undefined;
  const next = async (): Promise<void> => {
    for (let job = jobs.shift(); job && !refused; job = jobs.shift()) {
      let first: PlayAnswer;
      try {
        first = await play(input.piece, { ...common, seed: job.seed, bot: lower(job.bot), values, frames: [] });
      } catch (e) {
        refused = failure(job.test, `refused: ${said(e)}`, false);
        return;
      }
      done.push({ n: job.n, track: first.track });
      const at = samplesOf(first.steps, edges.samples ?? 50, edges.seed, job.n).map((step) => ({ step, tests: controls.map((c) => ({ edges: c })) }));
      const answer = (await play(input.piece, { ...common, seed: job.seed, track: first.entries, values: [], frames: [], probe: { at, settle, ranges } } as never)) as unknown as { tests: Edged[] };
      for (const t of answer.tests) {
        const put: Put = { run: job.test, step: t.step, control: String(t.control), value: spelled(t.value) };
        if (t.refused_at_check !== undefined) {
          found.refused.push(put);
          continue;
        }
        found.put.push(put);
        if (!t.trap && !t.nonfinite?.length && !t.out_of_range?.length) continue;
        // Its track played again in a fresh replica: the play whose recorded track the failure names.
        const again = await play(input.piece, { ...common, seed: job.seed, track: t.track ?? [], span: { steps: t.step + 1 + settle }, values: Object.keys(ranges), frames: [] });
        const where = `${job.test} (seed ${job.seed}): control ${put.control} at value ${put.value}, put in from step ${t.step}`;
        const track = `track ${again.track}`;
        if (t.trap) {
          const tr = again.trap ?? t.trap;
          const reproduced = again.trap ? '' : ' (a fresh replica didn\'t trap on it)';
          failures.push(failure(job.test, `logic.trap: ${where}, trapped (${String(tr['kind'])}) in function ${String(tr['function'])} at offset ${String(tr['offset'])}, step ${String(tr['step'])}; ${track} plays it again${reproduced}`));
        } else if (t.nonfinite?.length) {
          const x = t.nonfinite[0]!;
          failures.push(failure(job.test, `logic.non_finite: ${where}, wrote ${String(x['value'])} to ${String(x['path'])} row ${String(x['row'])}; ${track} plays it again`));
        } else {
          const x = t.out_of_range![0]!;
          failures.push(failure(job.test, `play.out_of_range: ${where}, left ${String(x['path'])} row ${String(x['row'])} at ${String(x['value'])}, outside [${String(ranges[String(x['path'])])}]; ${track} plays it again`));
        }
      }
    }
  };
  await Promise.all(Array.from({ length: AT_ONCE }, next));
  done.sort((a, b) => a.n - b.n);
  const evidence = done.map((d) => d.track);
  if (refused) return { ...ended([refused, ...failures], evidence, done.length), edges: found };
  return { outcome: failures.length ? 'failed' : 'passed', testsRun: done.length, failures, evidence, read: [], mask: null, edges: found };
}
