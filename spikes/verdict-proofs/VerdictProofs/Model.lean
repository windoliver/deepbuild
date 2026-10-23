/-!
# The verdict table, modelled

A model of `verdict` in `packages/verdicts/src/engine.ts` (#28), at the level of the rule table in
`docs/technical-design.md`, How runs become one of five verdicts. Every rule that applies is a row; the
highest by precedence wins, per check, per requirement and for the claim.

What the model leaves out is listed in `README.md` (Assumptions). The largest: which runs count (keys, carry,
retention) is one bit per run, `counts`, and how many clean runs a check needs is an input, `need`.
-/
namespace Verdict

inductive Result where
  | PASS | pending | INCONCLUSIVE | BLOCKED | INVALID | FAIL
  deriving DecidableEq, Repr, Inhabited

/-- Precedence: FAIL > INVALID > BLOCKED > INCONCLUSIVE > pending > PASS. -/
def Result.rank : Result → Nat
  | .PASS => 0 | .pending => 1 | .INCONCLUSIVE => 2 | .BLOCKED => 3 | .INVALID => 4 | .FAIL => 5

/-- The engine's `highest` step: a result replaces the one in hand only when it ranks strictly higher. -/
def Result.max (a b : Result) : Result := if a.rank < b.rank then b else a

/-- The highest of a list by precedence, PASS for none: the engine's `highest`. -/
def top (l : List Result) : Result := l.foldl Result.max .PASS

/-- How a run ended. `uncounted` counts neither way. -/
inductive Outcome where
  | passed | failed | ranNothing | missing | overran | stopped | uncounted
  deriving DecidableEq, Repr

/-- One evidence slot of a run. -/
inductive Evidence where
  | captured | notRequested | noDigest | missingOutside | missingInside | truncated
  deriving DecidableEq, Repr

/-- A run's numeric contract report: absent, one that counts, or one that makes the check INVALID. -/
inductive Report where
  | none | counts | invalid
  deriving DecidableEq, Repr

/-- A failed test: which test, and whether a live waiver accepts its error text. -/
structure Failure where
  test : Nat
  waived : Bool
  deriving DecidableEq, Repr

/-- One run record. `counts`: its key matches its check and it ran on the claim's commit or carries to it. -/
structure Run where
  id : Nat
  check : Nat
  counts : Bool
  outcome : Outcome
  tests : Nat
  failures : List Failure
  evidence : List Evidence
  contract : Report
  deriving DecidableEq, Repr

/-- How a check ran on the merge base: no run, passed, or failed (on a named assertion or not; which tests). -/
inductive Base where
  | none | passed
  | failed (onAssertion : Bool) (tests : List Nat)
  deriving DecidableEq, Repr

/-- `auto`: the engine decides running or ended from the runs needed. -/
inductive State where
  | auto | running | ended | neverStarted
  deriving DecidableEq, Repr

/-- What a check declares: fixed while its results land. `need`: clean runs needed, `none` when unreadable. -/
structure Spec where
  id : Nat
  own : Bool
  depth : Nat
  covers : List Nat
  need : Option Nat
  cantFail : Bool
  base : Base
  contract : Bool
  deriving DecidableEq, Repr

structure Check where
  spec : Spec
  state : State
  deriving DecidableEq, Repr

/-- A person's answer to a requirement's ask. -/
inductive Answer where
  | open | unanswered | pass | fail
  deriving DecidableEq, Repr

/-- One requirement. `person = none`: its oracle is code. `fix`: new or fixed behavior (`on_base: fails`). -/
structure Req where
  id : Nat
  depth : Nat
  person : Option Answer
  numbers : Bool
  fix : Bool
  deriving DecidableEq, Repr

/-- A claim's definition, checks and run records. `badState`: a state digest that isn't a sha256. -/
structure Claim where
  reqs : List Req
  checks : List Check
  runs : List Run
  badState : Bool
  deriving Repr

/-- One rule that applies, and its result. -/
structure Row where
  tag : String
  result : Result
  deriving DecidableEq, Repr

/-- Each record once, as the engine keeps one record per run ID. -/
def dedup {α} [DecidableEq α] : List α → List α
  | [] => []
  | a :: l => if a ∈ l then dedup l else a :: dedup l

/-- How a verdict reads the run records: how many distinct ones satisfy a test. -/
abbrev Counter := (Run → Bool) → Nat

def cnt (runs : List Run) : Counter := fun p => (dedup runs).countP p

/-- A counted run of check `s` that satisfies `p`. -/
def mine (s : Spec) (p : Run → Bool) (r : Run) : Bool :=
  r.check == s.id && r.counts && r.outcome != .uncounted && p r

def has (k : Counter) (s : Spec) (p : Run → Bool) : Bool := decide (0 < k (mine s p))
def count (k : Counter) (s : Spec) (p : Run → Bool) : Nat := k (mine s p)

/-- A fix check covers a requirement for new or fixed behavior. -/
def isFix (reqs : List Req) (s : Spec) : Bool := reqs.any (fun q => s.covers.contains q.id && q.fix)

def isPass (r : Run) : Bool := r.outcome == .passed && decide (0 < r.tests)
def waivedRun (r : Run) : Bool := r.outcome == .failed && !r.failures.isEmpty && r.failures.all (·.waived)
def isFail (r : Run) : Bool := (r.outcome == .failed || r.outcome == .overran) && !waivedRun r
def unwaived (r : Run) : List Failure := r.failures.filter (fun f => !f.waived)
/-- Every failure no waiver accepts is one the merge base shares; never for a fix check. -/
def onBase (s : Spec) (fix : Bool) (r : Run) : Bool :=
  match s.base with
  | .failed _ ts => !fix && !(unwaived r).isEmpty && (unwaived r).all (fun f => ts.contains f.test)
  | _ => false
def baseProves : Base → Bool
  | .failed true _ => true
  | _ => false

/-- `moreRuns` in `runs.ts`: how many more runs start, from the counted runs' outcomes. -/
def moreRuns (k : Counter) (s : Spec) : Nat :=
  match s.need with
  | none => 0
  | some n =>
    if has k s (fun r => r.outcome == .missing || r.outcome == .ranNothing || r.outcome == .stopped) then 0
    else
      let p := count k s (fun r => r.outcome == .passed)
      let f := count k s (fun r => r.outcome == .failed || r.outcome == .overran)
      if 0 < p && 0 < f then 0 else if 0 < f then min 3 n - f else n - p

/-- Runs still to come: declared running, or undeclared with more runs to start. -/
def running (k : Counter) (c : Check) : Bool :=
  match c.state with
  | .running => true
  | .auto => decide (0 < moreRuns k c.spec)
  | _ => false

def row (b : Bool) (tag : String) (r : Result) : List Row := if b then [⟨tag, r⟩] else []

/-- Rows known from the check's declaration alone. -/
def staticRows (reqs : List Req) (s : Spec) : List Row :=
  row s.need.isNone "runs needed unreadable" .BLOCKED ++
  row s.cantFail "can't fail" .INVALID ++
  row (isFix reqs s && !baseProves s.base) "fix not proven on the base" .INVALID

/-- Rows any counted run can raise, even while more runs come. -/
def runRows (k : Counter) (s : Spec) : List Row :=
  row (has k s (·.outcome == .missing)) "missing" .BLOCKED ++
  row (has k s (fun r => r.outcome == .ranNothing || (r.outcome == .passed && r.tests == 0))) "ran nothing" .INVALID ++
  row (has k s (·.contract == .invalid)) "contract INVALID" .INVALID ++
  row (s.contract && has k s (fun r => (r.outcome == .passed || r.outcome == .failed) && r.contract == .none))
    "no contract report" .INVALID

/-- Rows that judge a check once its runs end. -/
def endedRows (reqs : List Req) (k : Counter) (s : Spec) : List Row :=
  let passes := count k s isPass
  let fails := has k s isFail
  let flaky := fails && decide (0 < passes)
  let inherited := !has k s (fun r => isFail r && !onBase s (isFix reqs s) r)
  let stopped := has k s (·.outcome == .stopped)
  let unwatched := has k s waivedRun && passes == 0 && !fails
  row (fails && passes == 0 && inherited) "inherited from the base" .BLOCKED ++
  row (fails && passes == 0 && !inherited) "failed on every real run" .FAIL ++
  row flaky "passed and failed" .INCONCLUSIVE ++
  row stopped "stopped" .INCONCLUSIVE ++
  row unwatched "every failure waived" .INCONCLUSIVE ++
  row (match s.need with
    | some n => !flaky && !stopped && !unwatched && decide (passes < n)
    | none => false) "too few clean runs" .INCONCLUSIVE ++
  row (has k s (·.evidence.contains .missingOutside)) "evidence missing outside the code" .BLOCKED ++
  row (has k s (·.evidence.contains .noDigest)) "evidence with no digest" .INCONCLUSIVE ++
  row (has k s (·.evidence.contains .missingInside)) "evidence missing" .INCONCLUSIVE ++
  row (has k s (·.evidence.contains .truncated)) "evidence truncated" .INCONCLUSIVE

def checkRows (reqs : List Req) (k : Counter) (c : Check) : List Row :=
  if c.state = .neverStarted then [⟨"never started", .pending⟩]
  else staticRows reqs c.spec ++ runRows k c.spec ++
    (if running k c then [⟨"runs still to come", .pending⟩] else endedRows reqs k c.spec)

def checkOutcome (reqs : List Req) (k : Counter) (c : Check) : Result :=
  top ((checkRows reqs k c).map (·.result))

def covering (checks : List Check) (q : Req) : List Check := checks.filter (·.spec.covers.contains q.id)

/-- A requirement's own row: your answer, or its coverage at its depth. -/
def reqRow (specs : List Spec) (q : Req) : Row :=
  match q.person with
  | some .open => ⟨"waits on your answer", .pending⟩
  | some .unanswered => ⟨"ask ended unanswered", .INCONCLUSIVE⟩
  | some .pass => ⟨"you answered PASS", .PASS⟩
  | some .fail => ⟨"you answered FAIL", .FAIL⟩
  | none =>
    let atDepth := specs.filter (fun s => s.covers.contains q.id && decide (q.depth ≤ s.depth) && (!q.numbers || s.contract))
    if atDepth.isEmpty then ⟨"no check at its depth", .INVALID⟩
    else if atDepth.all (·.own) then ⟨"only the agent's own checks", .INCONCLUSIVE⟩
    else ⟨"covered", .PASS⟩

def claimRows (cl : Claim) : List Row :=
  row cl.badState "state digest not a sha256" .INVALID ++
  row cl.checks.isEmpty "no check selected" .INVALID ++
  row (!cl.checks.isEmpty && cl.reqs.isEmpty && cl.checks.all (·.spec.own)) "claim covered only by own checks" .INCONCLUSIVE

def reqOutcome (cl : Claim) (k : Counter) (q : Req) : Result :=
  top ((reqRow (cl.checks.map (·.spec)) q).result :: (covering cl.checks q).map (checkOutcome cl.reqs k))

/-- The verdict as the engine rolls it up: per check, per requirement, then the claim. -/
def verdictWith (cl : Claim) (k : Counter) : Result :=
  top (cl.checks.map (checkOutcome cl.reqs k) ++ cl.reqs.map (reqOutcome cl k) ++ (claimRows cl).map (·.result))

def verdict (cl : Claim) : Result := verdictWith cl (cnt cl.runs)

/-- Every row that applies anywhere in the claim. -/
def allRows (cl : Claim) (k : Counter) : List Row :=
  cl.checks.flatMap (checkRows cl.reqs k) ++ cl.reqs.map (reqRow (cl.checks.map (·.spec))) ++ claimRows cl

end Verdict
