// Shared test-side tools for the #685 acceptance tests: the fixtures' checkouts and approved statements, the
// toolchain environment, the plug-in (imported lazily, so each test fails on its own at the base), the core's
// verdict over one proof check's run, and the wrong programs the criteria name. None of them stands in for the
// plug-in, and none for the checkers: every run here is the real Lean, Kani or cargo-mutants.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import { verdict } from '../../../packages/verdicts/src/index.ts';
import type { BaseResult, ClaimCheck, ClaimInput, Depth, Requirement, Run, Verdict } from '../../../packages/verdicts/src/index.ts';
import type { CheckContext } from '../../../packages/conformance/src/index.ts';
import type { MutantReport, ProofResult, ProofSpec, Statement } from '../../../packages/proof/src/index.ts';

// ---- The plug-in, reached only through its public entry, imported when a test first needs it.

type Plugin = typeof import('../../../packages/proof/src/index.ts');
export const plugin = (): Promise<Plugin> => import('../../../packages/proof/src/index.ts');

// ---- The toolchains, real and pinned (README, Environment).

export const LEAN_VERSION = '4.35.0';
export const LEAN_TOOLCHAIN = `leanprover/lean4:v${LEAN_VERSION}`;
export const KANI_VERSION = '0.68.0';
export const KANI_TOOLCHAIN = `kani ${KANI_VERSION}`;
/** A Lean check builds, exports twice (about 330 MB each) and runs comparator: minutes, not seconds. */
export const LEAN_DEADLINE = 900_000;
export const KANI_DEADLINE = 600_000;
/** Vitest's limits for a test that runs Lean or Kani, past every run it may wait on. */
export const LEAN_TEST = 1_800_000;
export const KANI_TEST = 900_000;

const onPath = (program: string): string | null => {
  for (const dir of (process.env.PATH ?? '').split(delimiter).filter(Boolean)) if (existsSync(join(dir, program))) return join(dir, program);
  return null;
};
const SETUP = 'README, Environment';
/** Throws, naming the toolchain and where the README says it lives, when this environment lacks Lean 4.35. */
export function requireLean(): void {
  const elan = process.env.ELAN_HOME;
  if (!elan) throw new Error(`the Lean toolchain ${LEAN_TOOLCHAIN} isn't in this environment: ELAN_HOME is unset (${SETUP})`);
  const bin = join(elan, 'toolchains', `leanprover--lean4---v${LEAN_VERSION}`, 'bin');
  for (const exe of ['lake', 'lean', 'leanexport']) {
    if (!existsSync(join(bin, exe))) throw new Error(`the Lean toolchain ${LEAN_TOOLCHAIN} isn't in this environment: no ${exe} in ${bin} (${SETUP})`);
  }
  if (!onPath('lake')) throw new Error(`the Lean toolchain ${LEAN_TOOLCHAIN} isn't on PATH: put $ELAN_HOME/bin on it (${SETUP})`);
}
/** Throws, naming the toolchain, when this environment lacks Kani 0.68.0. */
export function requireKani(): void {
  if (!process.env.KANI_HOME) throw new Error(`the Kani toolchain ${KANI_TOOLCHAIN} isn't in this environment: KANI_HOME is unset (${SETUP})`);
  if (!onPath('cargo-kani')) throw new Error(`the Kani toolchain ${KANI_TOOLCHAIN} isn't on PATH: no cargo-kani (${SETUP})`);
  const version = spawnSync('cargo', ['kani', '--version'], { encoding: 'utf8' });
  if (!`${version.stdout}`.includes(KANI_VERSION)) throw new Error(`the Kani toolchain ${KANI_TOOLCHAIN} isn't the one on PATH: cargo kani --version says ${JSON.stringify(`${version.stdout}${version.stderr}`.trim())} (${SETUP})`);
}
/** Throws, naming the tool, when cargo-mutants 27.1.0 isn't on PATH. */
export function requireMutants(): void {
  if (!onPath('cargo-mutants')) throw new Error(`cargo-mutants 27.1.0 isn't on PATH (${SETUP})`);
}

