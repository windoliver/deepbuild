// The Kani runner (#685). It reads Kani's per-check report, never the harness's one-line verdict: a harness whose
// assumptions no input satisfies still reports SUCCESSFUL. The approved harness bytes replace what the checkout wrote;
// an escape outside the approved harness files proves nothing; a failed unwinding assertion can't decide; and a
// failed assertion's counterexample is the test Kani's concrete playback prints. cargo kani installs its bundle on
// first use, so the runner calls it only once the pinned bundle is there.
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { CheckContext, Failure } from '@deepbuild/conformance';
import {
  approve, cantFail, clock, escape, exec, finish, KANI_FLAGS, Missing, missingRun, Overran, overranRun, redact, sources, toolsOf, unfoundCause,
  versionOf, workCopy,
} from './run.js';
import type { Exec, Locate } from './run.js';
import type { Cause, Checked, Fault, MutantReport, ProofSpec } from './types.js';

/** What only the approved harness files may hold. */
const ESCAPE = /\bkani::(?:assume|requires|stub|should_panic|unwind)\b/;
/** Mutants tried per check, at most. */
const MUTANTS = 12;

type Cargo = (args: string[]) => Exec;
interface KaniCheck { name: string; status: string; description: string; file: string; line: number }
interface Report { failures: Failure[]; causes: Cause[]; smallest: string | null; ran: string[] }
interface CargoMutant { name: string; file: string; replacement: string; function?: { function_name: string }; span: Record<'start' | 'end', { line: number; column: number }> }

/** A harness's statement: from its first attribute through the brace that closes it at the fn's own indent. */
export const locateKani: Locate = (text, theorem) => {
  const lines = text.split('\n');
  const fn = lines.findIndex((l) => new RegExp(`^\\s*(?:pub(?:\\([^)]*\\))? )?fn ${escape(theorem.split('::').pop()!)}\\s*\\(`).test(l));
  if (fn < 0) return null;
  let first = fn;
  while (first > 0 && lines[first - 1]!.trim().startsWith('#[')) first--;
  const close = `${/^\s*/.exec(lines[fn]!)![0]}}`;
  const last = lines.findIndex((l, i) => i > fn && l === close);
  if (last < 0) return null;
  return { start: first ? lines.slice(0, first).join('\n').length + 1 : 0, text: lines.slice(first, last + 1).join('\n') };
};

/** The version of the cargo kani on PATH, once the pinned bundle is there; else why the machine lacks it. */
function toolchain(spec: ProofSpec, fault: Fault, cargo: Cargo): string {
  const want = versionOf(spec);
  const home = process.env.KANI_HOME || join(homedir(), '.kani');
  const any = fault === 'any-version' && existsSync(home) && readdirSync(home).some((n) => n.startsWith('kani-'));
  if (!existsSync(join(home, `kani-${want}`)) && !any) throw new Missing(`kani ${want} is not installed: KANI_HOME has no kani-${want}, and a proof check never installs one`);
  const version = /Kani Rust Verifier (\S+)/.exec(cargo(['kani', '--version']).out)?.[1] ?? 'unknown';
  if (version !== want && fault !== 'any-version') throw new Missing(`kani ${want} is not the cargo kani on PATH, which reports ${version}`);
  return version;
}

const CHECK = /^Check \d+: (\S+)\n\t - Status: (\w+)\n\t - Description: "(.*)"\n(?:\t - Location: (\S+?):(\d+):\d+)?/gm;
const unwindOf = (statement: string): string => /#\[kani::unwind\((\d+)\)\]/.exec(statement)?.[1] ?? 'Kani\'s default';

/**
 * Each harness's verdict from its own checks. An unsatisfied cover or an unreached assertion of the harness proves
 * nothing; a failed unwinding assertion can't decide; any other failed check fails the run, at the harness's
 * obligation when it is the harness's own assertion. A crate that doesn't build fails before any obligation.
 */
