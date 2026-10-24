// What both runners share (#685): the deadline every checker call runs under, the working copy a run checks (never
// the checkout itself), the approved statements found in it, and the result put together from the checker's
// report: a closed run outcome, never a verdict.
import { spawnSync } from 'node:child_process';
import { closeSync, cpSync, existsSync, mkdtempSync, openSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, join, relative, sep } from 'node:path';
import type { CheckContext, Failure } from '@deepbuild/conformance';
import type { Cause, Checked, ProofResult, ProofSpec, Proposal } from './types.js';

/** A checker call found the run past its deadline. */
export class Overran extends Error {}
/** The machine can't run the check: its toolchain is missing, or the checker couldn't start. */
export class Missing extends Error {}
export interface Clock { end: number; now(): number }
export const clock = (ctx: CheckContext): Clock => ({ end: ctx.now() + ctx.deadline, now: ctx.now });

export interface Exec { status: number | null; stdout: string; out: string }
/** Runs a checker under what is left of the deadline, its stdout to `into` when named; a call cut short ends the run as overran. */
export function exec(program: string, args: string[], cwd: string, env: NodeJS.ProcessEnv, at: Clock, into?: string): Exec {
  const left = at.end - at.now();
  if (left <= 0) throw new Overran();
  const fd = into ? openSync(into, 'w') : undefined;
  try {
    const r = spawnSync(program, args, {
      cwd, env, encoding: 'utf8', timeout: left, killSignal: 'SIGKILL', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', fd ?? 'pipe', 'pipe'],
    });
    if ((r.error as NodeJS.ErrnoException | undefined)?.code === 'ETIMEDOUT') throw new Overran();
    if (r.error) throw new Missing(`${program} couldn't start: ${r.error.message}`);
    return { status: r.status, stdout: r.stdout ?? '', out: `${r.stdout ?? ''}${r.stderr}` };
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/** Build output and history a run never copies. */
const SKIP = new Set(['.lake', 'target', '.git', 'node_modules']);
/** A copy of a checkout the run builds in, so no build output or substituted statement lands in the checkout. */
export function workCopy(from: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'deep-proof-'));
  cpSync(from, dir, { recursive: true, filter: (src) => src === from || !SKIP.has(basename(src)) });
  return dir;
}
/** Every file under a folder whose name ends with one of `endings`, relative and sorted. */
export function sources(dir: string, endings: readonly string[]): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (SKIP.has(e.name)) continue;
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (endings.some((x) => e.name.endsWith(x))) out.push(relative(dir, p).split(sep).join('/'));
    }
  };
  walk(dir);
  return out.sort();
}
/** The 1-based line of an offset. */
export const lineAt = (text: string, offset: number): number => text.slice(0, offset).split('\n').length;
export const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** A checker's output with the working copy and the home folder taken out. */
export const redact = (s: string, work: string): string => s.split(work).join('.').split(homedir()).join('~');

// ---- Statements.

/** Where a theorem's statement starts in a file's text, and its bytes as the file writes them. */
export type Locate = (text: string, theorem: string) => { start: number; text: string } | null;
/**
 * Each approved statement against the working copy: a theorem whose statement the checkout lacks is unfound, and a
 * statement written differently is a proposal naming the file. With `substitute`, the approved bytes replace the
 * written ones, so the checker judges the approved statement.
 */
export function approve(work: string, spec: ProofSpec, locate: Locate, substitute: boolean): { unfound: string[]; proposals: Proposal[] } {
  const proposals: Proposal[] = [];
  const found = new Set<string>();
  for (const s of spec.statements) {
    const path = join(work, s.file);
    const text = existsSync(path) ? readFileSync(path, 'utf8') : '';
    const at = locate(text, s.theorem);
    if (!at) continue;
    found.add(s.theorem);
    if (at.text === s.text) continue;
    proposals.push({ theorem: s.theorem, file: s.file, approved: s.text, written: at.text });
    if (substitute) writeFileSync(path, `${text.slice(0, at.start)}${s.text}${text.slice(at.start + at.text.length)}`);
  }
  return { unfound: spec.theorems.filter((t) => !found.has(t)), proposals };
}
export const unfoundCause = (theorem: string): Cause => ({ theorem, why: 'unfound', line: `${theorem} was not found: the checkout holds no statement of it` });