/** Runs a program in `cwd` with this process's environment; status null when it couldn't start or timed out. */
export function sh(program: string, args: string[], cwd: string, timeout = 900_000): { status: number | null; output: string } {
  const r = spawnSync(program, args, { cwd, encoding: 'utf8', timeout, maxBuffer: 256 * 1024 * 1024 });
  return { status: r.status, output: `${r.stdout ?? ''}${r.stderr ?? ''}${r.error ? `\n${r.error.message}` : ''}` };
}
export const sha256 = (bytes: Buffer | string): string => createHash('sha256').update(bytes).digest('hex');

// ---- The fixtures, each run in a fresh temporary checkout as the core runs a check (#30).

export const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
export type Fixture = 'lean' | 'kani' | 'kani-metadata' | 'bare';
const made: string[] = [];
/**
 * A temporary checkout of a fixture with its variants laid over it in order, each variant a folder of files under
 * `fixtures/<fixture>-variants/` that replace the fixture's own. `checkout('kani', ['base'])` is a fix's base
 * checkout: the merge base's code (`kani-variants/base/src/lib.rs`) with the claim's proof files.
 */
export function checkout(fixture: Fixture, variants: string[] = []): string {
  const dir = mkdtempSync(join(tmpdir(), `deep-685-${fixture}-`));
  cpSync(join(FIXTURES, fixture), dir, { recursive: true });
  for (const v of variants) cpSync(join(FIXTURES, `${fixture}-variants`, v), dir, { recursive: true });
  made.push(dir);
  return dir;
}
/** Removes every temporary checkout this file made, with what the runs built in it. */
export function cleanup(): void {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}
export const read = (dir: string, file: string): string => readFileSync(join(dir, file), 'utf8');
/** The 1-based line of the first line of `file` in `dir` that contains `text`. */
export function lineOf(dir: string, file: string, text: string): number {
  const i = read(dir, file).split('\n').findIndex((l) => l.includes(text));
  if (i < 0) throw new Error(`${file} has no line with ${text}`);
  return i + 1;
}

// ---- The approved statements, as the locked definition of done holds their bytes.

/**
 * A Lean theorem's statement as the definition holds it: its signature, from `theorem <name>` up to the ` :=` that
 * opens its proof; an axiom's, its whole declaration. Read from the fixture's own file unless `root` names another.
 */
export function leanStatement(theorem: string, root = join(FIXTURES, 'lean'), file = 'Fixture/Proofs.lean'): Statement {
  const text = read(root, file);
  const at = text.search(new RegExp(`^(theorem|axiom) ${theorem.replace(/\./g, '\\.')} `, 'm'));
  if (at < 0) throw new Error(`${file} declares no ${theorem}`);
  const rest = text.slice(at);
  const end = rest.startsWith('axiom') ? rest.indexOf('\n') : rest.indexOf(' :=');
  return { theorem, file, text: rest.slice(0, end) };
}
/** A Kani harness's statement: the whole harness, from `#[kani::proof]` through the brace closing it. */
export function kaniStatement(theorem: string, root = join(FIXTURES, 'kani'), file = 'src/proofs.rs'): Statement {
  const lines = read(root, file).split('\n');
  const fn = lines.findIndex((l) => l.startsWith(`fn ${theorem.split('::').pop()}(`));
  if (fn < 0) throw new Error(`${file} has no harness ${theorem}`);
  let start = fn;
  while (start > 0 && lines[start - 1]!.startsWith('#[')) start--;
  const end = lines.findIndex((l, i) => i > fn && l === '}');
  return { theorem, file, text: lines.slice(start, end + 1).join('\n') };
}

