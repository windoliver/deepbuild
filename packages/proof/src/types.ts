// The proof check's shapes (#685): its spec (check@1's fields with the proof fields), and what its runner returns,
// check.kind@1's result with the proof's own report beside it.
import type { CheckContext, CheckResult, CheckRunnerFill, CheckSpec } from '@deepbuild/conformance';

export type ProofRunner = 'lean4' | 'kani';
/**
 * An approved statement, the bytes the definition of done holds and its hash covers: a Lean theorem's signature,
 * from `theorem <name>` up to the ` :=` before its proof, or an axiom's whole declaration; a Kani harness whole, from
 * its first attribute through its closing brace. `file` is where it lives in the checkout.
 */
export interface Statement { theorem: string; file: string; text: string }
export interface ProofSpec extends CheckSpec {
  kind: 'proof';
  runner: ProofRunner;
  /** `leanprover/lean4:v4.35.0`, or `kani 0.68.0`. */
  toolchain: string;
  /** Lean theorems by full name, or Kani harnesses by full path (`proofs::total_append`). */
  theorems: string[];
  /** The Lean axioms the check permits beside propext, Quot.sound and Classical.choice, each with its statement. */
  assumptions: string[];
  /** The code the theorems are about, as `file#symbol`. */
  targets: string[];
  /** ms. */
  deadline: number;
  statements: Statement[];
}
/** A statement the checkout holds that differs from the approved one. */
export interface Proposal { theorem: string; file: string; approved: string; written: string }
export interface ProofResult extends CheckResult {
  /** Why the run ended as it did, one line per theorem, harness or cause, each naming what it is about. */
  reasons: string[];
  receipt: string;
  proposals: Proposal[];
  /** The toolchain's version as the checker reported it, and the runner's flags. */
  tools: Record<string, string>;
  /** A failed Kani run's counterexample, as the Rust test Kani's concrete playback prints; null otherwise. */
  smallest: string | null;
}
export interface ProofFill extends CheckRunnerFill {
  kind: 'proof';
  run(spec: ProofSpec, ctx: CheckContext): ProofResult | Promise<ProofResult>;
}
/** A fix's base run, read as the verdict engine's BaseResult, with why in words and the counterexample. */
export interface ProofBase {
  base: { outcome: 'passed' | 'failed'; on_assertion: boolean; failed_tests: string[] };
  reason: string;
  smallest: string | null;
}
/** Each theorem re-checked on the mutants of its targets, each mutant by its place; and why the check can't fail, or null. */
export interface MutantReport { theorems: { theorem: string; killed: string[]; survived: string[] }[]; cantFail: string | null }

/** Why a theorem proves nothing or can't be decided, kept apart from the words so a kit can bend one cause alone. */
export interface Cause { theorem: string; why: 'escape' | 'vacuous' | 'unfound' | 'statement' | 'bound'; line: string }
/** One run: the result, and the causes its reasons came from. */
export interface Checked { result: ProofResult; causes: Cause[] }
/** How a planted runner bends the run itself: statements as the checkout wrote them, or whatever toolchain is there. */
export type Fault = 'none' | 'as-written' | 'any-version';