// ---- The result.

/** comparator's flag on macOS, where bubblewrap doesn't exist; on Linux comparator runs in its own sandbox. */
export const LEAN_FLAGS = process.platform === 'darwin' ? ['--inadvisably-no-sandbox'] : [];
/** Kani prints the counterexample of each failed check as a Rust test. */
export const KANI_FLAGS = ['-Z', 'concrete-playback', '--concrete-playback=print'];
/** The version a toolchain pin names: `leanprover/lean4:v4.35.0` is 4.35.0, `kani 0.68.0` is 0.68.0. */
export const versionOf = (spec: ProofSpec): string => /(\d+\.\d+\.\d+\S*)$/.exec(spec.toolchain)?.[1] ?? spec.toolchain;
/** The key's tools: the toolchain's version and the runner's flags, so a change to either runs the check again. */
export function toolsOf(spec: ProofSpec, version = versionOf(spec)): Record<string, string> {
  return spec.runner === 'lean4' ? { lean4: version, 'lean4.comparator': LEAN_FLAGS.join(' ') } : { kani: version, 'kani.flags': KANI_FLAGS.join(' ') };
}

const empty = (spec: ProofSpec): Omit<ProofResult, 'outcome' | 'reasons' | 'receipt'> => ({
  testsRun: 0, failures: [], evidence: [], read: [], mask: null, proposals: [], tools: toolsOf(spec), smallest: null,
});
/** The machine can't run the check: missing, keyed as the check, so the core blocks on it, naming why. */
export const missingRun = (spec: ProofSpec, why: string): Checked =>
  ({ result: { outcome: 'missing', ...empty(spec), reasons: [why], receipt: `not run: ${why}` }, causes: [] });
export const overranRun = (spec: ProofSpec, deadline: number): Checked => {
  const why = `the checker was still running at the ${deadline} ms deadline`;
  return { result: { outcome: 'overran', ...empty(spec), reasons: [why], receipt: `stopped: ${why}` }, causes: [] };
};

export interface Parts {
  testsRun: number;
  failures: Failure[];
  causes: Cause[];
  proposals: Proposal[];
  tools: Record<string, string>;
  read: string[];
  evidence: string[];
  receipt: string;
  smallest: string | null;
}
/** The checker refused something: failed; else a theorem proves nothing: ran_nothing; else one it stopped short of deciding: stopped; else passed. */
export function outcomeOf(failures: readonly Failure[], causes: readonly Cause[]): ProofResult['outcome'] {
  if (failures.length) return 'failed';
  if (causes.some((c) => c.why !== 'bound')) return 'ran_nothing';
  return causes.length ? 'stopped' : 'passed';
}
export function finish(p: Parts): Checked {
  const reasons = [...p.causes.map((c) => c.line), ...p.failures.map((f) => `${f.test} failed at ${f.file}:${f.line}: ${f.message}`)];
  return {
    result: {
      outcome: outcomeOf(p.failures, p.causes), testsRun: p.testsRun, failures: p.failures, evidence: p.evidence, read: p.read, mask: null,
      reasons, receipt: p.receipt, proposals: p.proposals, tools: p.tools, smallest: p.smallest,
    },
    causes: p.causes,
  };
}
/** The mutation check's can't-fail reason: each theorem no mutant of its targets kills, or null. */
export function cantFail(theorems: { theorem: string; killed: string[]; survived: string[] }[], why = ''): string | null {
  const lines = theorems.filter((t) => !t.killed.length).map((t) => (t.survived.length
    ? `${t.theorem} still checks on every one of the ${t.survived.length} mutants of its targets`
    : `${t.theorem}: no mutant of its targets was checked${why ? ` (${why})` : ''}, so nothing shows it can fail`));
  return lines.length ? lines.join('; ') : null;
}