/** A Lean proof check on the fixture: `total` is the target, the theorems' statements are the fixture's. */
export function leanSpec(theorems: string[], over: Partial<ProofSpec> = {}): ProofSpec {
  return {
    kind: 'proof', runner: 'lean4', toolchain: LEAN_TOOLCHAIN, theorems, assumptions: [], targets: ['Fixture/Total.lean#total'],
    deadline: LEAN_DEADLINE, inputs: ['Fixture/Total.lean', 'Fixture/Proofs.lean'], depth: 'unit', oracle: 'code', contract: null,
    statements: theorems.map((t) => leanStatement(t)), ...over,
  };
}
/** A Kani proof check on the fixture crate: `total` is the target, the harnesses are named in full (`proofs::…`). */
export function kaniSpec(theorems: string[], over: Partial<ProofSpec> = {}, root = join(FIXTURES, 'kani')): ProofSpec {
  return {
    kind: 'proof', runner: 'kani', toolchain: KANI_TOOLCHAIN, theorems, assumptions: [], targets: ['src/lib.rs#total'],
    deadline: KANI_DEADLINE, inputs: ['src/lib.rs', 'src/proofs.rs'], depth: 'unit', oracle: 'code', contract: null,
    statements: theorems.map((t) => kaniStatement(t, root)), ...over,
  };
}
export const context = (dir: string, deadline: number): CheckContext => ({ checkout: dir, deadline, now: () => Date.now() });

/** One run of the plug-in's proof runner on a checkout; it fails first on a missing plug-in, then on a missing toolchain. */
export async function runProof(spec: ProofSpec, dir: string): Promise<ProofResult> {
  const { proofFill } = await plugin();
  if (spec.runner === 'lean4') requireLean(); else requireKani();
  return await proofFill().run(spec, context(dir, spec.deadline));
}
/** A run started once and shared by every test that reads it. */
export function once<T>(make: () => Promise<T>): () => Promise<T> {
  let made: Promise<T> | undefined;
  return () => (made ??= make());
}

// ---- The core's verdict on a claim one proof check covers.

const T0 = Date.UTC(2026, 9, 23, 12, 0, 0);
export const HEAD = 'c0ffee'.padEnd(40, '0');
export const REQ = 'req:685#R1';
const ENV = { os: 'darwin-arm64' };

/** The run record the hub keeps for a runner's result (#30's recording isn't at this base): its fields, copied. */
export function runRecord(result: ProofResult, check = 'proof', over: Partial<Run> = {}): Run {
  return {
    run: `run:${check.replace(/[^0-9A-Za-z]/g, '')}`, check, claim: 'claim:685', commit: HEAD, digest: `d1:${sha256(check)}`,
    environment: { ...ENV }, tools: { ...result.tools }, outcome: result.outcome, started: T0, ended: T0 + 1, tests_run: result.testsRun,
    reads: [...result.read],
    failures: result.failures.map((f) => ({ test: f.test, message: f.message, cause: 'change:proof', frames: [{ file: f.file, line: f.line }], covers: [], case: result.smallest })),
    evidence: [], kept: true,
    ...(result.outcome === 'missing' ? { missing: { cause: result.reasons.join('; '), owner: 'you', since: T0 } } : {}),
    ...over,
  };
}
export function claimCheck(check: string, tools: Record<string, string>, over: Partial<ClaimCheck> = {}): ClaimCheck {
  return { check, digest: `d1:${sha256(check)}`, source: 'definition', depth: 'unit', proof: 'static_check', covers: [REQ], environment: { ...ENV }, tools: { ...tools }, ...over };
}
export function claim(checks: ClaimCheck[], runs: Run[], requirement: Partial<Requirement> = {}): ClaimInput {
  return {
    claim: 'claim:685', agent: 'session:agent', repo: 'repo:fixture', task: 'task:685', commit: HEAD,
    requirements: [{ req: REQ, depth: 'unit', oracle: 'code', on_base: 'passes', ...requirement }],
    checks, runs, changes: [], waivers: [], now: T0 + 2,
  };
}
export interface Judging { depth?: Depth; requirement?: Partial<Requirement>; base?: BaseResult; cantFail?: string | null }
/** The core's verdict on a claim whose one requirement one proof check covers, from that check's one run. */
export function judge(result: ProofResult, j: Judging = {}): Verdict {
  const c = claimCheck('proof', result.tools, {
    depth: j.depth ?? 'unit', ...(j.base ? { base: j.base } : {}), ...(j.cantFail ? { cant_fail: j.cantFail } : {}),
  });
  return verdict(claim([c], [runRecord(result)], j.requirement));
}

// ---- The assertions the criteria make, shared by the plug-in and the wrong programs fed to them.

