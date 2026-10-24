import Verdicts
/-!
# Seeded claims from the model

`lake exe vectors <seed> <count>` prints a header line and then one JSON line per generated claim: the claim as a
`ClaimInput` of `@deepbuild/verdicts`, the model's verdict, each check's and each requirement's outcome, and the rows
that applied. The engine must equal the model on every one (`tests/acceptance/684`). Each abstract field is
realized the way the engine reads it; distinct abstract records give distinct run records.
-/
namespace Verdicts

deriving instance Inhabited for Answer, State, Evidence, Report, Outcome, Failure, Run, Row

/-- splitmix64. -/
structure Rng where
  s : UInt64

def Rng.next (g : Rng) : UInt64 × Rng :=
  let s := g.s + 0x9E3779B97F4A7C15
  let z := (s ^^^ (s >>> 30)) * 0xBF58476D1CE4E5B9
  let z := (z ^^^ (z >>> 27)) * 0x94D049BB133111EB
  (z ^^^ (z >>> 31), ⟨s⟩)

abbrev Gen := StateM Rng

/-- A whole number below `n`. -/
def below (n : Nat) : Gen Nat := do
  let (x, g) := (← get).next
  set g
  return x.toNat % n

/-- True with probability `p` percent. -/
def chance (p : Nat) : Gen Bool := return (← below 100) < p

def pick {α} [Inhabited α] (l : List α) : Gen α := return l[← below l.length]!

def genAnswer : Gen Answer := pick [.open, .unanswered, .pass, .fail]

def genReq (clean : Bool) (id : Nat) : Gen Req := do
  let depth ← if clean then below 2 else below 4
  let person ← if ← chance (if clean then 5 else 15) then some <$> genAnswer else pure none
  return { id, depth, person, numbers := ← chance (if clean then 3 else 15), fix := ← chance 40 }

def subset (l : List Nat) (p : Nat) : Gen (List Nat) := l.filterM fun _ => chance p

def genBase (clean : Bool) : Gen Base := do
  let r ← below 100
  if r < (if clean then 3 else 30) then return .none
  if r < (if clean then 6 else 45) then return .passed
  return .failed (← chance (if clean then 97 else 85)) (← subset [0, 1, 2] 45)

def genSpec (clean : Bool) (id : Nat) (reqIds : List Nat) : Gen Spec := do
  let covers ← subset reqIds (if clean then 90 else 60)
  let covers := if ← chance 5 then covers ++ [99] else covers
  let need ← if ← chance (if clean then 1 else 8) then pure none else (if ← chance 50 then pure (some 1) else some <$> (· + 1) <$> below 3)
  return { id, own := ← chance (if clean then 10 else 25), depth := ← (if clean then (· + 1) <$> below 3 else below 4), covers, need,
           cantFail := ← chance (if clean then 1 else 6), base := ← genBase clean,
           contract := ← chance 15 }

def genEvidence (clean : Bool) : Gen Evidence := do
  let r ← below 100
  if r < (if clean then 96 else 75) then return .captured
  if r < 80 then return .notRequested
  if r < 84 then return .noDigest
  if r < 89 then return .missingOutside
  if r < 94 then return .missingInside
  return .truncated

def genOutcome (clean : Bool) : Gen Outcome := do
  let r ← below 100
  if r < (if clean then 88 else 40) then return .passed
  if r < 65 then return .failed
  if r < 70 then return .ranNothing
  if r < 76 then return .missing
  if r < 82 then return .overran
  if r < 88 then return .stopped
  return .uncounted

def genFailures (n : Nat) : Gen (List Failure) := do
  let mut out := []
  for _ in [0:n] do
    out := out ++ [{ test := ← below 3, waived := ← chance 25 }]
  return out

/-- A run. `shared`: the claim has another check, so the change from an earlier commit can touch a path that
check declares and this one doesn't, and this run can read it. -/
def genRun (clean shared : Bool) (id check : Nat) (contract : Bool) : Gen Run := do
  let outcome ← genOutcome clean
  let tests ← match outcome with
    | .passed => do if ← chance (if clean then 1 else 10) then pure 0 else (· + 1) <$> below 20
    | .failed => (· + 1) <$> below 20
    | _ => pure 0
  let failures ← match outcome with
    | .failed => do
      let n ← if ← chance 10 then pure 0 else (· + 1) <$> below 2
      genFailures n
    | .overran => do genFailures (← below 2)
    | _ => pure []
  let evidence ← if ← chance 10 then pure [← genEvidence clean, ← genEvidence clean] else pure [← genEvidence clean]
  let report ← if contract then pick [Report.none, .counts, .counts, .counts, .counts, .counts, .counts, .counts, .invalid, .invalid]
    else (do if ← chance 4 then pure Report.invalid else pure Report.none)
  let commit ← if ← chance 60 then pure 0 else (· + 1) <$> below 2
  let readsChanged ← if shared && commit != 0 then chance 25 else pure false
  return { id, check, commit, counts := ← chance 85, readsChanged, outcome, tests, failures, evidence, contract := report }

