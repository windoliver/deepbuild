// One proof check run (#685): the spec's runner, Lean 4 or Kani. The fault is the kit's alone: the fill the
// plug-in registers always runs with none. RUNNERS is the one place a runner's name maps to what it does (#1896): a
// name it doesn't hold is missing, for a run and for its mutants alike.
import type { CheckContext } from '@deepbuild/conformance';
import { kani, kaniMutants } from './kani.js';
import { lean, leanMutants } from './lean.js';
import { cantFail, missingRun } from './run.js';
import type { Checked, Fault, MutantReport, ProofRunner, ProofSpec } from './types.js';

interface Runner {
  check(spec: ProofSpec, ctx: CheckContext, fault: Fault): Checked;
  mutants(spec: ProofSpec, ctx: CheckContext): MutantReport;
}
const RUNNERS: Record<ProofRunner, Runner> = {
  lean4: { check: lean, mutants: leanMutants },
  kani: { check: kani, mutants: kaniMutants },
};
const runnerOf = (spec: ProofSpec): Runner | undefined => (typeof spec.runner === 'string' && Object.hasOwn(RUNNERS, spec.runner) ? RUNNERS[spec.runner] : undefined);
const unheld = (spec: ProofSpec): string => `a proof runner named ${String(spec.runner)}, which this plug-in doesn't have`;

export function check(spec: ProofSpec, ctx: CheckContext, fault: Fault = 'none'): Checked {
  return runnerOf(spec)?.check(spec, ctx, fault) ?? missingRun({}, unheld(spec));
}

/** Each theorem re-checked on mutants of its targets, by the spec's runner. */
export function mutantsOf(spec: ProofSpec, ctx: CheckContext): MutantReport {
  const runner = runnerOf(spec);
  if (runner) return runner.mutants(spec, ctx);
  const theorems = spec.theorems.map((theorem) => ({ theorem, killed: [], survived: [] }));
  return { theorems, cantFail: cantFail(theorems, unheld(spec)) };
}
