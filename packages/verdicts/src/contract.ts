// Numeric contracts: a check that compares computed numbers with a reference must fail on its precision twin.
import type { ContractResult, ContractSide, NumericContract, Outputs, Precision } from './types.js';

/** Compares every element of every output with the reference; an element passes when |a − e| ≤ atol + rtol·|e|. */
function compare(contract: NumericContract, actual: Outputs, expected: Outputs): ContractSide {
  const side: ContractSide = { outcome: 'passed', failed_at: null, compared: {}, largest_error: {} };
  for (const t of contract.tolerances) {
    const a = actual[t.output] ?? [], e = expected[t.output] ?? [];
    const n = Math.min(a.length, e.length);
    // An output of another length than the reference's is wrong whatever its elements hold.
    if (a.length !== e.length) { side.outcome = 'failed'; side.failed_at = contract.assert; }
    let largest = 0;
    for (let i = 0; i < n; i++) {
      const error = Math.abs(a[i]! - e[i]!);
      // A NaN fails the comparison and is the largest error.
      if (!(error <= t.atol + t.rtol * Math.abs(e[i]!))) { side.outcome = 'failed'; side.failed_at = contract.assert; }
      if (!Number.isNaN(largest) && !(error <= largest)) largest = error;
    }
    side.compared[t.output] = n;
    side.largest_error[t.output] = largest;
  }
  return side;
}

/**
 * Runs a contract check: the code under test and the twin, the reference accumulating in the contract's narrower
 * type, each against the reference at its own precision. INVALID when the twin passes, naming its largest
 * error, or when an output's compared count is below its size, naming the output.
 */
export function runContract(contract: NumericContract, implementations: { reference: (accumulate: Precision) => Outputs; underTest: () => Outputs }): ContractResult {
  const expected = implementations.reference(contract.reference.precision);
  const run = compare(contract, implementations.underTest(), expected);
  const twin = compare(contract, implementations.reference(contract.twin.accumulate), expected);
  const reasons: string[] = [];
  if (twin.outcome === 'passed') {
    const largest = Math.max(0, ...Object.values(twin.largest_error));
    reasons.push(`the precision twin, accumulating in ${contract.twin.accumulate}, passes ${contract.assert} with largest error ${largest}, so the tolerance can't tell ${contract.accumulate} from ${contract.twin.accumulate}`);
  }
  for (const t of contract.tolerances) {
    if (run.compared[t.output]! < t.size) reasons.push(`output ${t.output}: ${run.compared[t.output]} of ${t.size} elements compared`);
  }
  return { run, twin, outcome: reasons.length ? 'INVALID' : 'counts', reasons };
}