def genClaim : Gen Claim := do
  let clean ← chance 40
  let nReq ← if ← chance 10 then pure 0 else (· + 1) <$> below 3
  let reqs ← (List.range nReq).mapM (genReq clean)
  let nCheck ← if ← chance 6 then pure 0 else (· + 1) <$> below 4
  let mut checks := []
  let mut runs := []
  let mut id := 0
  for j in [0:nCheck] do
    let spec ← genSpec clean j (reqs.map (·.id))
    let state ← if clean then pick [State.auto, .auto, .auto, .auto, .auto, .ended, .ended, .ended, .ended, .running]
      else pick [State.auto, .auto, .auto, .auto, .running, .running, .ended, .ended, .ended, .neverStarted]
    checks := checks ++ [{ spec, state }]
    if state != .neverStarted then
      for _ in [0:(← below 6)] do
        runs := runs ++ [← genRun clean (2 ≤ nCheck) id j spec.contract]
        id := id + 1
  if ← chance 5 then
    runs := runs ++ [← genRun clean false id 9 false]
  if !runs.isEmpty && (← chance 15) then
    let r := runs[← below runs.length]!
    runs := runs.insertIdx (← below (runs.length + 1)) r
  -- Another record under an existing run ID: it differs from the first unless drawn the same.
  if !runs.isEmpty && (← chance 6) then
    let r := runs[← below runs.length]!
    let r' ← genRun clean (2 ≤ nCheck) r.id r.check (r.contract != .none)
    runs := runs.insertIdx (← below (runs.length + 1)) r'
  return { reqs, checks, runs, badState := ← chance 4 }

-- ---- JSON

def jstr (s : String) : String := "\"" ++ s ++ "\""
def jbool (b : Bool) : String := if b then "true" else "false"
def jarr {α} (f : α → String) (l : List α) : String := "[" ++ ",".intercalate (l.map f) ++ "]"
def jobj (kv : List (String × String)) : String := "{" ++ ",".intercalate (kv.map fun (k, v) => jstr k ++ ":" ++ v) ++ "}"

def Result.name : Result → String
  | .PASS => "PASS" | .pending => "pending" | .INCONCLUSIVE => "INCONCLUSIVE" | .BLOCKED => "BLOCKED"
  | .INVALID => "INVALID" | .FAIL => "FAIL"
def Outcome.name : Outcome → String
  | .passed => "passed" | .failed => "failed" | .ranNothing => "ran_nothing" | .missing => "missing"
  | .overran => "overran" | .stopped => "stopped" | .uncounted => "uncounted"

/-- Every row of the rules table, in the order `inductive Row` declares them. -/
def Row.all : List Row :=
  [.never_started, .runs_needed_unreadable, .cant_fail, .fix_unproven_on_base, .missing, .ran_nothing,
   .conflicting_records, .contract_invalid, .no_contract_report, .runs_to_come, .inherited, .failed, .flaky,
   .stopped, .all_failures_waived, .too_few_clean_runs, .evidence_missing_outside, .evidence_no_digest,
   .evidence_missing, .evidence_truncated, .waits_on_answer, .ask_unanswered, .answered_pass, .answered_fail,
   .no_check_at_depth, .only_own_checks, .covered, .bad_state_digest, .no_check, .claim_only_own_checks]

/-- A row's constructor name. -/
def Row.name (r : Row) : String := ((reprStr r).splitOn ".").getLast!

-- ---- The concrete claim each abstract one stands for

def pad (width : Nat) (s : String) : String := "".pushn '0' (width - s.length) ++ s
def hex (n : Nat) : String := String.ofList (Nat.toDigits 16 n)
def times (c : Char) (n : Nat) : String := "".pushn c n

/-- The claim's commit. -/
def commitD : String := times 'd' 40
/-- Earlier commit `m` of check `i`'s runs: each check's earlier commits are its own. -/
def parent (i m : Nat) : String := times 'c' 36 ++ pad 2 (toString i) ++ pad 2 (toString m)
/-- An earlier commit the claim names no change from, so nothing on it carries. -/
def unnamed (m : Nat) : String := times 'e' 38 ++ pad 2 (toString m)
def digest (i : Nat) : String := "d1:" ++ pad 64 (hex i)
def depthName (d : Nat) : String := ["unit", "integration", "journey", "live"].getD d "live"
def reqId (i : Nat) : String := s!"req:DEF#R{i}"
def testName (t : Nat) : String := s!"a.test.ts › t{t}"
def env : String := jobj [("os", jstr "darwin-arm64")]
def tools : String := jobj [("node", jstr "24.22.0")]
def now : Nat := 1000000

