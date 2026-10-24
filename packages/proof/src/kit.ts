// check.kind@1's kit for kind `proof` (#685), run by the conformance package's one runner. Its fixtures are a small
// Kani crate and a small Lean package, each case a spec on one of them with the run the checker gives; its seeded
// part writes a Kani crate from the draw. Each rule has one planted runner that breaks it alone: the reference's run
// with one fault, remembered, so a case the reference already ran is answered from that run.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fail, Finding } from '@deepbuild/conformance';
import type { CheckContext, Fixture, PlantedFill, Random, RunOutcome, SlotCase, SlotKitImpl, SlotRule } from '@deepbuild/conformance';
import { check } from './check.js';
import { locateKani } from './kani.js';
import { locateLean } from './lean.js';
import { outcomeOf } from './run.js';
import type { Cause, Checked, Fault, ProofFill, ProofResult, ProofSpec, Statement } from './types.js';

const SLOT = 'check.kind@1';
const FIXTURES = fileURLToPath(new URL('../fixtures/', import.meta.url));
const LEAN = 'leanprover/lean4:v4.35.0';
const KANI = 'kani 0.68.0';
/** Far past any run of a fixture; the deadline case states its own. */
const LONG = 3_600_000;
const OUTCOMES: readonly RunOutcome[] = ['passed', 'failed', 'ran_nothing', 'missing', 'overran', 'stopped', 'uncounted'];

const RULES = {
  checker: { id: 'proof-from-checker', rule: 'The outcome is the checker\'s report on each theorem, never its one-line verdict or the build\'s exit status: a harness no input reaches, or a proof resting on an escape, proves nothing.', message: 'reported a run other than the checker\'s report on each theorem', code: 'rests_on_escape' },
  found: { id: 'theorem-found', rule: 'A theorem the checker never found proves nothing; it is never passed.', message: 'reported passed for a theorem the checker never found', code: 'theorem_not_found' },
  approved: { id: 'statement-approved', rule: 'Each theorem is judged on its approved statement; a statement the checkout changed becomes a proposal naming the file.', message: 'checked the statement as the checkout wrote it instead of the approved one', code: 'statement_not_approved' },
  pinned: { id: 'toolchain-pinned', rule: 'A machine without the check\'s toolchain at its version is missing, naming the toolchain; the check never runs on another version.', message: 'ran the check on a toolchain other than the one it pins', code: 'toolchain_not_pinned' },
  obligation: { id: 'failure-at-obligation', rule: 'A failure is at an obligation only when the checker refused a theorem\'s own assertion or proof; a build that fails earlier failed before it.', message: 'marked a failure before the obligation as the obligation refused', code: 'failure_not_at_obligation' },
  deadline: { id: 'deadline-holds', rule: 'A run still going at its deadline is overran; a result after the deadline is never passed or failed.', message: 'reported a result after the deadline instead of overran', code: 'reported_after_deadline' },
} as const;
type Rule = keyof typeof RULES;
const rules: SlotRule[] = Object.values(RULES).map(({ id, rule }) => ({ id, rule }));

/** What a case expects of the result; a member left out is not held. `rule` is the one a different outcome breaks. */
interface Expected { outcome: RunOutcome; rule: Rule; proposals?: number; assertion?: 'all' | 'none' }
interface CaseInput { spec: ProofSpec; checkout: string; deadline: number }

// ---- The fixtures.

const dirOf = (runner: ProofSpec['runner']): string => (runner === 'kani' ? 'kani' : 'lean');
const spec = (runner: ProofSpec['runner'], theorem: string, file: string, target: string, statement?: string): ProofSpec => ({
  kind: 'proof', runner, toolchain: runner === 'kani' ? KANI : LEAN, inputs: [file], depth: 'unit', oracle: 'code', contract: null,
  theorems: [theorem], assumptions: [], targets: [target], deadline: LONG,
  statements: [{ theorem, file, text: statement ?? (runner === 'kani' ? locateKani : locateLean)(readFileSync(join(FIXTURES, dirOf(runner), file), 'utf8'), theorem)?.text ?? '' }],
});
const kani = (theorem: string, statement?: string): ProofSpec => spec('kani', `proofs::${theorem}`, 'src/proofs.rs', 'src/lib.rs#clamp', statement);
const lean = (theorem: string): ProofSpec => spec('lean4', `Kit.${theorem}`, 'Kit/Proofs.lean', 'Kit/Code.lean#Kit.twice');
const harness = (name: string, body: string): string => `#[kani::proof]\nfn ${name}() {\n    let value: u8 = kani::any();\n    kani::cover!(value > 0, "a value above zero");\n    ${body}\n}`;
const fixture = (id: string, s: ProofSpec, expected: Expected, deadline = LONG): Fixture =>
  ({ id, input: { spec: { ...s, deadline }, checkout: join(FIXTURES, dirOf(s.runner)), deadline } as unknown as Fixture['input'], expected: expected as unknown as Fixture['input'] });