function report(r: Exec, harnesses: string[], spec: ProofSpec): Report {
  const parts = r.out.split(/^Checking harness (\S+)\.\.\.$/m);
  const out: Report = { failures: [], causes: [], smallest: null, ran: [] };
  const statement = (h: string): string => spec.statements.find((s) => s.theorem === h)?.text ?? '';
  if (parts.length < 2) {
    for (const m of r.out.matchAll(/^(error(?:\[E\d+\])?: .*)\n\s*--> (\S+?):(\d+):\d+/gm)) {
      const h = harnesses.find((x) => spec.statements.some((s) => s.theorem === x && s.file === m[2])) ?? harnesses[0]!;
      out.failures.push({ test: h, file: m[2]!, line: Number(m[3]), stack: null, assertion: false, message: m[1]! });
    }
    const said = r.out.split('\n').filter((l) => l.startsWith('error')).pop() ?? `cargo kani exited ${String(r.status)}`;
    if (!out.failures.length) for (const h of harnesses) out.causes.push({ theorem: h, why: 'unfound', line: `${h} was not checked by Kani: ${said}` });
    return out;
  }
  for (let i = 1; i < parts.length; i += 2) {
    const h = parts[i]!;
    const body = parts[i + 1]!;
    out.ran.push(h);
    const checks: KaniCheck[] = [...body.matchAll(CHECK)].map((m) => ({ name: m[1]!, status: m[2]!, description: m[3]!, file: m[4] ?? '', line: Number(m[5] ?? 0) }));
    const own = (c: KaniCheck): boolean => c.name.startsWith(`${h}.`);
    const place = (c: KaniCheck): string => `${c.file}:${c.line}`;
    const unreached = checks.filter((c) => own(c) && /\.(cover|assertion)\.\d+$/.test(c.name) && /^(UNREACHABLE|UNSATISFIABLE)$/.test(c.status))
      .sort((a, b) => Number(b.name.includes('.cover.')) - Number(a.name.includes('.cover.')));
    const first = unreached[0];
    if (first) out.causes.push({ theorem: h, why: 'vacuous', line: `${h} checks nothing: its ${first.name.includes('.cover.') ? 'cover' : 'assertion'} "${first.description}" at ${place(first)} is ${first.status}` });
    const unwound = checks.filter((c) => /\.unwind\.\d+$/.test(c.name) && c.status === 'FAILURE');
    for (const c of unwound) out.causes.push({ theorem: h, why: 'bound', line: `${h} can't be decided: the loop at ${place(c)} (${c.name}) needs more than the unwind bound ${unwindOf(statement(h))}` });
    for (const c of checks.filter((x) => x.status === 'FAILURE' && !unwound.includes(x))) {
      out.failures.push({ test: h, file: c.file || 'Cargo.toml', line: c.line || 1, stack: null, assertion: own(c), message: c.description });
    }
    // Kani prints a playback test for each failed check and each satisfied cover; the failed assertion's is the counterexample.
    const failed = out.failures.find((f) => f.test === h && f.assertion);
    const tests = [...body.matchAll(/^```\n(\/\/\/ Test generated[\s\S]*?\n\})$/gm)].map((m) => m[1]!);
    out.smallest ??= (failed && tests.find((t) => t.includes(`\`assertion\`: "${failed.message}"`))) ?? null;
  }
  for (const h of harnesses.filter((x) => !out.ran.includes(x))) out.causes.push({ theorem: h, why: 'unfound', line: `${h} was not found by Kani` });
  return out;
}

/** The receipt: a Kani PASS holds only within each harness's bounds, so it names them. */
function receipt(version: string, harnesses: string[], spec: ProofSpec): string {
  const bounds = harnesses.map((h) => {
    const s = spec.statements.find((x) => x.theorem === h)?.text ?? '';
    const assumed = [...s.matchAll(/kani::assume\((.*)\);/g)].map((m) => m[1]!);
    return `${h} (unwind ${unwindOf(s)}${assumed.length ? `; assuming ${assumed.join(', ')}` : ''})`;
  });
  return `Kani ${version}, bounded: it holds only for the inputs within each harness's bounds: ${bounds.join('; ') || 'no harness ran'}`;
}

/** The approved harnesses' files hold the only escapes a check permits; one anywhere else proves nothing. */
function escapes(work: string, spec: ProofSpec): Cause[] {
  const approved = new Set(spec.statements.map((s) => s.file));
  const all = spec.theorems.join(', ');
  return sources(work, ['.rs']).filter((f) => !approved.has(f)).flatMap((file) => readFileSync(join(work, file), 'utf8').split('\n').flatMap((l, i) => {
    const m = ESCAPE.exec(l);
    return m ? [{ theorem: all, why: 'escape' as const, line: `${file}:${i + 1}: ${m[0]} outside the approved harness files, so ${all} prove nothing` }] : [];
  }));
}