def contractDecl : String :=
  jobj [("reference", jobj [("precision", jstr "fp64")]), ("accumulate", jstr "fp32"),
        ("tolerances", jarr id [jobj [("output", jstr "out"), ("size", "4"), ("atol", "0.001"), ("rtol", "0.001"), ("unit", jstr "value")]]),
        ("twin", jobj [("accumulate", jstr "fp16")]), ("assert", jstr "assert_close")]
def side (passed : Bool) : String :=
  jobj [("outcome", jstr (if passed then "passed" else "failed")), ("failed_at", if passed then "null" else jstr "assert_close"),
        ("compared", jobj [("out", "4")]), ("largest_error", jobj [("out", "0")])]

def reqJson (q : Req) : String :=
  jobj ([("req", jstr (reqId q.id)), ("depth", jstr (depthName q.depth)),
         ("oracle", jstr (if q.person.isSome then "person" else "code")), ("on_base", jstr (if q.fix then "fails" else "passes"))]
    ++ (if q.numbers then [("numbers", "true")] else [])
    ++ (match q.person with
        | none => []
        | some a => [("ask", jstr s!"ask:A{q.id}")] ++ (match a with
          | .open => [] | .unanswered => [("answer", jstr "unanswered")] | .pass => [("answer", jstr "PASS")]
          | .fail => [("answer", jstr "FAIL")])))

def checkJson (c : Check) : String :=
  let s := c.spec
  jobj ([("check", jstr s!"check{s.id}"), ("digest", jstr (digest s.id)), ("source", jstr (if s.own then "own" else "definition")),
         ("depth", jstr (depthName s.depth)), ("proof", jstr "test_run"), ("covers", jarr (jstr ∘ reqId) s.covers),
         ("inputs", jarr jstr [s!"src/c{s.id}/**"]), ("environment", env), ("tools", tools)]
    -- Unreadable: a rate outside (0, 100%). One clean run: undeclared, or `runs: 1` for odd IDs.
    ++ (match s.need with
        | none => [("accept", jstr "0%")]
        | some n => if n > 1 || s.id % 2 == 1 then [("runs", toString n)] else [])
    ++ (if s.cantFail then [("cant_fail", jstr "exit status masked by `|| true`")] else [])
    ++ (match s.base with
        | .none => []
        | .passed => [("base", jobj [("outcome", jstr "passed"), ("on_assertion", "false"), ("failed_tests", "[]")])]
        | .failed a ts => [("base", jobj [("outcome", jstr "failed"), ("on_assertion", jbool a), ("failed_tests", jarr (jstr ∘ testName) ts)])])
    ++ (if s.contract then [("contract", contractDecl)] else [])
    ++ (match c.state with
        | .auto => [] | .running => [("state", jstr "running")] | .ended => [("state", jstr "ended")]
        | .neverStarted => [("state", jstr "never_started"), ("never_started", jstr "loop")]))

def slotJson (i : Nat) (e : Evidence) : String :=
  let name := ("slot", jstr s!"slot{i}")
  match e with
  | .captured => jobj [name, ("state", jstr "captured"), ("sha256", jstr (times 'a' 64))]
  | .notRequested => jobj [name, ("state", jstr "not_requested")]
  | .noDigest => jobj [name, ("state", jstr "captured")]
  | .missingOutside => jobj [name, ("state", jstr "missing"), ("reason", jstr "simulator unavailable"), ("outside_code", "true")]
  | .missingInside => jobj [name, ("state", jstr "missing"), ("reason", jstr "the page never rendered")]
  | .truncated => jobj [name, ("state", jstr "truncated"), ("counts", jobj [("kept", "3"), ("expected", "5")])]

/-- The path the change from check `i`'s earlier commits touches: one the next check declares, not `i`. -/
def touched (checks i : Nat) : String := s!"src/c{(i + 1) % max 1 checks}/x.ts"

