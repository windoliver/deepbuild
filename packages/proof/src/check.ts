// One proof check run (#685): the spec's runner, Lean 4 or Kani. The fault is the kit's alone: the fill the
// plug-in registers always runs with none.
import type { CheckContext } from '@deepbuild/conformance';
import { kani } from './kani.js';
import { lean } from './lean.js';
import { missingRun } from './run.js';
import type { Checked, Fault, ProofSpec } from './types.js';

export function check(spec: ProofSpec, ctx: CheckContext, fault: Fault = 'none'): Checked {
  if (spec.runner === 'lean4') return lean(spec, ctx, fault);
  if (spec.runner === 'kani') return kani(spec, ctx, fault);
  return missingRun(spec, `a proof runner named ${String(spec.runner)}, which this plug-in doesn't have`);
}