type Name = string | RegExp;
const has = (line: string, n: Name): boolean => (typeof n === 'string' ? line.includes(n) : n.test(line));
const shown = (r: ProofResult): string => `run ${r.outcome}; reasons: ${r.reasons.join(' | ') || '(none)'}; receipt: ${r.receipt}`;
/** One reason line of the run that names every one of `names`, or undefined. */
export const naming = (r: ProofResult, names: Name[]): string | undefined => r.reasons.find((line) => names.every((n) => has(line, n)));
/** The core's verdict on the run is `outcome`, and one line of the run's reasons names each of `names`. */
export function expectVerdictNaming(r: ProofResult, outcome: Verdict['outcome'], names: Name[], label: string, j: Judging = {}): Verdict {
  const v = judge(r, j);
  expect(v.outcome, `${label}: the core's verdict (${shown(r)})`).toBe(outcome);
  expect(naming(r, names), `${label}: a reason names ${names.map(String).join(' and ')} (${shown(r)})`).toBeDefined();
  return v;
}

/**
 * AC7's INVALID: the mutation check says the check can't fail, naming `theorem`, and the core, given that as the
 * check's `cant_fail`, makes a claim the check covers INVALID, naming the theorem.
 */
export function expectCantFail(run: ProofResult, report: MutantReport, theorem: string, label: string): void {
  expect(report.cantFail ?? '', `${label}: the mutation check names ${theorem} as one that can't fail`).toContain(theorem);
  const v = judge(run, { cantFail: report.cantFail });
  expect(v.outcome, `${label}: the core's verdict`).toBe('INVALID');
  expect(v.reasons.some((line) => line.includes(theorem)), `${label}: the verdict names ${theorem}: ${v.reasons.join(' | ')}`).toBe(true);
}
/** One theorem's line of a mutation report. */
export function mutantsOf(report: MutantReport, theorem: string): { killed: string[]; survived: string[] } {
  const line = report.theorems.find((t) => t.theorem === theorem);
  if (!line) throw new Error(`the mutation report has no line for ${theorem}: ${JSON.stringify(report.theorems.map((t) => t.theorem))}`);
  return line;
}

// ---- The wrong programs the criteria name, each a real runner a careless plug-in could be.

const plain = (spec: ProofSpec, outcome: ProofResult['outcome'], receipt: string): ProofResult => ({
  outcome, testsRun: spec.theorems.length, failures: [], evidence: [], read: [], mask: null, reasons: [], receipt, proposals: [], tools: {}, smallest: null,
});
/** AC1's wrong program: a runner that reads `lake build`'s exit status as the result. */
export function lakeBuildRunner(spec: ProofSpec, ctx: CheckContext): ProofResult {
  const r = sh('lake', ['build'], ctx.checkout);
  return plain(spec, r.status === 0 ? 'passed' : 'failed', `lake build exited ${r.status}`);
}
/** AC4's wrong program: a runner that reads only Kani's `VERIFICATION:- SUCCESSFUL` line for each harness. */
export function successLineRunner(spec: ProofSpec, ctx: CheckContext): ProofResult {
  const all = spec.theorems.every((h) => sh('cargo', ['kani', '--harness', h, '--exact'], ctx.checkout).output.includes('VERIFICATION:- SUCCESSFUL'));
  return plain(spec, all ? 'passed' : 'failed', `VERIFICATION:- ${all ? 'SUCCESSFUL' : 'FAILED'}`);
}

/**
 * Replays a Kani concrete-playback test the way Kani's own playback runs it: appended to the harness file of `dir`
 * and run by name with `cargo kani playback`. Returns the exit status, the output and the test's name.
 */
export function replay(dir: string, test: string): { status: number | null; output: string; name: string } {
  const name = /fn (kani_concrete_playback_\w+)/.exec(test)?.[1];
  if (!name) throw new Error(`the smallest failing case is not a concrete-playback test: ${test.slice(0, 200)}`);
  appendFileSync(join(dir, 'src', 'proofs.rs'), `\n${test}\n`);
  return { ...sh('cargo', ['kani', 'playback', '-Z', 'concrete-playback', '--', name], dir), name };
}