// In the order the preflight's check meets them, so each planted runner is refused at its own case first; the slow
// Lean cases come last, where only the reference reaches them.
const fixtures = (): Fixture[] => [
  fixture('kani-proved', kani('clamp_within'), { outcome: 'passed', rule: 'checker', proposals: 0 }),
  fixture('kani-unfound-theorem', kani('clamp_vanished', harness('clamp_vanished', 'assert!(clamp(value, 0, 255) == value);')), { outcome: 'ran_nothing', rule: 'found' }),
  fixture('kani-unreached-cover', kani('clamp_never'), { outcome: 'ran_nothing', rule: 'checker' }),
  fixture('kani-weakened', kani('clamp_exact', harness('clamp_exact', 'assert!(clamp(value, 10, 20) == value);')), { outcome: 'failed', rule: 'approved', proposals: 1, assertion: 'all' }),
  fixture('kani-before-obligation', kani('clamp_exact', harness('clamp_exact', 'assert!(crate::clamp_wide(value, 0, 255) == value);')), { outcome: 'failed', rule: 'obligation', assertion: 'none' }),
  fixture('kani-other-version', { ...kani('clamp_within'), toolchain: 'kani 0.0.1' }, { outcome: 'missing', rule: 'pinned' }),
  fixture('kani-past-deadline', kani('clamp_within'), { outcome: 'overran', rule: 'deadline' }, 1),
  fixture('lean-proved', lean('twice_eq'), { outcome: 'passed', rule: 'checker', proposals: 0 }),
  fixture('lean-sorry', lean('twice_sorry'), { outcome: 'ran_nothing', rule: 'checker' }),
];

// ---- The seeded part: a Kani crate written from the draw, one harness that verifies and one no input reaches.

interface Seeded { name: string; k: number; vacuous: boolean }
function generate(random: Random): SlotCase[] {
  const name = Array.from({ length: 6 }, () => 'abcdefghijklmnopqrstuvwxyz'[random.int(0, 25)]).join('');
  const k = random.int(1, 9);
  return [false, true].map((vacuous, i) => ({
    id: `seeded-${i + 1}`, part: 'seeded', input: { name, k, vacuous } as unknown as Fixture['input'],
    expected: { outcome: vacuous ? 'ran_nothing' : 'passed', rule: 'checker' } as unknown as Fixture['input'],
  }));
}
function materialize(s: Seeded): { input: CaseInput; cleanup(): void } {
  const dir = mkdtempSync(join(tmpdir(), 'deep-proof-seeded-'));
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'Cargo.toml'), readFileSync(join(FIXTURES, 'kani', 'Cargo.toml'), 'utf8').replace('name = "kit"', 'name = "seeded"'));
  writeFileSync(join(dir, 'src', 'lib.rs'), `#[cfg(kani)]\nmod proofs;\n\npub fn f_${s.name}(x: u8) -> u16 {\n    x as u16 + ${s.k}\n}\n`);
  const text = `#[kani::proof]\nfn ${s.name}_holds() {\n    let x: u8 = kani::any();\n${s.vacuous ? '    kani::assume(x > 200 && x < 100);\n' : ''}    kani::cover!(x > 0, "a nonzero input");\n    assert!(crate::f_${s.name}(x) >= ${s.k});\n}`;
  writeFileSync(join(dir, 'src', 'proofs.rs'), `${text}\n`);
  const theorem = `proofs::${s.name}_holds`;
  const statements: Statement[] = [{ theorem, file: 'src/proofs.rs', text }];
  const spec: ProofSpec = { ...kani('clamp_within'), theorems: [theorem], targets: [`src/lib.rs#f_${s.name}`], statements };
  return { input: { spec, checkout: dir, deadline: LONG }, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

// ---- The judge.

const grace = (deadline: number): number => Math.max(100, deadline);
const object = (what: string, value: unknown): Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Finding('FAIL', `${what} is not an object`, ['type']);
  return value as Record<string, unknown>;
};
const lines = (what: string, value: unknown): string[] => {
  if (!Array.isArray(value) || value.some((l) => typeof l !== 'string')) throw new Finding('FAIL', `${what} is not a list of lines`, ['type']);
  return value as string[];
};
const broke = (rule: Rule, detail: string, code: string = RULES[rule].code): Finding => fail(RULES[rule].message, [code], detail);

