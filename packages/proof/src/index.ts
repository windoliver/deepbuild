// @deepbuild/proof: the proof check plug-in (#685). It registers kind `proof` through deep.registerCheck: a
// machine-checked proof (Lean 4 through `lake comparator`, or Kani for a Rust crate) as a check, its theorem's
// approved statement the one judged, its escapes refused, and each proof re-checked on mutants of its targets. The
// runner reports a closed run outcome, never a verdict; the core's verdict rules do the rest, with the depth
// proofDepth gives the check, the base reading runBase gives a fix, and the can't-fail reason mutants gives.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CheckContext } from '@deepbuild/conformance';
import { check } from './check.js';
import { kaniMutants } from './kani.js';
import { leanMutants } from './lean.js';
import { sources } from './run.js';
import type { MutantReport, ProofBase, ProofFill, ProofResult, ProofRunner, ProofSpec } from './types.js';

export type { MutantReport, ProofBase, ProofFill, ProofResult, ProofRunner, ProofSpec, Proposal, Statement } from './types.js';
export { proofKit } from './kit.js';

/** The proof check runner, as a check.kind@1 fill. It answers synchronously, as the core's command runner does. */
export function proofFill(): ProofFill {
  return { slot: 'check.kind@1', revision: 1, kind: 'proof', run: (spec, ctx) => check(spec, ctx).result };
}

/** The plug-in: registers kind `proof`. */
export default function register(deep: { registerCheck(type: string, runner: (spec: ProofSpec, ctx: CheckContext) => ProofResult | Promise<ProofResult>): void }): void {
  const fill = proofFill();
  deep.registerCheck('proof', (spec, ctx) => fill.run(spec, ctx));
}

/**
 * A fix's base run, on the base checkout the core builds (the claim's proof files, the merge base's code). It proves
 * the fix only when the checker refused a theorem's own obligation there; a base that failed anywhere else failed
 * before its obligation.
 */
export async function runBase(spec: ProofSpec, ctx: CheckContext): Promise<ProofBase> {
  const r = check(spec, ctx).result;
  if (r.outcome === 'passed') return { base: { outcome: 'passed', on_assertion: false, failed_tests: [] }, reason: 'passed on the base, so the base refuses no obligation', smallest: null };
  const at = r.failures.filter((f) => f.assertion && spec.theorems.includes(f.test));
  const tests = (fs: typeof at): string[] => [...new Set(fs.map((f) => f.test))];
  if (at.length) return { base: { outcome: 'failed', on_assertion: true, failed_tests: tests(at) }, reason: `the checker refused ${tests(at).join(', ')} on the base, at ${at[0]!.file}:${at[0]!.line}: ${at[0]!.message}`, smallest: r.smallest };
  const first = r.failures[0];
  const reason = first ? `failed on the base before its obligation, at ${first.file}:${first.line}: ${first.message}` : `failed on the base before its obligation: the base run was ${r.outcome} (${r.reasons.join('; ')})`;
  return { base: { outcome: 'failed', on_assertion: false, failed_tests: tests(r.failures) }, reason, smallest: null };
}

/** Each theorem re-checked on mutants of its targets; the core takes `cantFail` as the check's can't-fail reason. */
export async function mutants(spec: ProofSpec, ctx: CheckContext): Promise<MutantReport> {
  return spec.runner === 'kani' ? kaniMutants(spec, ctx) : leanMutants(spec, ctx);
}

/** A proof check counts at unit depth, for the property its theorem states about its targets, whatever its spec says. */
export function proofDepth(_spec: ProofSpec): 'unit' {
  return 'unit';
}

/**
 * The drafting job's gate: the runners whose toolchain the repo already has, a `lean-toolchain` file, or Kani
 * harnesses or `[package.metadata.kani]` in a crate. It only reads; a proof check never installs a toolchain.
 */
export function draftable(checkout: string): ProofRunner[] {
  const has = (endings: string[], pattern: RegExp): boolean => sources(checkout, endings).some((f) => pattern.test(readFileSync(join(checkout, f), 'utf8')));
  const crate = sources(checkout, ['Cargo.toml']).length > 0;
  return [
    ...(existsSync(join(checkout, 'lean-toolchain')) ? ['lean4' as const] : []),
    ...(crate && (has(['Cargo.toml'], /^\[package\.metadata\.kani[\].]/m) || has(['.rs'], /#\[kani::proof\]/)) ? ['kani' as const] : []),
  ];
}