export function kani(spec: ProofSpec, ctx: CheckContext, fault: Fault): Checked {
  const at = clock(ctx);
  const work = workCopy(ctx.checkout);
  const cargo: Cargo = (args) => exec('cargo', args, work, process.env, at);
  try {
    const version = toolchain(spec, fault, cargo);
    const read = sources(work, ['.rs', 'Cargo.toml', 'Cargo.lock']);
    const { unfound, proposals } = approve(work, spec, locateKani, fault !== 'as-written');
    const harnesses = spec.theorems.filter((t) => !unfound.includes(t));
    const r = harnesses.length ? cargo(['kani', '--exact', ...harnesses.flatMap((h) => ['--harness', h]), ...KANI_FLAGS]) : null;
    const v = r ? report(r, harnesses, spec) : { failures: [], causes: [], smallest: null, ran: [] };
    return finish({
      testsRun: v.ran.length, failures: v.failures, causes: [...unfound.map(unfoundCause), ...escapes(work, spec), ...v.causes], proposals,
      tools: toolsOf(spec, version), read, evidence: [`kani ${version}`, ...(r ? [redact(r.out, work)] : [])], receipt: receipt(version, harnesses, spec),
      smallest: v.smallest,
    });
  } catch (error) {
    if (error instanceof Overran) return overranRun(spec, ctx.deadline);
    if (error instanceof Missing) return missingRun(spec, error.message);
    throw error;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** A cargo-mutants mutant applied: its span (1-based, end column exclusive) replaced. */
function applied(text: string, m: CargoMutant): string {
  const lines = text.split('\n');
  const at = (p: { line: number; column: number }): number => lines.slice(0, p.line - 1).join('\n').length + (p.line > 1 ? 1 : 0) + p.column - 1;
  return `${text.slice(0, at(m.span.start))}${m.replacement}${text.slice(at(m.span.end))}`;
}

/** Each harness re-checked on cargo-mutants' mutants of its targets' functions; a mutant that doesn't build tests nothing. */
export function kaniMutants(spec: ProofSpec, ctx: CheckContext): MutantReport {
  const at = clock(ctx);
  const work = workCopy(ctx.checkout);
  const cargo: Cargo = (args) => exec('cargo', args, work, process.env, at);
  const lines = spec.theorems.map((theorem) => ({ theorem, killed: [] as string[], survived: [] as string[] }));
  try {
    toolchain(spec, 'none', cargo);
    const { unfound } = approve(work, spec, locateKani, true);
    const harnesses = spec.theorems.filter((t) => !unfound.includes(t));
    const targets = spec.targets.map((t) => t.split('#') as [string, string]);
    const listed = cargo(['mutants', '--list', '--json', ...targets.flatMap(([file]) => ['--file', file])]);
    if (listed.status !== 0) throw new Missing(`cargo-mutants couldn't list the mutants: ${listed.out.trim().split('\n').pop() ?? ''}`);
    const chosen = (JSON.parse(listed.stdout) as CargoMutant[])
      .filter((m) => targets.some(([file, symbol]) => m.file === file && m.function?.function_name === symbol.split('::').pop())).slice(0, MUTANTS);
    for (const m of chosen) {
      const path = join(work, m.file);
      const original = readFileSync(path, 'utf8');
      writeFileSync(path, applied(original, m));
      try {
        const v = report(cargo(['kani', '--exact', ...harnesses.flatMap((h) => ['--harness', h])]), harnesses, spec);
        if (!v.ran.length) continue;
        for (const l of lines.filter((x) => v.ran.includes(x.theorem))) {
          const fails = v.failures.some((f) => f.test === l.theorem) || v.causes.some((c) => c.theorem === l.theorem);
          (fails ? l.killed : l.survived).push(m.name);
        }
      } finally {
        writeFileSync(path, original);
      }
    }
    return { theorems: lines, cantFail: cantFail(lines) };
  } catch (error) {
    if (error instanceof Overran) return { theorems: lines, cantFail: cantFail(lines, `past the ${ctx.deadline} ms deadline`) };
    if (error instanceof Missing) return { theorems: lines, cantFail: cantFail(lines, error.message) };
    throw error;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