function hold(answer: unknown, ex: Expected, spec: ProofSpec, deadline: number, elapsed: number): void {
  const r = object('the result', answer);
  if ('verdict' in r) throw new Finding('FAIL', 'the result carries a verdict; a runner reports a run outcome and the core matches it to a verdict', ['unlisted_field']);
  if (!OUTCOMES.includes(r.outcome as RunOutcome)) throw new Finding('FAIL', `outcome ${JSON.stringify(r.outcome)} is not one of the run outcomes`, ['enum']);
  if (!Number.isInteger(r.testsRun) || (r.testsRun as number) < 0) throw new Finding('FAIL', `testsRun ${JSON.stringify(r.testsRun)} is not a count`, ['type']);
  if (!Array.isArray(r.failures) || !Array.isArray(r.proposals)) throw new Finding('FAIL', 'failures or proposals is not a list', ['type']);
  const failures = r.failures.map((f, i) => {
    const o = object(`failures/${i}`, f);
    if (typeof o.file !== 'string' || !o.file || !Number.isInteger(o.line) || (o.line as number) < 1) throw new Finding('FAIL', `failures/${i} names no file and line`, ['type']);
    if (typeof o.assertion !== 'boolean' || typeof o.test !== 'string' || typeof o.message !== 'string') throw new Finding('FAIL', `failures/${i} lacks its test, message or assertion`, ['type']);
    return o;
  });
  const reasons = lines('reasons', r.reasons);
  if (typeof r.receipt !== 'string' || (r.smallest !== null && typeof r.smallest !== 'string')) throw new Finding('FAIL', 'the receipt or the counterexample is not text', ['type']);
  object('tools', r.tools);

  const outcome = r.outcome as RunOutcome;
  if (elapsed > deadline + grace(deadline) && outcome !== 'overran') throw broke('deadline', `reported ${outcome} ${elapsed} ms in, past the ${deadline} ms deadline`);
  if (outcome === 'missing' && ex.outcome !== 'missing') throw new Finding('BLOCKED', `this machine can't run the case: ${reasons.join('; ')}`, []);
  if (outcome !== ex.outcome) throw broke(ex.rule, `reported ${outcome}; the checker's run is ${ex.outcome}`);
  const short = (t: string): string => t.split(/::|\./).pop()!;
  if (outcome === 'ran_nothing') for (const t of spec.theorems) if (!reasons.some((l) => l.includes(short(t)))) throw broke(ex.rule, `no reason names ${t}`);
  if (outcome === 'missing' && !reasons.some((l) => l.includes(spec.toolchain))) throw broke('pinned', `no reason names ${spec.toolchain}`);
  if (ex.proposals !== undefined && r.proposals.length !== ex.proposals) throw broke('approved', `${r.proposals.length} proposals; the checkout differs from the approved statements in ${ex.proposals}`);
  if (ex.assertion === 'all' && (!failures.length || failures.some((f) => !f.assertion))) throw broke('obligation', 'a failure at the theorem\'s obligation is not marked as one', 'obligation_unmarked');
  if (ex.assertion === 'none' && failures.some((f) => f.assertion)) throw broke('obligation', `${failures.filter((f) => f.assertion).map((f) => `${String(f.file)}:${String(f.line)}`).join(', ')} failed before any obligation`);
}

