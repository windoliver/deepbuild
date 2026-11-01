/-!
# The verdict table, modelled

A model of `verdict` in `packages/verdicts/src/engine.ts` (#28), at the level of the rule table in
`docs/technical-design.md`, How runs become one of five verdicts. Every rule that applies is a row; the highest by
precedence wins, per check, per requirement and for the claim. The engine never imports it; the generator in
`Vectors.lean` ties the two together on seeded claims.

## Assumptions

Each is a place where a proof about the model says nothing about the engine.

1. **Which runs count by their key is one bit per run** (`Run.counts`): the key match (check digest, environment,
   tools), retention (`kept`), and, for a run on an earlier commit, a named change that touches none of the check's
   declared inputs and no path that no check declares. Glob matching is left out. Withdrawal by a run's reads is
   modelled: `Run.commit` (0 is the claim's commit) and `Run.readsChanged`.
2. **Runs needed is an input** (`Spec.need`), `some n` with `n ≥ 1`, or `none` for every unreadable declaration.
   `runsNeeded`, its decimal arithmetic and its 65,535 cap are left out.
3. **Requirement IDs and check IDs are unique.** `isFix` reads `any` where the engine reads `find`.
4. **Evidence states form the closed set.** The engine's row for a state outside it is not modelled, since
   `EvidenceSlot['state']` excludes it at the type level.
5. **Waivers are judged per failure beforehand** (`Failure.waived`): error-text normalization, end dates,
   conditions and the approver-isn't-the-claimant rule are left out.
6. **Outcomes only.** Reasons, open items, asks, send-backs, fix tasks, smallest cases, pointers, contradictions,
   the verdict key and hashes are out of scope, and so is the count of `missing` causes: one row however many.
7. **Two records with one run ID differ when any field differs.** The engine compares whole records too, and the
   generator realizes distinct records as distinct run records.
8. **Pending results land as new runs** (`Lands`): each has an ID no earlier record holds and reads no path a
   change touched. A late run whose reads withdraw a carry changes the check's inputs instead; `late_read_stale`
   covers it.
9. **The model trusts the TypeScript shapes**: `tests_run` is a natural number and outcomes are the closed set.
   Lean's truncating subtraction stands in for `Math.max(0, …)` in `moreRuns`.
-/
namespace Verdicts

inductive Result where
  | PASS | pending | INCONCLUSIVE | BLOCKED | INVALID | FAIL
  deriving DecidableEq, Repr, Inhabited

/-- Precedence: FAIL > INVALID > BLOCKED > INCONCLUSIVE > pending > PASS. -/
def rank : Result → Nat
  | .PASS => 0 | .pending => 1 | .INCONCLUSIVE => 2 | .BLOCKED => 3 | .INVALID => 4 | .FAIL => 5

/-- The engine's `highest` step: a result replaces the one in hand only when it ranks strictly higher. -/
def Result.max (a b : Result) : Result := if rank a < rank b then b else a

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

/-- One run record. `counts`: its key matches its check, its evidence is kept, and it ran on the claim's commit
(`commit = 0`) or on an earlier one whose change touches none of the check's declared inputs. `readsChanged`: it
read a path the change from its commit touched, which withdraws every result of its check carried from there. -/
structure Run where
  id : Nat
  check : Nat
  commit : Nat
  counts : Bool
  readsChanged : Bool
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

/-- A claim's definition, checks and run records, as they arrived. `badState`: a state digest that isn't a sha256. -/
structure Claim where
  reqs : List Req
  checks : List Check
  runs : List Run
  badState : Bool
  deriving Repr

/-- The rows of the rules table: per check, per requirement, then for the claim. -/
inductive Row where
  | never_started
  | runs_needed_unreadable
  | cant_fail
  | fix_unproven_on_base
  | missing
  | ran_nothing
  | conflicting_records
  | contract_invalid
  | no_contract_report
  | runs_to_come
  | inherited
  | failed
  | flaky
  | stopped
  | all_failures_waived
  | too_few_clean_runs
  | evidence_missing_outside
  | evidence_no_digest
  | evidence_missing
  | evidence_truncated
  | waits_on_answer
  | ask_unanswered
  | answered_pass
  | answered_fail
  | no_check_at_depth
  | only_own_checks
  | covered
  | bad_state_digest
  | no_check
  | claim_only_own_checks
  deriving DecidableEq, Repr

/-- The outcome each row sets. -/
def Row.result : Row → Result
  | .never_started | .runs_to_come | .waits_on_answer => .pending
  | .runs_needed_unreadable | .missing | .inherited | .evidence_missing_outside => .BLOCKED
  | .cant_fail | .fix_unproven_on_base | .ran_nothing | .conflicting_records | .contract_invalid
  | .no_contract_report | .no_check_at_depth | .bad_state_digest | .no_check => .INVALID
  | .failed | .answered_fail => .FAIL
  | .flaky | .stopped | .all_failures_waived | .too_few_clean_runs | .evidence_no_digest | .evidence_missing
  | .evidence_truncated | .ask_unanswered | .only_own_checks | .claim_only_own_checks => .INCONCLUSIVE
  | .answered_pass | .covered => .PASS

/-- Each record once, as identical copies are one record. -/
def dedup {α} [DecidableEq α] : List α → List α
  | [] => []
  | a :: l => if a ∈ l then dedup l else a :: dedup l

/-- Another record holds this one's run ID and differs from it: neither counts. -/
def conflicted (runs : List Run) (r : Run) : Bool := runs.any (fun r' => r'.id == r.id && r' != r)

/-- A run on an earlier commit whose carried result is withdrawn: a run of its check there read a path the
change from that commit touched. -/
def withdrawn (runs : List Run) (r : Run) : Bool :=
  r.commit != 0 && runs.any (fun r' => r'.check == r.check && r'.commit == r.commit && r'.readsChanged)

/-- The records a verdict may count: none in conflict, none withdrawn. -/
def usable (runs : List Run) (r : Run) : Bool := !conflicted runs r && !withdrawn runs r

def cnt (runs : List Run) (p : Run → Bool) : Nat := (dedup runs).countP (fun r => usable runs r && p r)

/-- How a verdict reads the run records: how many usable ones satisfy a test, whether a check has records in
conflict, and whether a check has a result withdrawn by its reads. -/
structure Counter where
  k : (Run → Bool) → Nat
  conflict : Nat → Bool
  withdraws : Nat → Bool

/-- A run of check `s` whose key counts and that satisfies `p`. -/
def mine (s : Spec) (p : Run → Bool) (r : Run) : Bool :=
  r.check == s.id && r.counts && r.outcome != .uncounted && p r

def has (k : Counter) (s : Spec) (p : Run → Bool) : Bool := decide (0 < k.k (mine s p))
def count (k : Counter) (s : Spec) (p : Run → Bool) : Nat := k.k (mine s p)

/-- The reading of a claim's records. -/
def reading (runs : List Run) : Counter where
  k := cnt runs
  conflict i := runs.any (fun r => r.check == i && conflicted runs r)
  withdraws i := runs.any (fun r =>
    r.check == i && r.counts && r.outcome != .uncounted && !conflicted runs r && withdrawn runs r)

/-- A check whose carried result was withdrawn and that has no counted run on the claim's commit: its result is
stale, and it runs again there. A mark, not a row: the withdrawn runs simply don't count. -/
def isStale (k : Counter) (s : Spec) : Bool := k.withdraws s.id && !has k s (·.commit == 0)

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

def row (b : Bool) (r : Row) : List Row := if b then [r] else []

/-- Rows known from the check's declaration alone. -/
def staticRows (reqs : List Req) (s : Spec) : List Row :=
  row s.need.isNone .runs_needed_unreadable ++
  row s.cantFail .cant_fail ++
  row (isFix reqs s && !baseProves s.base) .fix_unproven_on_base

/-- Rows any counted run, or its records, can raise, even while more runs come. -/
def runRows (k : Counter) (s : Spec) : List Row :=
  row (has k s (·.outcome == .missing)) .missing ++
  row (has k s (fun r => r.outcome == .ranNothing || (r.outcome == .passed && r.tests == 0))) .ran_nothing ++
  row (k.conflict s.id) .conflicting_records ++
  row (has k s (·.contract == .invalid)) .contract_invalid ++
  row (s.contract && has k s (fun r => (r.outcome == .passed || r.outcome == .failed) && r.contract == .none))
    .no_contract_report

/- Assumption (#30): three rows the engine added for command runs are outside this model, which says nothing
about them: a test that failed and passed on its attempts within one run (INCONCLUSIVE, naming the test), a
requirement about what real users get covered by a run whose setup seeded a stand-in (INCONCLUSIVE, naming the
table), and the failing tests named on the flaky row's reason. None reads a field the generator in Vectors draws. -/
/-- Rows that judge a check once its runs end. -/
def endedRows (reqs : List Req) (k : Counter) (s : Spec) : List Row :=
  let passes := count k s isPass
  let fails := has k s isFail
  let flaky := fails && decide (0 < passes)
  let inherited := !has k s (fun r => isFail r && !onBase s (isFix reqs s) r)
  let stopped := has k s (·.outcome == .stopped)
  let unwatched := has k s waivedRun && passes == 0 && !fails
  row (fails && passes == 0 && inherited) .inherited ++
  row (fails && passes == 0 && !inherited) .failed ++
  row flaky .flaky ++
  row stopped .stopped ++
  row unwatched .all_failures_waived ++
  row (match s.need with
    | some n => !flaky && !stopped && !unwatched && decide (passes < n)
    | none => false) .too_few_clean_runs ++
  row (has k s (·.evidence.contains .missingOutside)) .evidence_missing_outside ++
  row (has k s (·.evidence.contains .noDigest)) .evidence_no_digest ++
  row (has k s (·.evidence.contains .missingInside)) .evidence_missing ++
  row (has k s (·.evidence.contains .truncated)) .evidence_truncated

def checkRows (reqs : List Req) (k : Counter) (c : Check) : List Row :=
  if c.state = .neverStarted then [.never_started]
  else staticRows reqs c.spec ++ runRows k c.spec ++
    (if running k c then [.runs_to_come] else endedRows reqs k c.spec)

def checkOutcome (reqs : List Req) (k : Counter) (c : Check) : Result :=
  top ((checkRows reqs k c).map Row.result)

def covering (checks : List Check) (q : Req) : List Check := checks.filter (·.spec.covers.contains q.id)

/-- A requirement's own row: your answer, or its coverage at its depth. -/
def reqRow (specs : List Spec) (q : Req) : Row :=
  match q.person with
  | some .open => .waits_on_answer
  | some .unanswered => .ask_unanswered
  | some .pass => .answered_pass
  | some .fail => .answered_fail
  | none =>
    let atDepth := specs.filter (fun s => s.covers.contains q.id && decide (q.depth ≤ s.depth) && (!q.numbers || s.contract))
    if atDepth.isEmpty then .no_check_at_depth
    else if atDepth.all (·.own) then .only_own_checks
    else .covered

def claimRows (cl : Claim) : List Row :=
  row cl.badState .bad_state_digest ++
  row cl.checks.isEmpty .no_check ++
  row (!cl.checks.isEmpty && cl.reqs.isEmpty && cl.checks.all (·.spec.own)) .claim_only_own_checks

def reqOutcome (cl : Claim) (k : Counter) (q : Req) : Result :=
  top ((reqRow (cl.checks.map (·.spec)) q).result :: (covering cl.checks q).map (checkOutcome cl.reqs k))

/-- The verdict as the engine rolls it up: per check, per requirement, then the claim. -/
def verdictWith (cl : Claim) (k : Counter) : Result :=
  top (cl.checks.map (checkOutcome cl.reqs k) ++ cl.reqs.map (reqOutcome cl k) ++ (claimRows cl).map Row.result)

def verdict (cl : Claim) : Result := verdictWith cl (reading cl.runs)

/-- Every row that applies anywhere in the claim. -/
def allRows (cl : Claim) (k : Counter) : List Row :=
  cl.checks.flatMap (checkRows cl.reqs k) ++ cl.reqs.map (reqRow (cl.checks.map (·.spec))) ++ claimRows cl

end Verdicts