def runJson (claim : String) (checks : Nat) (r : Run) : String :=
  let commit := if r.commit == 0 then commitD else parent r.check r.commit
  -- A run that doesn't count: its key or its evidence or its commit keeps it out, one way per run ID. A run whose
  -- reads withdraw a carry stays on its commit.
  let way := if r.counts then 5 else r.id % (if r.readsChanged then 4 else 5)
  let failures := r.failures.map fun f =>
    jobj [("test", jstr (testName f.test)), ("message", jstr s!"{if f.waived then "waived" else "broke"} {f.test}"),
          ("cause", jstr "change:c1"), ("frames", "[]"), ("covers", "[]"), ("case", "null")]
  jobj ([("run", jstr s!"run:R{r.id}"), ("check", jstr s!"check{r.check}"), ("claim", jstr claim),
         ("commit", jstr (if way == 4 then unnamed r.commit else commit)),
         ("digest", jstr (digest (if way == 0 then 1000 + r.check else r.check))),
         ("environment", if way == 1 then jobj [("os", jstr "linux-x64")] else env),
         ("tools", if way == 2 then jobj [("node", jstr "20.18.0")] else tools),
         ("outcome", jstr r.outcome.name), ("ended", toString (1000 + r.id)), ("tests_run", toString r.tests),
         ("reads", jarr jstr (if r.readsChanged then [touched checks r.check] else [])),
         ("failures", "[" ++ ",".intercalate failures ++ "]"),
         ("evidence", "[" ++ ",".intercalate ((r.evidence.zipIdx).map fun (e, i) => slotJson i e) ++ "]"),
         ("kept", jbool (way != 3))]
    ++ (if r.outcome == .missing then [("missing", jobj [("cause", jstr "secret STRIPE_TEST_KEY not set"), ("owner", jstr "ops"), ("since", "0")])] else [])
    ++ (match r.contract with
        | .none => []
        | .counts => [("contract", jobj [("run", side true), ("twin", side false), ("outcome", jstr "counts"), ("reasons", "[]")])]
        -- An INVALID report gives its reasons, or, for every third run ID, none.
        | .invalid => [("contract", jobj [("run", side true), ("twin", side true), ("outcome", jstr "INVALID"),
                        ("reasons", if r.id % 3 == 0 then "[]" else jarr jstr ["the twin passed"])])]))

def claimJson (name : String) (cl : Claim) : String :=
  let n := cl.checks.length
  let changes := cl.checks.flatMap fun c => [1, 2].map fun m =>
    jobj [("from", jstr (parent c.spec.id m)), ("paths", jarr jstr (if n > 1 then [touched n c.spec.id] else []))]
  let waivers := cl.checks.flatMap fun c => [0, 1, 2].map fun t =>
    jobj [("check", jstr s!"check{c.spec.id}"), ("error", jstr s!"waived {t}"), ("owner", jstr "person:owner"),
          ("approved_by", jstr "person:owner"), ("ends", jobj [("date", toString (now + 1))])]
  jobj ([("claim", jstr name), ("agent", jstr "session:A"), ("repo", jstr "shop"), ("task", jstr "task:T"),
         ("commit", jstr commitD), ("requirements", jarr reqJson cl.reqs), ("checks", jarr checkJson cl.checks),
         ("runs", jarr (runJson name n) cl.runs), ("changes", "[" ++ ",".intercalate changes ++ "]"),
         ("waivers", "[" ++ ",".intercalate waivers ++ "]"), ("now", toString now)]
    ++ (if cl.badState then [("state", jarr jstr ["not-a-digest"])] else []))

def vector (i : Nat) (cl : Claim) : String :=
  let k := reading cl.runs
  jobj [("claim", claimJson s!"claim:V{i}" cl),
        ("verdict", jstr (verdict cl).name),
        ("checks", jarr (fun c => jobj [("check", jstr s!"check{c.spec.id}"), ("outcome", jstr (checkOutcome cl.reqs k c).name)]) cl.checks),
        ("requirements", jarr (fun q => jobj [("req", jstr (reqId q.id)), ("outcome", jstr (reqOutcome cl k q).name)]) cl.reqs),
        ("rows", jarr (fun r => jstr r.name) (dedup (allRows cl k)))]

end Verdicts

open Verdicts in
def main (args : List String) : IO UInt32 := do
  let some seed := args[0]? >>= String.toNat? | IO.eprintln "usage: vectors <seed> <count>"; return 2
  let some n := args[1]? >>= String.toNat? | IO.eprintln "usage: vectors <seed> <count>"; return 2
  let out ← IO.getStdout
  out.putStrLn (jobj [("seed", toString seed), ("count", toString n), ("rows", jarr (jstr ∘ Row.name) Row.all)])
  for i in [0:n] do
    let (cl, _) := genClaim.run ⟨(seed * 1000003 + i).toUInt64⟩
    out.putStrLn (vector i cl)
  return 0