function* judge(fill: ProofFill, c: SlotCase): Generator<() => unknown, void, unknown> {
  const made = c.part === 'seeded' ? materialize(c.input as unknown as Seeded) : { input: c.input as unknown as CaseInput, cleanup: () => {} };
  try {
    const { spec, checkout, deadline } = made.input;
    const started = Date.now();
    const answer = yield () => fill.run(spec, { checkout, deadline, now: () => Date.now() });
    hold(answer, c.expected as unknown as Expected, spec, deadline, Date.now() - started);
  } finally {
    made.cleanup();
  }
}

// ---- The reference and the planted runners.

type Run = (spec: ProofSpec, ctx: CheckContext, fault?: Fault) => Checked;
/** Every file's path and bytes under a checkout, build output left out: a run stands for the same tree only. */
function snapshot(dir: string): string {
  const hash = createHash('sha256');
  const walk = (d: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      if (e.name === '.lake' || e.name === 'target') continue;
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile()) hash.update(`${relative(dir, p).split(sep).join('/')}\0`).update(readFileSync(p)).update('\0');
    }
  };
  walk(dir);
  return hash.digest('hex');
}
/** One kit's runs, remembered by fault, spec and tree, under a deadline the run would end the same under. */
function remembered(): Run {
  const runs = new Map<string, { deadline: number; checked: Checked }>();
  return (spec, ctx, fault = 'none') => {
    if (!existsSync(ctx.checkout)) return check(spec, ctx, fault);
    const key = `${fault}\n${snapshot(ctx.checkout)}\n${JSON.stringify(spec)}`;
    const had = runs.get(key);
    if (had && (had.checked.result.outcome === 'overran' ? ctx.deadline <= had.deadline : ctx.deadline >= had.deadline)) return structuredClone(had.checked);
    const checked = check(spec, ctx, fault);
    runs.set(key, { deadline: ctx.deadline, checked: structuredClone(checked) });
    return checked;
  };
}

const reference = (run: Run): ProofFill => ({ slot: SLOT, revision: 1, kind: 'proof', run: (spec, ctx) => run(spec, ctx).result });
/** The reference's result with some causes dropped, its outcome as the rest decide it. */
function without(c: Checked, drop: Cause['why'][]): ProofResult {
  const causes = c.causes.filter((x) => !drop.includes(x.why));
  const r = c.result;
  const ran = r.outcome === 'passed' || r.outcome === 'failed' || r.outcome === 'ran_nothing' || r.outcome === 'stopped';
  const dropped = new Set(c.causes.filter((x) => drop.includes(x.why)).map((x) => x.line));
  return { ...r, outcome: ran ? outcomeOf(r.failures, causes) : r.outcome, reasons: r.reasons.filter((l) => !dropped.has(l)), testsRun: ran ? r.testsRun || 1 : r.testsRun };
}
const plant = (name: string, breaks: Rule, fill: ProofFill): PlantedFill<ProofFill> =>
  ({ name, message: RULES[breaks].message, codes: [RULES[breaks].code], breaks: RULES[breaks].id, fill });
function plantedFills(run: Run): PlantedFill<ProofFill>[] {
  const bent = (f: (spec: ProofSpec, ctx: CheckContext) => ProofResult): ProofFill => ({ ...reference(run), run: f });
  return [
    plant('reads-success-line', 'checker', bent((spec, ctx) => without(run(spec, ctx), ['escape', 'vacuous']))),
    plant('unfound-theorem', 'found', bent((spec, ctx) => without(run(spec, ctx), ['unfound']))),
    plant('checks-as-written', 'approved', bent((spec, ctx) => run(spec, ctx, 'as-written').result)),
    plant('any-version', 'pinned', bent((spec, ctx) => run(spec, ctx, 'any-version').result)),
    plant('every-failure-an-obligation', 'obligation', bent((spec, ctx) => {
      const r = run(spec, ctx).result;
      return { ...r, failures: r.failures.map((f) => ({ ...f, assertion: true })) };
    })),
    plant('past-deadline', 'deadline', bent((spec, ctx) => run(spec, { ...ctx, deadline: LONG }).result)),
  ];
}

/** check.kind@1's kit for kind `proof`. */
export function proofKit(): SlotKitImpl<ProofFill> {
  const run = remembered();
  return { slot: SLOT, fills: 'one', revision: 1, rules, fixtures: fixtures(), planted: plantedFills(run), clean: () => [reference(run)], generate, judge };
}
